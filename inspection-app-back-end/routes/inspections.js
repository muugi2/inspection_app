const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const {
  normalizeRelativePath,
  buildPublicUrl,
  loadImagePayload,
  inferMimeType,
} = require('../utils/imageStorage');
const { serializeBigInt, handleError, parseBigIntId } = require('../utils/routeHelpers');
const sectionAnswersService = require('../services/section-answers-service');
const { sendInspectionAssignmentEmail } = require('../services/email-service');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

const router = express.Router();
const prisma = new PrismaClient();

// =============================================================================
// MULTER CONFIGURATION FOR IMAGE UPLOADS
// =============================================================================

// Ensure upload directory exists
const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
if (!fs.existsSync(FTP_STORAGE_PATH)) {
  fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    console.log(`📁 Multer destination: ${FTP_STORAGE_PATH}`);
    // Ensure directory exists
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      console.log(`📁 Creating directory: ${FTP_STORAGE_PATH}`);
      fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
    }
    cb(null, FTP_STORAGE_PATH);
  },
  filename: function (req, file, cb) {
    // Generate temporary filename - will be renamed later with correct format
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `temp-${uniqueSuffix}${ext}`;
    console.log(`📝 Generated temporary filename: ${fileName} (will be renamed later)`);
    cb(null, fileName);
  }
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Format datetime for Mongolian locale
const formatDateTime = value => {
  if (!value) {
    return 'Төлөвлөсөн огноо тодорхойгүй';
  }

  try {
    return new Date(value).toLocaleString('mn-MN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    return String(value);
  }
};

/**
 * Get device type from device metadata or model
 * @param {Object} device - Device object with metadata and model
 * @returns {string|null} - Device type (ANALOG/DIGITAL) or null
 */
function getDeviceType(device) {
  if (!device) return null;
  
  // Check metadata for type (ANALOG/DIGITAL)
  if (device.metadata && typeof device.metadata === 'object') {
    const metadataType = device.metadata.type;
    if (metadataType === 'ANALOG' || metadataType === 'DIGITAL') {
      return metadataType;
    }
  }
  
  // If not in metadata, use model's deviceType
  if (device.model?.deviceType) {
    return device.model.deviceType;
  }
  
  return null;
}

/**
 * Find template by device type and inspection type
 * @param {string} deviceType - Device type (ANALOG/DIGITAL)
 * @param {string} inspectionType - Inspection type (MAINTENANCE, INSPECTION, etc.)
 * @param {boolean} allowFallback - If true, fallback to deviceType-only match
 * @returns {Promise<Object|null>} - Template object or null
 */
async function findTemplateByDeviceType(deviceType, inspectionType = null, allowFallback = true) {
  if (!deviceType) return null;
  
  const templateSelect = {
    id: true,
    name: true,
    type: true,
    deviceType: true,
    description: true,
    questions: true,
    isActive: true,
  };
  
  // First, try to find template matching both device type and inspection type
  if (inspectionType) {
    const template = await prisma.InspectionTemplate.findFirst({
      where: {
        type: inspectionType,
        deviceType: deviceType,
        isActive: true,
      },
      select: templateSelect,
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    if (template) {
      return template;
    }
  }
  
  // Fallback: find template matching only device type
  if (allowFallback) {
    const fallbackTemplate = await prisma.InspectionTemplate.findFirst({
      where: {
        deviceType: deviceType,
        isActive: true,
      },
      select: templateSelect,
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    return fallbackTemplate;
  }
  
  return null;
}

/**
 * Format device info for API response
 * @param {Object} device - Device object from Prisma
 * @returns {Object|null} - Formatted device info or null
 */
function formatDeviceInfo(device) {
  if (!device) return null;
  
  return {
    id: device.id?.toString() || device.id,
    serialNumber: device.serialNumber,
    assetTag: device.assetTag,
    metadata: device.metadata,
    location: device.metadata?.location || 'Тодорхойлогдоогүй',
    model: device.model ? {
      ...device.model,
      id: device.model.id?.toString() || device.model.id,
    } : null,
    organization: device.organization ? {
      ...device.organization,
      id: device.organization.id?.toString() || device.organization.id,
    } : null,
    site: device.site ? {
      ...device.site,
      id: device.site.id?.toString() || device.site.id,
    } : null,
    contract: device.contract ? {
      ...device.contract,
      id: device.contract.id?.toString() || device.contract.id,
    } : null,
  };
}

/**
 * Get section answers for a specific section
 */
async function getSectionAnswers(inspectionId, sectionName) {
  const answers = await prisma.InspectionAnswer.findMany({
    where: { inspectionId },
    orderBy: { answeredAt: 'desc' }, // Get latest first
    select: { id: true, answers: true, answeredBy: true, answeredAt: true },
  });

  if (answers.length === 0) return {};

  // Find the latest answer that contains this section (now first in array)
  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    const answerData = answer.answers || {};
    const sectionData = answerData.data || answerData; // Support both formats
    if (sectionData[sectionName]) {
      return sectionData[sectionName];
    }
  }

  return {};
}

/**
 * Get completed sections for an inspection55
 */
async function getCompletedSections(inspectionId) {
  const answers = await prisma.InspectionAnswer.findMany({
    where: { inspectionId },
    orderBy: { answeredAt: 'asc' },
    select: { answers: true, answeredAt: true },
  });

  const completedSections = [];
  const sectionNames = [
    'exterior',
    'indicator',
    'jbox',
    'sensor',
    'foundation',
    'cleanliness',
  ];

  answers.forEach(answer => {
    const answerData = answer.answers || {};
    const sectionData = answerData.data || answerData; // Support both formats
    if (sectionData) {
      sectionNames.forEach(sectionName => {
        if (
          sectionData[sectionName] &&
          !completedSections.find(s => s.section === sectionName)
        ) {
          completedSections.push({
            section: sectionName,
            completedAt: answer.answeredAt,
            answeredAt: answer.answeredAt,
          });
        }
      });
    }
  });

  return completedSections;
}

/**
 * Fetch assigned inspections by type for a user
 */
async function getAssignedInspectionsByType(userId, inspectionType = null) {
  // Active statuses that should be shown in Flutter app
  // Based on schema: DRAFT, IN_PROGRESS, SUBMITTED are active
  // Exclude: APPROVED, REJECTED, CANCELED
  const ACTIVE_STATUSES = ['DRAFT', 'IN_PROGRESS', 'SUBMITTED'];
  
  const now = new Date();
  
  // Build date filter OR conditions
  const dateFilterOR = [
    // Case 1: Both startedAt and completedAt are set - current date must be between them
    {
      AND: [
        { startedAt: { not: null } },
        { completedAt: { not: null } },
        { startedAt: { lte: now } },
        { completedAt: { gte: now } },
      ],
    },
    // Case 2: Only startedAt is set - current date must be >= startedAt
    {
      AND: [
        { startedAt: { not: null } },
        { completedAt: null },
        { startedAt: { lte: now } },
      ],
    },
    // Case 3: Only completedAt is set - current date must be <= completedAt
    {
      AND: [
        { startedAt: null },
        { completedAt: { not: null } },
        { completedAt: { gte: now } },
      ],
    },
    // Case 4: Both are null - show inspection (for backward compatibility with old data)
    {
      AND: [
        { startedAt: null },
        { completedAt: null },
      ],
    },
  ];
  
  const whereClause = {
    deletedAt: null,
    status: {
      in: ACTIVE_STATUSES,
    },
    // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
    AND: [
      {
        OR: [
          { assignedTo: userId },
          { assignments: { some: { userId: userId } } },
        ],
      },
      {
        OR: dateFilterOR,
      },
    ],
  };

  if (inspectionType) whereClause.type = inspectionType;

  console.log(`[getAssignedInspectionsByType] Query:`, JSON.stringify({
    assignedTo: userId.toString(),
    assignments: { some: { userId: userId.toString() } },
    deletedAt: null,
    status: { in: ACTIVE_STATUSES },
    type: inspectionType || 'all types'
  }, null, 2));

  const inspections = await prisma.Inspection.findMany({
    where: whereClause,
    include: {
      assignee: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      assignments: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      },
      device: {
        select: {
          id: true,
          serialNumber: true,
          assetTag: true,
          model: { select: { manufacturer: true, model: true, deviceType: true } },
        },
      },
      site: { select: { id: true, name: true } },
      contract: {
        select: { id: true, contractName: true, contractNumber: true, endDate: true },
      },
      createdByUser: { select: { id: true, fullName: true, email: true } },
      template: { select: { id: true, name: true, type: true, deviceType: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
  });

  console.log(`[getAssignedInspectionsByType] Found ${inspections.length} inspections`);
  
  // Log each inspection for debugging
  if (inspections.length > 0) {
    console.log(`[getAssignedInspectionsByType] Sample inspection:`, {
      id: inspections[0].id.toString(),
      title: inspections[0].title,
      status: inspections[0].status,
      assignedTo: inspections[0].assignedTo?.toString(),
      type: inspections[0].type,
    });
  } else {
    console.log(`[getAssignedInspectionsByType] No inspections found. Checking database...`);
    // Check if there are any inspections assigned to this user (without status filter)
    // Check both assignedTo and assignments
    const allAssigned = await prisma.Inspection.findMany({
      where: {
        deletedAt: null,
        OR: [
          { assignedTo: userId },
          { assignments: { some: { userId: userId } } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        assignedTo: true,
        type: true,
      },
      take: 5,
    });
    console.log(`[getAssignedInspectionsByType] All assigned inspections (no status filter):`, allAssigned.map(i => ({
      id: i.id.toString(),
      title: i.title,
      status: i.status,
      assignedTo: i.assignedTo?.toString(),
      type: i.type,
    })));
  }
  
  return inspections.map(inspection => ({
    ...inspection,
    id: inspection.id.toString(),
    orgId: inspection.orgId.toString(),
    deviceId: inspection.deviceId?.toString(),
    siteId: inspection.siteId?.toString(),
    contractId: inspection.contractId?.toString(),
    templateId: inspection.templateId?.toString(),
    assignedTo: inspection.assignedTo?.toString(),
    assignee: inspection.assignee ? {
      id: inspection.assignee.id.toString(),
      fullName: inspection.assignee.fullName,
      email: inspection.assignee.email,
    } : null,
    assignedUsers: inspection.assignments?.map(a => ({
      id: a.user.id.toString(),
      fullName: a.user.fullName,
      email: a.user.email,
    })) || [],
    createdBy: inspection.createdBy.toString(),
    updatedBy: inspection.updatedBy?.toString(),
    device: formatDeviceInfo(inspection.device),
    site: inspection.site
      ? { ...inspection.site, id: inspection.site.id.toString() }
      : null,
    contract: inspection.contract
      ? { ...inspection.contract, id: inspection.contract.id.toString() }
      : null,
    createdByUser: {
      ...inspection.createdByUser,
      id: inspection.createdByUser.id.toString(),
    },
    template: inspection.template
      ? { ...inspection.template, id: inspection.template.id.toString() }
      : null,
  }));
}

/**
 * Check user access to inspection
 */
function checkInspectionAccess(inspection, orgIdFromToken, userId, isAdmin = false) {
  if (isAdmin) {
    return true;
  }

  const sameOrg = inspection.orgId.toString() === orgIdFromToken;
  const isAssignee = inspection.assignedTo?.toString() === userId;
  // Check if user is in assignments (for multiple assignments support)
  const isInAssignments = inspection.assignments?.some(
    assignment => assignment.userId?.toString() === userId
  ) || false;
  const isCreator = inspection.createdBy.toString() === userId;
  return sameOrg || isAssignee || isInAssignments || isCreator;
}

/**
 * Common inspection verification and access check
 */
async function verifyInspectionAccess(
  inspectionId,
  userId,
  orgIdFromToken,
  includeFields = {}
) {
  const defaultInclude = {
    device: {
      include: {
        model: true, // Include all model fields (we need deviceType)
      },
    },
    assignments: {
      select: {
        userId: true,
      },
    },
  };

  // Merge includeFields with defaultInclude
  const finalInclude = { ...defaultInclude, ...includeFields };

  const inspection = await prisma.Inspection.findUnique({
    where: { id: inspectionId },
    include: finalInclude,
  });

  if (!inspection) {
    throw new Error('Inspection not found');
  }

  const currentUser = await prisma.User.findUnique({
    where: { id: BigInt(userId) },
    include: { role: true },
  });

  const isAdmin =
    currentUser?.role?.name &&
    currentUser.role.name.toLowerCase() === 'admin';

  if (!checkInspectionAccess(inspection, orgIdFromToken, userId, isAdmin)) {
    throw new Error('You do not have access to this inspection');
  }

  return inspection;
}

/**
 * Get template and sections for inspection
 * If templateId is not set, try to find template by device type from device metadata
 */
async function getTemplateAndSections(inspection) {
  let template = null;
  
  // First, try to get template from inspection's templateId
  if (inspection.templateId) {
    template = await prisma.InspectionTemplate.findUnique({
      where: { id: inspection.templateId },
      select: {
        id: true,
        name: true,
        type: true,
        deviceType: true,
        description: true,
        questions: true,
        isActive: true,
      },
    });
  }

  // If no template found and inspection has device, try to find template by device type
  if (!template && inspection.deviceId) {
    // Use device from inspection if already loaded, otherwise fetch it
    let device = inspection.device;
    
    if (!device) {
      device = await prisma.Device.findUnique({
        where: { id: inspection.deviceId },
        include: {
          model: {
            select: {
              deviceType: true,
            },
          },
        },
      });
    }

    if (device) {
      const deviceType = getDeviceType(device);
      
      if (deviceType) {
        console.log(`[getTemplateAndSections] Looking for template with deviceType=${deviceType}, inspectionType=${inspection.type}`);
        
        template = await findTemplateByDeviceType(deviceType, inspection.type, true);
        
        if (template) {
          console.log(`[getTemplateAndSections] Found template by deviceType: ${template.id.toString()} - ${template.name}`);
          
          // Update inspection with the found templateId if it wasn't set
          if (!inspection.templateId) {
            await prisma.Inspection.update({
              where: { id: inspection.id },
              data: { templateId: template.id },
            });
            console.log(`[getTemplateAndSections] Updated inspection ${inspection.id.toString()} with templateId ${template.id.toString()}`);
          }
        } else {
          console.warn(`[getTemplateAndSections] No template found for deviceType=${deviceType}, inspectionType=${inspection.type}`);
        }
      } else {
        console.warn(`[getTemplateAndSections] Could not determine deviceType for device ${inspection.deviceId?.toString()}`);
      }
    }
  }

  if (!template) {
    throw new Error('No template found for this inspection');
  }

  const questions =
    typeof template.questions === 'string'
      ? JSON.parse(template.questions)
      : template.questions;
  const sections = sectionAnswersService.getTemplateSections(questions);

  return { template, sections };
}

// Error handling function is now imported from routeHelpers

// =============================================================================
// GET ROUTES - FETCH INSPECTIONS
// =============================================================================

// GET all inspections (admin view)
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Build where clause
    const whereClause = {
      deletedAt: null,
    };

    // Check if user is admin or regular user
    const currentUser = await prisma.User.findUnique({
      where: { id: BigInt(req.user.id) },
      include: { role: true },
    });

    // If not admin, show inspections from their organization OR assigned to them
    // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
    if (currentUser?.role?.name !== 'admin') {
      whereClause.OR = [
        { orgId: BigInt(req.user.orgId) },
        { assignedTo: BigInt(req.user.id) },
        { assignments: { some: { userId: BigInt(req.user.id) } } },
      ];
    }

    const inspections = await prisma.Inspection.findMany({
      where: whereClause,
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            model: {
              select: {
                manufacturer: true,
                model: true,
                deviceType: true,
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
            endDate: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            type: true,
            deviceType: true,
          },
        },
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
        createdByUser: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { scheduledAt: 'asc' }],
    });

    const formattedInspections = inspections.map(inspection => ({
      id: inspection.id.toString(),
      orgId: inspection.orgId.toString(),
      deviceId: inspection.deviceId?.toString(),
      siteId: inspection.siteId?.toString(),
      contractId: inspection.contractId?.toString(),
      templateId: inspection.templateId?.toString(),
      type: inspection.type,
      title: inspection.title,
      scheduledAt: inspection.scheduledAt,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      status: inspection.status,
      progress: inspection.progress,
      assignedTo: inspection.assignedTo?.toString(),
      notes: inspection.notes,
      device: formatDeviceInfo(inspection.device),
      site: inspection.site
        ? {
            id: inspection.site.id.toString(),
            name: inspection.site.name,
          }
        : null,
      contract: inspection.contract
        ? {
            id: inspection.contract.id.toString(),
            contractName: inspection.contract.contractName,
            contractNumber: inspection.contract.contractNumber,
            endDate: inspection.contract.endDate,
          }
        : null,
      template: inspection.template
        ? {
            id: inspection.template.id.toString(),
            name: inspection.template.name,
            type: inspection.template.type,
          }
        : null,
      assignedUser: inspection.assignee
        ? {
            id: inspection.assignee.id.toString(),
            fullName: inspection.assignee.fullName,
            email: inspection.assignee.email,
          }
        : null,
      assignedUsers: inspection.assignments?.map(a => ({
        id: a.user.id.toString(),
        fullName: a.user.fullName,
        email: a.user.email,
      })) || [],
      createdByUser: inspection.createdByUser
        ? {
            id: inspection.createdByUser.id.toString(),
            fullName: inspection.createdByUser.fullName,
          }
        : null,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,
    }));

    console.log(`[GET /api/inspections] Returning ${formattedInspections.length} inspections`);

    res.json({
      message: 'Inspections fetched successfully',
      data: formattedInspections,
    });
  } catch (error) {
    console.error('Error fetching inspections:', error);
    res.status(500).json({
      error: 'Failed to fetch inspections',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// GET inspections by schedule type (DAILY / SCHEDULED) for current user
router.get('/by-schedule-type/:scheduleType', authMiddleware, async (req, res) => {
  try {
    const requestedScheduleType = req.params.scheduleType
      ? req.params.scheduleType.toString().toUpperCase()
      : null;

    const allowedScheduleTypes = ['DAILY', 'SCHEDULED'];
    if (!requestedScheduleType || !allowedScheduleTypes.includes(requestedScheduleType)) {
      return res.status(400).json({
        error: 'Invalid schedule type',
        message: `scheduleType must be one of: ${allowedScheduleTypes.join(', ')}`,
      });
    }

    const currentUser = await prisma.User.findUnique({
      where: { id: BigInt(req.user.id) },
      include: { role: true },
    });

    const isAdmin = currentUser?.role?.name?.toLowerCase() === 'admin';
    // Active statuses that should be shown in Flutter app
    const ACTIVE_STATUSES = ['DRAFT', 'IN_PROGRESS', 'SUBMITTED'];
    
    const now = new Date();
    
    const whereClause = {
      deletedAt: null,
      scheduleType: requestedScheduleType,
      type: { not: 'MAINTENANCE' }, // Exclude repair assignments - they should only appear in "Томилолтын үзлэг"
      status: {
        in: ACTIVE_STATUSES,
      },
      // Filter by date range: only show inspections where current date is between startedAt and completedAt
      // If startedAt is null, don't filter by start date
      // If completedAt is null, don't filter by end date
      // If both are null, show the inspection (for backward compatibility)
      OR: [
        // Case 1: Both startedAt and completedAt are set - current date must be between them
        {
          AND: [
            { startedAt: { not: null } },
            { completedAt: { not: null } },
            { startedAt: { lte: now } },
            { completedAt: { gte: now } },
          ],
        },
        // Case 2: Only startedAt is set - current date must be >= startedAt
        {
          AND: [
            { startedAt: { not: null } },
            { completedAt: null },
            { startedAt: { lte: now } },
          ],
        },
        // Case 3: Only completedAt is set - current date must be <= completedAt
        {
          AND: [
            { startedAt: null },
            { completedAt: { not: null } },
            { completedAt: { gte: now } },
          ],
        },
        // Case 4: Both are null - show inspection (for backward compatibility with old data)
        {
          AND: [
            { startedAt: null },
            { completedAt: null },
          ],
        },
      ],
    };

    if (!isAdmin) {
      // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
      // to support cross-organization assignments
      // Remove orgId filter to allow users to see inspections assigned to them
      // from other organizations
      whereClause.AND = [
        {
          OR: [
            { assignedTo: BigInt(req.user.id) },
            { assignments: { some: { userId: BigInt(req.user.id) } } },
          ],
        },
        {
          OR: whereClause.OR,
        },
      ];
      // Remove the OR from top level since it's now in AND
      delete whereClause.OR;
    }
    
    console.log(`[GET /by-schedule-type/:scheduleType] Query:`, JSON.stringify({
      scheduleType: requestedScheduleType,
      type: { not: 'MAINTENANCE' }, // Exclude repair assignments
      status: { in: ACTIVE_STATUSES },
      assignedTo: !isAdmin ? req.user.id : 'all users (admin)',
      assignments: !isAdmin ? { some: { userId: req.user.id } } : 'all users (admin)',
      note: 'Cross-organization assignments are now supported. Multiple assignments via InspectionAssignment table are supported. Repair assignments (MAINTENANCE type) are excluded.'
    }, null, 2));

    const inspections = await prisma.Inspection.findMany({
      where: whereClause,
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            model: {
              select: {
                manufacturer: true,
                model: true,
              },
            },
            metadata: true,
            contract: {
              select: {
                id: true,
                contractName: true,
                contractNumber: true,
                endDate: true,
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });

    console.log(`[GET /by-schedule-type/:scheduleType] Found ${inspections.length} inspections for scheduleType ${requestedScheduleType}`);
    
    // Debug: Log each inspection's scheduleType
    inspections.forEach((inspection, index) => {
      console.log(`[GET /by-schedule-type/:scheduleType] Inspection ${index + 1}: id=${inspection.id}, scheduleType=${inspection.scheduleType}, title=${inspection.title}`);
    });
    
    const formatted = inspections.map(inspection => ({
      id: inspection.id.toString(),
      orgId: inspection.orgId.toString(),
      deviceId: inspection.deviceId?.toString(),
      siteId: inspection.siteId?.toString(),
      contractId: inspection.contractId?.toString(),
      templateId: inspection.templateId?.toString(),
      type: inspection.type,
      title: inspection.title,
      scheduleType: inspection.scheduleType,
      scheduledAt: inspection.scheduledAt,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      status: inspection.status,
      progress: inspection.progress,
      assignedTo: inspection.assignedTo?.toString(),
      assignee: inspection.assignee ? {
        id: inspection.assignee.id.toString(),
        fullName: inspection.assignee.fullName,
        email: inspection.assignee.email,
      } : null,
      assignedUsers: inspection.assignments?.map(a => ({
        id: a.user.id.toString(),
        fullName: a.user.fullName,
        email: a.user.email,
      })) || [],
      notes: inspection.notes,
      device: formatDeviceInfo(inspection.device),
      site: inspection.site
        ? {
            id: inspection.site.id.toString(),
            name: inspection.site.name,
          }
        : null,
      contract: inspection.contract
        ? {
            id: inspection.contract.id.toString(),
            contractName: inspection.contract.contractName,
            contractNumber: inspection.contract.contractNumber,
            endDate: inspection.contract.endDate,
          }
        : null,
      template: inspection.template
        ? {
            id: inspection.template.id.toString(),
            name: inspection.template.name,
            type: inspection.template.type,
          }
        : null,
    }));

    return res.json({
      message: 'Inspections fetched successfully',
      data: formatted,
    });
  } catch (error) {
    return handleError(res, error, 'fetch inspections by schedule type');
  }
});

// GET all inspections assigned to logged-in user
router.get('/assigned', authMiddleware, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    console.log(`[GET /assigned] User ID: ${req.user.id}`);
    
    const inspections = await getAssignedInspectionsByType(userId);
    
    console.log(`[GET /assigned] Found ${inspections.length} inspections for user ${req.user.id}`);
    
    res.json({
      message: 'All assigned inspections fetched successfully',
      data: inspections,
      count: inspections.length,
    });
  } catch (error) {
    console.error('[GET /assigned] Error:', error);
    handleError(res, error, 'fetch assigned inspections');
  }
});

// GET assigned inspections by type
router.get('/assigned/type/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = [
      'INSPECTION',
      'INSTALLATION',
      'MAINTENANCE',
      'VERIFICATION',
    ];
    const normalizedType = type.toUpperCase();

    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({
        error: 'Invalid inspection type',
        message: `Type must be one of: ${validTypes.join(', ')}`,
        validTypes,
      });
    }

    const userId = BigInt(req.user.id);
    console.log(`[GET /assigned/type/:type] User ID: ${req.user.id}, Type: ${normalizedType}`);
    
    const inspections = await getAssignedInspectionsByType(
      userId,
      normalizedType
    );
    
    console.log(`[GET /assigned/type/:type] Found ${inspections.length} inspections for user ${req.user.id}`);
    
    res.json({
      message: `Assigned ${normalizedType} inspections fetched successfully`,
      data: inspections,
      count: inspections.length,
      type: normalizedType,
    });
  } catch (error) {
    console.error('[GET /assigned/type/:type] Error:', error);
    handleError(res, error, 'fetch assigned inspections by type');
  }
});

// =============================================================================
// INCOMPLETE INSPECTIONS - RESUME FUNCTIONALITY
// =============================================================================

/**
 * Get incomplete inspections for current user
 * Returns inspections with status = 'IN_PROGRESS' in inspection_answers
 */
async function getIncompleteInspectionsForUser(userId, userOrgId, inspectionType = null) {
  const userIdBigInt = BigInt(userId);
  
  // Find all incomplete answers (status = 'IN_PROGRESS')
  const incompleteAnswers = await prisma.InspectionAnswer.findMany({
    where: {
      status: 'IN_PROGRESS',
      answeredBy: userIdBigInt,
    },
    include: {
      inspection: {
        where: {
          deletedAt: null,
          OR: [
            { assignedTo: userIdBigInt },
            { assignments: { some: { userId: userIdBigInt } } },
            { createdBy: userIdBigInt },
            { orgId: BigInt(userOrgId) }
          ]
        },
        include: {
          device: {
            select: {
              id: true,
              serialNumber: true,
              assetTag: true,
              model: {
                select: {
                  manufacturer: true,
                  model: true,
                  deviceType: true
                }
              }
            }
          },
          site: {
            select: {
              id: true,
              name: true
            }
          },
          assignee: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          },
          createdByUser: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          },
          template: {
            select: {
              id: true,
              name: true,
              type: true
            }
          }
        }
      }
    },
    orderBy: {
      answeredAt: 'desc'
    }
  });

  // Group by inspectionId and keep only the latest answer for each inspection
  const inspectionMap = new Map();
  
  incompleteAnswers.forEach(answer => {
    if (answer.inspection) {
      const inspectionId = answer.inspectionId.toString();
      
      // Filter by type if specified
      if (inspectionType && answer.inspection.type !== inspectionType) {
        return;
      }
      
      // Keep only the latest answer for each inspection
      if (!inspectionMap.has(inspectionId) || 
          answer.answeredAt > inspectionMap.get(inspectionId).answer.answeredAt) {
        inspectionMap.set(inspectionId, {
          inspection: answer.inspection,
          answer: answer
        });
      }
    }
  });

  // Convert to array and add progress information
  const result = [];
  
  for (const [inspectionId, data] of inspectionMap) {
    const { inspection, answer } = data;
    
    // Get completed sections
    const completedSections = await getCompletedSections(BigInt(inspectionId));
    
    // Check if signatures exist
    const answerData = answer.answers || {};
    const hasSignatures = answerData.signatures !== undefined;
    
    // Get template sections to calculate progress accurately
    let sectionOrder = [];
    let totalSections = 0;
    let completedCount = 0;
    let completedSectionNames = [];
    let missingSections = [];
    
    try {
      const { sections } = await getTemplateAndSections(inspection);
      sectionOrder = Object.keys(sections).sort((a, b) => sections[a].order - sections[b].order);
      
      // Add signatures section if it exists in template or if signatures are present
      if (!sectionOrder.includes('signatures') && hasSignatures) {
        sectionOrder.push('signatures');
      }
      
      // Calculate progress based on template sections
      totalSections = sectionOrder.length;
      completedSectionNames = completedSections.map(s => s.section);
      if (hasSignatures && !completedSectionNames.includes('signatures')) {
        completedSectionNames.push('signatures');
      }
      completedCount = completedSectionNames.length;
      missingSections = sectionOrder.filter(s => !completedSectionNames.includes(s));
    } catch (error) {
      console.warn('Could not get template sections for progress calculation:', error.message);
      // Fallback to hardcoded sections if template not found
      const allSections = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness', 'signatures'];
      sectionOrder = allSections;
      totalSections = allSections.length;
      completedSectionNames = completedSections.map(s => s.section);
      if (hasSignatures) completedSectionNames.push('signatures');
      completedCount = completedSectionNames.length;
      missingSections = allSections.filter(s => !completedSectionNames.includes(s));
    }
    
    // Serialize nested objects to convert BigInt to string
    const serializedDevice = inspection.device ? {
      ...inspection.device,
      id: inspection.device.id.toString(),
      model: inspection.device.model ? {
        ...inspection.device.model
      } : null
    } : null;

    const serializedSite = inspection.site ? {
      id: inspection.site.id.toString(),
      name: inspection.site.name
    } : null;

    const serializedAssignee = inspection.assignee ? {
      id: inspection.assignee.id.toString(),
      fullName: inspection.assignee.fullName,
      email: inspection.assignee.email
    } : null;

    const serializedCreatedByUser = inspection.createdByUser ? {
      id: inspection.createdByUser.id.toString(),
      fullName: inspection.createdByUser.fullName,
      email: inspection.createdByUser.email
    } : null;

    const serializedTemplate = inspection.template ? {
      id: inspection.template.id.toString(),
      name: inspection.template.name,
      type: inspection.template.type
    } : null;

    result.push({
      inspection: {
        id: inspection.id.toString(),
        title: inspection.title,
        type: inspection.type,
        status: inspection.status,
        assignedTo: inspection.assignedTo?.toString(),
        createdBy: inspection.createdBy.toString(),
        device: serializedDevice,
        site: serializedSite,
        assignee: serializedAssignee,
        createdByUser: serializedCreatedByUser,
        template: serializedTemplate
      },
      answer: {
        id: answer.id.toString(),
        status: answer.status,
        answeredBy: answer.answeredBy?.toString(),
        answeredAt: answer.answeredAt,
        lastUpdatedAt: answer.updatedAt
      },
      progress: {
        completedSections: completedCount,
        totalSections: totalSections,
        percentage: Math.round((completedCount / totalSections) * 100),
        missingSections: missingSections,
        completedSectionsList: completedSectionNames
      }
    });
  }
  
  return result;
}

/**
 * Get incomplete inspection status and resume data
 */
async function getIncompleteInspectionStatus(inspectionId, userId, userOrgId) {
  const inspectionIdBigInt = BigInt(inspectionId);
  const userIdBigInt = BigInt(userId);
  
  // Verify inspection access
  const inspection = await verifyInspectionAccess(
    inspectionIdBigInt,
    userId,
    userOrgId
  );
  
  // Find incomplete answer (status = 'IN_PROGRESS')
  const incompleteAnswer = await prisma.InspectionAnswer.findFirst({
    where: {
      inspectionId: inspectionIdBigInt,
      status: 'IN_PROGRESS',
      answeredBy: userIdBigInt
    },
    orderBy: {
      answeredAt: 'desc'
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });
  
  if (!incompleteAnswer) {
    return null;
  }
  
  // Get completed sections
  const completedSections = await getCompletedSections(inspectionIdBigInt);
  
  // Check if signatures exist
  const answerData = incompleteAnswer.answers || {};
  const hasSignatures = answerData.signatures !== undefined;
  
  // Get template to determine section order and calculate progress based on template
  let sectionOrder = [];
  let lastCompletedSection = null;
  let nextSection = null;
  let totalSections = 0;
  let completedCount = 0;
  let completedSectionNames = [];
  let missingSections = [];
  
  try {
    const { sections } = await getTemplateAndSections(inspection);
    sectionOrder = Object.keys(sections).sort((a, b) => sections[a].order - sections[b].order);
    
    // Add signatures section if it exists in template or if signatures are present
    if (!sectionOrder.includes('signatures') && hasSignatures) {
      sectionOrder.push('signatures');
    }
    
    // Calculate progress based on template sections (not hardcoded array)
    totalSections = sectionOrder.length;
    completedSectionNames = completedSections.map(s => s.section);
    if (hasSignatures && !completedSectionNames.includes('signatures')) {
      completedSectionNames.push('signatures');
    }
    completedCount = completedSectionNames.length;
    missingSections = sectionOrder.filter(s => !completedSectionNames.includes(s));
    
    // Find last completed section
    for (let i = sectionOrder.length - 1; i >= 0; i--) {
      if (completedSectionNames.includes(sectionOrder[i])) {
        lastCompletedSection = sectionOrder[i];
        break;
      }
    }
    
    // Find next section to complete
    if (lastCompletedSection) {
      const lastIndex = sectionOrder.indexOf(lastCompletedSection);
      if (lastIndex < sectionOrder.length - 1) {
        nextSection = sectionOrder[lastIndex + 1];
      }
    } else if (sectionOrder.length > 0) {
      nextSection = sectionOrder[0];
    }
  } catch (error) {
    console.warn('Could not get template sections:', error.message);
    // Fallback to hardcoded sections if template not found
    const allSections = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness', 'signatures'];
    sectionOrder = allSections;
    totalSections = allSections.length;
    completedSectionNames = completedSections.map(s => s.section);
    if (hasSignatures) completedSectionNames.push('signatures');
    completedCount = completedSectionNames.length;
    missingSections = allSections.filter(s => !completedSectionNames.includes(s));
  }
  
  // Check user permissions
  // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
  const isInAssignments = inspection.assignments?.some(
    assignment => assignment.userId?.toString() === userId
  ) || false;
  const canContinue = 
    incompleteAnswer.answeredBy?.toString() === userId ||
    inspection.assignedTo?.toString() === userId ||
    isInAssignments ||
    inspection.createdBy.toString() === userId;
  
  // Serialize user object to convert BigInt to string
  const answeredByUser = incompleteAnswer.user ? {
    id: incompleteAnswer.user.id.toString(),
    fullName: incompleteAnswer.user.fullName,
    email: incompleteAnswer.user.email
  } : null;

  return {
    inspectionId: inspection.id.toString(),
    isIncomplete: true,
    status: incompleteAnswer.status,
    answerId: incompleteAnswer.id.toString(),
    answeredBy: incompleteAnswer.answeredBy?.toString(),
    answeredByUser: answeredByUser,
    lastAnsweredAt: incompleteAnswer.answeredAt,
    progress: {
      completedSections: completedCount,
      totalSections: totalSections,
      percentage: Math.round((completedCount / totalSections) * 100),
      missingSections: missingSections,
      completedSectionsList: completedSectionNames
    },
    lastCompletedSection: lastCompletedSection,
    nextSection: nextSection,
    sectionOrder: sectionOrder,
    canContinue: canContinue,
    reason: canContinue ? 'User has permission to continue this inspection' : 'User does not have permission'
  };
}

// GET incomplete inspections for current user
router.get('/incomplete', authMiddleware, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const { type } = req.query;
    
    console.log(`[GET /incomplete] User ID: ${req.user.id}, Type: ${type || 'all'}`);
    
    const incompleteInspections = await getIncompleteInspectionsForUser(
      req.user.id,
      req.user.orgId,
      type ? type.toUpperCase() : null
    );
    
    console.log(`[GET /incomplete] Found ${incompleteInspections.length} incomplete inspections`);
    
    res.json({
      message: 'Incomplete inspections fetched successfully',
      data: incompleteInspections,
      count: incompleteInspections.length,
      total: incompleteInspections.length
    });
  } catch (error) {
    console.error('[GET /incomplete] Error:', error);
    handleError(res, error, 'fetch incomplete inspections');
  }
});

// GET incomplete inspection status and resume data
router.get('/:id/incomplete-status', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    
    console.log(`[GET /:id/incomplete-status] Inspection ID: ${req.params.id}, User ID: ${req.user.id}`);
    
    const status = await getIncompleteInspectionStatus(
      req.params.id,
      req.user.id,
      req.user.orgId
    );
    
    if (!status) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No incomplete inspection found for this inspection ID and user',
        inspectionId: req.params.id
      });
    }
    
    res.json(
      serializeBigInt({
        message: 'Incomplete inspection status retrieved successfully',
        data: status
      })
    );
  } catch (error) {
    console.error('[GET /:id/incomplete-status] Error:', error);
    handleError(res, error, 'fetch incomplete inspection status');
  }
});

// GET resume data for incomplete inspection (answers and current section)
router.get('/:id/resume-data', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    
    console.log(`[GET /:id/resume-data] Inspection ID: ${req.params.id}, User ID: ${req.user.id}`);
    
    // Verify inspection access
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );
    
    // Get incomplete status
    const status = await getIncompleteInspectionStatus(
      req.params.id,
      req.user.id,
      req.user.orgId
    );
    
    if (!status) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No incomplete inspection found for this inspection ID and user',
        inspectionId: req.params.id
      });
    }
    
    // Get the incomplete answer with all data
    const incompleteAnswer = await prisma.InspectionAnswer.findUnique({
      where: {
        id: BigInt(status.answerId)
      },
      select: {
        id: true,
        answers: true,
        status: true,
        answeredBy: true,
        answeredAt: true,
        updatedAt: true
      }
    });
    
    if (!incompleteAnswer) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Answer record not found',
        answerId: status.answerId
      });
    }
    
    // Get template sections
    let sections = {};
    let sectionOrder = [];
    
    try {
      const templateInfo = await getTemplateAndSections(inspection);
      sections = templateInfo.sections;
      sectionOrder = Object.keys(sections).sort((a, b) => sections[a].order - sections[b].order);
    } catch (error) {
      console.warn('Could not get template sections:', error.message);
    }
    
    // Extract answers by section
    const answerData = incompleteAnswer.answers || {};
    const sectionData = answerData.data || answerData;
    
    res.json(
      serializeBigInt({
        message: 'Resume data retrieved successfully',
        data: {
          inspection: {
            id: inspection.id.toString(),
            title: inspection.title,
            type: inspection.type,
            status: inspection.status
          },
          answer: {
            id: incompleteAnswer.id.toString(),
            status: incompleteAnswer.status,
            answeredBy: incompleteAnswer.answeredBy?.toString(),
            answeredAt: incompleteAnswer.answeredAt,
            lastUpdatedAt: incompleteAnswer.updatedAt
          },
          answers: sectionData,
          metadata: answerData.metadata || null,
          remarks: answerData.remarks || null,
          signatures: answerData.signatures || null,
          progress: status.progress,
          lastCompletedSection: status.lastCompletedSection,
          nextSection: status.nextSection,
          sectionOrder: sectionOrder,
          sections: sections,
          canContinue: status.canContinue
        }
      })
    );
  } catch (error) {
    console.error('[GET /:id/resume-data] Error:', error);
    handleError(res, error, 'fetch resume data');
  }
});

// =============================================================================
// SECTION BY SECTION INSPECTION FLOW
// =============================================================================
// GET inspection template with sections
router.get('/:id/template', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );
    const { template, sections } = await getTemplateAndSections(inspection);

    // Get device information if available
    let deviceInfo = null;
    if (inspection.deviceId) {
      const device = await prisma.Device.findUnique({
        where: { id: inspection.deviceId },
        select: {
          id: true,
          serialNumber: true,
          assetTag: true,
          metadata: true,
          model: {
            select: { id: true, manufacturer: true, model: true, deviceType: true, specs: true },
          },
          organization: { select: { id: true, name: true, code: true } },
          site: { select: { id: true, name: true } },
        },
      });

      deviceInfo = formatDeviceInfo(device);
    }

    // Parse questions if it's a string to ensure Flutter app receives it as an array/object
    // Also handle case where questions might already be parsed but wrapped in an extra array
    let parsedQuestions = typeof template.questions === 'string'
      ? JSON.parse(template.questions)
      : template.questions;
    
    // If parsedQuestions is an array with a single element that is also an array, unwrap it
    // This handles cases where questions was double-wrapped: [[{...}]] -> [{...}]
    if (Array.isArray(parsedQuestions) && parsedQuestions.length === 1 && Array.isArray(parsedQuestions[0])) {
      parsedQuestions = parsedQuestions[0];
    }

    return res.json({
      message: 'Inspection template retrieved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        inspection: {
          id: inspection.id.toString(),
          title: inspection.title,
          type: inspection.type,
        },
        template: { ...template, id: template.id.toString(), questions: parsedQuestions },
        device: deviceInfo,
        sections: sections,
        totalSections: Object.keys(sections).length,
        totalQuestions: Object.values(sections).reduce(
          (total, section) => total + section.questions.length,
          0
        ),
      },
    });
  } catch (error) {
    handleError(res, error, 'fetch inspection template');
  }
});

// GET current section questions for an inspection
router.get(
  '/:id/section/:sectionName/questions',
  authMiddleware,
  async (req, res) => {
    try {
      const inspectionId = BigInt(req.params.id);
      const sectionName = req.params.sectionName;
      const inspection = await verifyInspectionAccess(
        inspectionId,
        req.user.id,
        req.user.orgId
      );
      const { template, sections } = await getTemplateAndSections(inspection);
      const sectionData = sections[sectionName];

      if (!sectionData) {
        return res.status(404).json({
          error: 'Section not found',
          message: `Section '${sectionName}' does not exist in this inspection template`,
          availableSections: Object.keys(sections),
        });
      }

      const existingAnswers = await getSectionAnswers(
        inspectionId,
        sectionName
      );

      return res.json({
        message: `Questions for section '${sectionName}' retrieved successfully`,
        data: {
          inspectionId: inspection.id.toString(),
          section: {
            name: sectionName,
            title: sectionData.title,
            order: sectionData.order,
            questions: sectionData.questions,
            totalQuestions: sectionData.questions.length,
          },
          existingAnswers: existingAnswers,
          hasExistingAnswers: Object.keys(existingAnswers).length > 0,
        },
      });
    } catch (error) {
      handleError(res, error, 'fetch section questions');
    }
  }
);

// GET section review (current section questions and answers for verification)
router.get(
  '/:id/section/:sectionName/review',
  authMiddleware,
  async (req, res) => {
    try {
      const inspectionId = BigInt(req.params.id);
      const sectionName = req.params.sectionName;
      const inspection = await verifyInspectionAccess(
        inspectionId,
        req.user.id,
        req.user.orgId
      );
      const { template, sections } = await getTemplateAndSections(inspection);
      const currentSection = sections[sectionName];

      if (!currentSection) {
        return res.status(404).json({
          error: 'Section not found',
          message: `Section '${sectionName}' does not exist in this inspection template`,
          availableSections: Object.keys(sections),
        });
      }

      const sectionAnswers = await getSectionAnswers(inspectionId, sectionName);
      const questionsWithAnswers = currentSection.questions.map(question => {
        const answer = sectionAnswers[question.id] || {};
        return {
          id: question.id,
          question: question.question,
          type: question.type,
          options: question.options,
          textRequired: question.textRequired,
          imageRequired: question.imageRequired,
          answer: {
            status: answer.status || '',
            comment: answer.comment || '',
            images: answer.images || [],
          },
          hasAnswer: !!answer.status,
        };
      });

      const sectionOrder = Object.keys(sections).sort(
        (a, b) => sections[a].order - sections[b].order
      );
      const currentIndex = sectionOrder.indexOf(sectionName);
      const nextSection =
        currentIndex < sectionOrder.length - 1
          ? sectionOrder[currentIndex + 1]
          : null;

      return res.json({
        message: `Section '${sectionName}' review data retrieved successfully`,
        data: {
          inspectionId: inspection.id.toString(),
          section: {
            name: sectionName,
            title: currentSection.title,
            order: currentSection.order,
            isLast: currentIndex === sectionOrder.length - 1,
          },
          questionsWithAnswers: questionsWithAnswers,
          totalQuestions: questionsWithAnswers.length,
          answeredQuestions: questionsWithAnswers.filter(q => q.hasAnswer)
            .length,
          nextSection: nextSection,
          sectionOrder: sectionOrder,
          currentIndex: currentIndex,
          totalSections: sectionOrder.length,
          progress: {
            current: currentIndex + 1,
            total: sectionOrder.length,
            percentage: Math.round(
              ((currentIndex + 1) / sectionOrder.length) * 100
            ),
          },
        },
      });
    } catch (error) {
      handleError(res, error, 'fetch section review');
    }
  }
);

// POST section confirmation (confirm current section and proceed to next)
router.post(
  '/:id/section/:sectionName/confirm',
  authMiddleware,
  async (req, res) => {
    try {
      const inspectionId = BigInt(req.params.id);
      const sectionName = req.params.sectionName;
      const inspection = await verifyInspectionAccess(
        inspectionId,
        req.user.id,
        req.user.orgId
      );
      const { template, sections } = await getTemplateAndSections(inspection);

      const sectionOrder = Object.keys(sections).sort(
        (a, b) => sections[a].order - sections[b].order
      );
      const currentIndex = sectionOrder.indexOf(sectionName);
      const nextSection =
        currentIndex < sectionOrder.length - 1
          ? sectionOrder[currentIndex + 1]
          : null;
      const isLastSection = currentIndex === sectionOrder.length - 1;

      // Mark section as confirmed/completed
      const result = await prisma.$transaction(async tx => {
        const existingAnswers = await tx.inspectionAnswer.findFirst({
          where: { inspectionId },
          orderBy: { answeredAt: 'desc' },
        });

        let existingData = {};
        if (existingAnswers && existingAnswers.answers) {
          const answerData = existingAnswers.answers;
          existingData = answerData.data || answerData; // Support both formats
        }

        // Mark current section as confirmed
        if (existingData[sectionName]) {
          existingData[sectionName].confirmed = true;
          existingData[sectionName].confirmedAt = new Date().toISOString();
        }

        const sectionAnswers = { data: existingData };
        const sectionAnswer = await tx.inspectionAnswer.create({
          data: {
            inspectionId: inspectionId,
            answers: sectionAnswers,
            answeredBy: BigInt(req.user.id),
            answeredAt: new Date(),
          },
        });

        // Update inspection progress
        const progressPercentage = Math.round(
          ((currentIndex + 1) / sectionOrder.length) * 100
        );
        const updatedInspection = await tx.inspection.update({
          where: { id: inspectionId },
          data: {
            progress: progressPercentage,
            status: isLastSection ? 'SUBMITTED' : 'IN_PROGRESS',
            completedAt: isLastSection ? new Date() : undefined,
            updatedBy: BigInt(req.user.id),
          },
          select: { id: true, status: true, progress: true, completedAt: true },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            tableId: 'inspection_section_confirm',
            recordId: inspectionId,
            action: 'UPDATE',
            newData: {
              section: sectionName,
              confirmed: true,
              status: updatedInspection.status,
              progress: updatedInspection.progress,
              isLastSection: isLastSection,
            },
            userId: BigInt(req.user.id),
          },
        });

        return { sectionAnswer, updatedInspection };
      });

      return res.json({
        message: `Section '${sectionName}' confirmed successfully`,
        data: {
          inspectionId: inspection.id.toString(),
          section: sectionName,
          nextSection: nextSection,
          isLastSection: isLastSection,
          isInspectionComplete: isLastSection,
          sectionOrder: sectionOrder,
          currentIndex: currentIndex,
          totalSections: sectionOrder.length,
          progress: {
            current: currentIndex + 1,
            total: sectionOrder.length,
            percentage: Math.round(
              ((currentIndex + 1) / sectionOrder.length) * 100
            ),
          },
          inspection: {
            status: result.updatedInspection.status,
            progress: result.updatedInspection.progress,
            completedAt: result.updatedInspection.completedAt,
          },
        },
      });
    } catch (error) {
      handleError(res, error, 'confirm section');
    }
  }
);

// GET next section after completing current one
router.get(
  '/:id/next-section/:currentSection',
  authMiddleware,
  async (req, res) => {
    try {
      const inspectionId = BigInt(req.params.id);
      const currentSection = req.params.currentSection;
      const inspection = await verifyInspectionAccess(
        inspectionId,
        req.user.id,
        req.user.orgId
      );
      const { template, sections } = await getTemplateAndSections(inspection);

      const sectionOrder = Object.keys(sections).sort(
        (a, b) => sections[a].order - sections[b].order
      );
      const currentIndex = sectionOrder.indexOf(currentSection);
      const nextSection =
        currentIndex < sectionOrder.length - 1
          ? sectionOrder[currentIndex + 1]
          : null;
      const completedSections = await getCompletedSections(inspectionId);

      return res.json({
        message: 'Next section information retrieved successfully',
        data: {
          inspectionId: inspection.id.toString(),
          currentSection: currentSection,
          nextSection: nextSection,
          isLastSection: currentIndex === sectionOrder.length - 1,
          isInspectionComplete: nextSection === null,
          progress: {
            current: currentIndex + 1,
            total: sectionOrder.length,
            percentage: Math.round(
              ((currentIndex + 1) / sectionOrder.length) * 100
            ),
          },
          completedSections: completedSections,
          sectionOrder: sectionOrder,
          navigation: {
            canGoToPrevious: currentIndex > 0,
            canGoToNext: nextSection !== null,
            previousSection:
              currentIndex > 0 ? sectionOrder[currentIndex - 1] : null,
            nextSection: nextSection,
          },
        },
      });
    } catch (error) {
      handleError(res, error, 'fetch next section');
    }
  }
);

// =============================================================================
// SECTION ANSWER ROUTES - SECTION BY SECTION SAVING
// =============================================================================

// GET section status for an inspection
router.get('/:id/section-status', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );
    const sectionAnswers = await prisma.InspectionAnswer.findMany({
      where: { inspectionId },
      orderBy: { answeredAt: 'desc' }, // Get latest first
      select: { id: true, answers: true, answeredBy: true, answeredAt: true },
    });

    // Extract section statuses
    const sectionStatuses = {};
    sectionAnswers.forEach(answer => {
      const answerData = answer.answers;
      if (answerData && answerData.sectionStatus) {
        const sectionName = answerData.section || 'unknown';
        sectionStatuses[sectionName] = {
          status: answerData.sectionStatus,
          completedAt: answerData.completedAt,
          answeredAt: answer.answeredAt,
          answeredBy: answer.answeredBy?.toString(),
        };
      }
    });

    return res.json({
      message: 'Section status retrieved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        sectionStatuses,
        totalSections: Object.keys(sectionStatuses).length,
        completedSections: Object.values(sectionStatuses).filter(
          s => s.status === 'COMPLETED'
        ).length,
        inProgressSections: Object.values(sectionStatuses).filter(
          s => s.status === 'IN_PROGRESS'
        ).length,
        skippedSections: Object.values(sectionStatuses).filter(
          s => s.status === 'SKIPPED'
        ).length,
      },
    });
  } catch (error) {
    handleError(res, error, 'fetch section status');
  }
});

// GET section review (show questions and answers for verification)
router.get('/:id/section-review/:section', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const section = req.params.section;
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    const allAnswers = await prisma.InspectionAnswer.findMany({
      where: { inspectionId: inspectionId },
      orderBy: { answeredAt: 'desc' }, // Get latest first
      select: { id: true, answers: true, answeredBy: true, answeredAt: true },
    });

    // Filter answers that contain the specific section
    const sectionAnswers = allAnswers.filter(answer => {
      const answerData = answer.answers || {};
      const sectionData = answerData.data || answerData; // Support both formats
      return sectionData[section];
    });

    console.log(
      `Section review for inspection ${inspectionId}, section '${section}':`,
      {
        totalAnswers: allAnswers.length,
        sectionAnswers: sectionAnswers.length,
        availableSections: allAnswers
          .map(a => {
            const data = a.answers?.data || a.answers;
            return data
              ? Object.keys(data).filter(key => key !== 'metadata')
              : [];
          })
          .flat(),
        requestedSection: section,
      }
    );

    if (sectionAnswers.length === 0) {
      return res.status(404).json({
        error: 'Section not found',
        message: `No answers found for section '${section}'`,
        debug: {
          totalAnswers: allAnswers.length,
          availableSections: allAnswers
            .map(a => {
              const data = a.answers?.data || a.answers;
              return data
                ? Object.keys(data).filter(key => key !== 'metadata')
                : [];
            })
            .flat(),
          requestedSection: section,
        },
      });
    }

    // Get the latest answer (now first in array)
    const latestAnswer = sectionAnswers[0];
    const answerData = latestAnswer.answers || {};
    const sectionData = (answerData.data || answerData)[section] || {};

    // Extract questions and answers for review
    const questionAnswerPairs = [];
    const excludedKeys = [
      'sectionStatus',
      'completedAt',
      'section',
      'sessionStartedAt',
      'lastUpdatedAt',
    ];

    Object.entries(sectionData).forEach(([key, value]) => {
      if (!excludedKeys.includes(key)) {
        let questionText = key;
        let answerText = value;
        let images = [];
        let additionalInfo = {};

        if (typeof value === 'object' && value !== null) {
          questionText = value.question || value.questionText || key;
          answerText =
            value.answer ||
            value.answerText ||
            value.value ||
            JSON.stringify(value);
          images = value.images || value.photos || [];
          additionalInfo = {
            type: value.type || 'text',
            required: value.required || false,
            options: value.options || [],
            notes: value.notes || '',
            timestamp: value.timestamp || null,
          };
        }

        questionAnswerPairs.push({
          questionId: key,
          questionText: questionText,
          answerText: answerText,
          images: images,
          additionalInfo: additionalInfo,
          rawValue: value,
        });
      }
    });

    const reviewData = {
      section: section,
      questionAnswerPairs: questionAnswerPairs,
      inspectionMetadata: answerData.metadata || null,
      metadata: {
        answeredAt: latestAnswer.answeredAt,
        answeredBy: latestAnswer.answeredBy?.toString(),
        sectionStatus: answerData.sectionStatus || 'IN_PROGRESS',
        completedAt: answerData.completedAt || null,
        totalQuestions: questionAnswerPairs.length,
        sessionStartedAt: answerData.sessionStartedAt,
        lastUpdatedAt: answerData.lastUpdatedAt,
      },
    };

    return res.json({
      message: `Section '${section}' review data retrieved successfully`,
      data: {
        inspectionId: inspection.id.toString(),
        review: reviewData,
        summary: {
          section: section,
          totalQuestions: reviewData.metadata.totalQuestions,
          status: reviewData.metadata.sectionStatus,
          answeredAt: reviewData.metadata.answeredAt,
          isCompleted: reviewData.metadata.sectionStatus === 'COMPLETED',
          sessionStartedAt: reviewData.metadata.sessionStartedAt,
          lastUpdatedAt: reviewData.metadata.lastUpdatedAt,
        },
      },
    });
  } catch (error) {
    handleError(res, error, 'fetch section review');
  }
});

// GET section answers for an inspection
router.get('/:id/section-answers', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );
    const sectionAnswers = await prisma.InspectionAnswer.findMany({
      where: { inspectionId },
      orderBy: { answeredAt: 'desc' }, // Get latest first
      select: {
        id: true,
        answers: true,
        answeredBy: true,
        answeredAt: true,
        createdAt: true,
      },
    });

    // Group answers by session
    const groupedAnswers = {};
    sectionAnswers.forEach(answer => {
      const answerData = answer.answers;
      if (answerData) {
        const sessionId = answer.id.toString();
        const sections = answerData.data || answerData; // Support both formats
        const allSections = Object.keys(sections).filter(
          key => key !== 'metadata'
        );

        // Count total questions across all sections
        let totalQuestions = 0;
        allSections.forEach(sectionName => {
          if (sections[sectionName]) {
            totalQuestions += Object.keys(sections[sectionName]).length;
          }
        });

        groupedAnswers[sessionId] = {
          sessionId: sessionId,
          sessionStartedAt: answerData.sessionStartedAt,
          lastUpdatedAt: answerData.lastUpdatedAt,
          answeredBy: answer.answeredBy?.toString(),
          answeredAt: answer.answeredAt,
          sections: allSections,
          sectionData: sections,
          metadata: answerData.metadata || null,
          totalQuestions: totalQuestions,
          totalSections: allSections.length,
        };
      }
    });

    console.log(`Retrieved section answers for inspection ${inspectionId}:`, {
      totalSessions: Object.keys(groupedAnswers).length,
      totalAnswers: sectionAnswers.length,
      sessions: Object.keys(groupedAnswers),
    });

    return res.json({
      message: 'Section answers retrieved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        sessions: groupedAnswers,
        totalSessions: Object.keys(groupedAnswers).length,
        totalAnswers: sectionAnswers.length,
        summary: {
          message: `Found ${Object.keys(groupedAnswers).length} inspection session(s) with ${sectionAnswers.length} total answer record(s)`,
          note: 'All section answers are organized by sections with separate metadata storage.',
        },
      },
    });
  } catch (error) {
    handleError(res, error, 'fetch section answers');
  }
});

// POST initialize inspection metadata (called before starting first section)
router.post('/initialize-metadata', authMiddleware, async (req, res) => {
  try {
    console.log('=== Initialize Metadata Request ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { date, inspector, location, scale_id_serial_no, model, deviceId } =
      req.body.data || req.body;

    return res.json({
      message: 'Metadata received - will be saved with first section',
      data: {
        metadata: { date, inspector, location, scale_id_serial_no, model },
        note: 'Send this metadata along with first section answers',
      },
    });
  } catch (error) {
    handleError(res, error, 'initialize metadata');
  }
});

// POST save signatures for inspection
router.post('/:id/signatures', authMiddleware, async (req, res) => {
  try {
    console.log('=== Save Signatures Request ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const inspectionId = BigInt(req.params.id);
    const { signatures } = req.body.data || req.body;

    if (!signatures || typeof signatures !== 'object') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'signatures field is required and must be an object',
      });
    }

    // Verify inspection access
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // Find the main inspection answer record (latest first)
    const mainAnswer = await prisma.InspectionAnswer.findFirst({
      where: {
        inspectionId,
        answers: {
          path: '$.data',
          not: null,
        },
      },
      orderBy: { answeredAt: 'desc' }, // Get latest first
    });

    if (!mainAnswer) {
      return res.status(404).json({
        error: 'Not Found',
        message:
          'Main inspection record not found. Please save sections first.',
      });
    }

    // Update the main record with signatures
    const existingAnswers = mainAnswer.answers || {};
    const updatedAnswers = {
      ...existingAnswers,
      signatures: signatures,
    };

    const updatedAnswer = await prisma.InspectionAnswer.update({
      where: { id: mainAnswer.id },
      data: {
        answers: updatedAnswers,
        answeredBy: BigInt(req.user.id),
        answeredAt: new Date(),
        status: 'COMPLETED',
      },
    });

    console.log(`Updated main record ${updatedAnswer.id} with signatures (status: COMPLETED)`);

    return res.json({
      message: 'Signatures saved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        answerId: updatedAnswer.id.toString(),
        signatures: signatures,
        savedAt: updatedAnswer.answeredAt,
      },
    });
  } catch (error) {
    handleError(res, error, 'save signatures');
  }
});

// GET latest answer ID for inspection
router.get('/:id/latest-answer-id', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // Find the latest inspection answer with sections data
    const latestAnswer = await prisma.InspectionAnswer.findFirst({
      where: {
        inspectionId,
        answers: {
          path: '$.metadata',
          not: null,
        },
      },
      orderBy: {
        answeredAt: 'desc',
      },
    });

    if (latestAnswer) {
      res.json({ answerId: latestAnswer.id.toString() });
    } else {
      res.json({ answerId: null });
    }
  } catch (error) {
    handleError(res, error, 'get latest answer ID');
  }
});

// GET test endpoint to check remarks and signatures
router.get('/:id/test-data', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // Get all answers for this inspection
    const answers = await prisma.InspectionAnswer.findMany({
      where: { inspectionId },
      orderBy: { answeredAt: 'asc' },
      select: { id: true, answers: true, answeredBy: true, answeredAt: true },
    });

    // Extract remarks and signatures from all answers (latest first)
    // Reverse array to process latest first
    const reversedAnswers = [...answers].reverse();
    let extractedRemarks = null;
    let extractedSignatures = null;
    let extractedMetadata = null;

    reversedAnswers.forEach(answer => {
      const answerData = answer.answers || {};

      // Check for metadata
      if (answerData.metadata) {
        extractedMetadata = answerData.metadata;
      }

      // Check for remarks
      if (answerData.remarks) {
        extractedRemarks = answerData.remarks;
      }

      // Check for signatures
      if (answerData.signatures) {
        extractedSignatures = answerData.signatures;
      }

      // Check data wrapper
      if (answerData.data) {
        if (answerData.data.remarks) {
          extractedRemarks = answerData.data.remarks;
        }
        if (answerData.data.signatures) {
          extractedSignatures = answerData.data.signatures;
        }
        if (answerData.data.metadata) {
          extractedMetadata = answerData.data.metadata;
        }
      }
    });

    return res.json({
      message: 'Test data retrieved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        totalAnswers: answers.length,
        extractedMetadata: extractedMetadata,
        extractedRemarks: extractedRemarks,
        extractedSignatures: extractedSignatures,
        allAnswers: answers.map(a => ({
          id: a.id.toString(),
          answeredAt: a.answeredAt,
          hasMetadata: !!a.answers?.metadata,
          hasRemarks: !!a.answers?.remarks,
          hasSignatures: !!a.answers?.signatures,
          hasDataWrapper: !!a.answers?.data,
        })),
      },
    });
  } catch (error) {
    handleError(res, error, 'get test data');
  }
});

// POST save signature image (for Flutter signature pad)
router.post('/:id/signature-image', authMiddleware, async (req, res) => {
  try {
    console.log('=== Save Signature Image Request ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const inspectionId = BigInt(req.params.id);
    const {
      signatureImage,
      signatureType = 'inspector',
      answerId,
    } = req.body.data || req.body;

    if (!signatureImage) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'signatureImage field is required',
      });
    }

    // Verify inspection access
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // If answerId is provided, use that specific record
    if (answerId) {
      const targetAnswer = await prisma.InspectionAnswer.findFirst({
        where: {
          id: BigInt(answerId),
          inspectionId,
        },
      });

      if (targetAnswer) {
        console.log(
          '🔍 Found target answer record for signature image:',
          targetAnswer.id.toString()
        );

        const existingAnswers = targetAnswer.answers || {};
        const existingSignatures = existingAnswers.signatures || {};

        const updatedSignatures = {
          ...existingSignatures,
          [signatureType]: signatureImage,
        };

        const updatedAnswers = {
          ...existingAnswers,
          signatures: updatedSignatures,
        };

        const updatedAnswer = await prisma.InspectionAnswer.update({
          where: { id: targetAnswer.id },
          data: {
            answers: updatedAnswers,
            answeredBy: BigInt(req.user.id),
            answeredAt: new Date(),
            status: 'COMPLETED',
          },
        });

        console.log(
          `Updated target record ${updatedAnswer.id} with signature image (status: COMPLETED)`
        );

        return res.json({
          message: 'Signature image saved successfully',
          data: {
            inspectionId: inspection.id.toString(),
            answerId: updatedAnswer.id.toString(),
            signatureType: signatureType,
            signatureImage: signatureImage,
            savedAt: updatedAnswer.answeredAt,
          },
        });
      } else {
        console.log(
          '⚠️ Target answer record not found, falling back to main record search'
        );
      }
    }

    // Find the main inspection answer record
    // First try to find record with data field
    let mainAnswer = await prisma.InspectionAnswer.findFirst({
      where: {
        inspectionId,
        answers: {
          path: '$.data',
          not: null,
        },
      },
      orderBy: { answeredAt: 'asc' },
    });

    // If not found, try to find record with multiple sections (jbox, sensor, exterior, etc.)
    if (!mainAnswer) {
      const sectionPaths = [
        '$.jbox',
        '$.sensor',
        '$.exterior',
        '$.indicator',
        '$.foundation',
        '$.cleanliness',
      ];

      for (const path of sectionPaths) {
        mainAnswer = await prisma.InspectionAnswer.findFirst({
          where: {
            inspectionId,
            answers: {
              path: path,
              not: null,
            },
          },
          orderBy: { answeredAt: 'asc' },
        });

        if (mainAnswer) {
          console.log(`🔍 Found main record with ${path} section`);
          break;
        }
      }
    }

    // If still not found, try to find record with metadata
    if (!mainAnswer) {
      mainAnswer = await prisma.InspectionAnswer.findFirst({
        where: {
          inspectionId,
          answers: {
            path: '$.metadata',
            not: null,
          },
        },
        orderBy: { answeredAt: 'asc' },
      });
    }

    console.log(
      '🔍 Found main answer record for signature image:',
      mainAnswer ? mainAnswer.id.toString() : 'NOT FOUND'
    );

    if (!mainAnswer) {
      // Try to find any record for this inspection (latest first)
      const anyAnswer = await prisma.InspectionAnswer.findFirst({
        where: { inspectionId },
        orderBy: { answeredAt: 'desc' }, // Get latest first
      });

      console.log(
        '🔍 Any answer record found for signature image:',
        anyAnswer ? anyAnswer.id.toString() : 'NOT FOUND'
      );

      if (!anyAnswer) {
        return res.status(404).json({
          error: 'Not Found',
          message:
            'No inspection record found for this inspection ID. Please save sections first.',
        });
      }

      // Use the first available record
      const existingAnswers = anyAnswer.answers || {};
      const existingSignatures = existingAnswers.signatures || {};

      const updatedSignatures = {
        ...existingSignatures,
        [signatureType]: signatureImage,
      };

      const updatedAnswers = {
        ...existingAnswers,
        signatures: updatedSignatures,
      };

      const updatedAnswer = await prisma.InspectionAnswer.update({
        where: { id: anyAnswer.id },
        data: {
          answers: updatedAnswers,
          answeredBy: BigInt(req.user.id),
          answeredAt: new Date(),
          status: 'COMPLETED',
        },
      });

      console.log(`Updated record ${updatedAnswer.id} with signature image (status: COMPLETED)`);

      return res.json({
        message: 'Signature image saved successfully',
        data: {
          inspectionId: inspection.id.toString(),
          answerId: updatedAnswer.id.toString(),
          signatureType: signatureType,
          signatureImage: signatureImage,
          savedAt: updatedAnswer.answeredAt,
        },
      });
    }

    // Clean up any existing separate signatures records
    await prisma.InspectionAnswer.deleteMany({
      where: {
        inspectionId,
        answers: {
          path: '$.signatures',
          not: null,
        },
        id: {
          not: mainAnswer.id,
        },
      },
    });

    // Update the main record with signature image
    const existingAnswers = mainAnswer.answers || {};
    const existingSignatures = existingAnswers.signatures || {};

    console.log(
      '🔍 Existing answers before signature update:',
      JSON.stringify(existingAnswers, null, 2)
    );

    const updatedSignatures = {
      ...existingSignatures,
      [signatureType]: signatureImage,
    };

    const updatedAnswers = {
      ...existingAnswers,
      signatures: updatedSignatures,
    };

    console.log(
      '🔍 Updated answers with signature:',
      JSON.stringify(updatedAnswers, null, 2)
    );

    const updatedAnswer = await prisma.InspectionAnswer.update({
      where: { id: mainAnswer.id },
      data: {
        answers: updatedAnswers,
        answeredBy: BigInt(req.user.id),
        answeredAt: new Date(),
        status: 'COMPLETED',
      },
    });

    console.log(`Updated main record ${updatedAnswer.id} with signature image (status: COMPLETED)`);
    console.log(
      '🔍 Final saved answers:',
      JSON.stringify(updatedAnswer.answers, null, 2)
    );

    return res.json({
      message: 'Signature image saved successfully',
      data: {
        inspectionId: inspection.id.toString(),
        answerId: updatedAnswer.id.toString(),
        signatureType: signatureType,
        signatureImage: signatureImage,
        savedAt: updatedAnswer.answeredAt,
      },
    });
  } catch (error) {
    handleError(res, error, 'save signature image');
  }
});

// POST upload images via HTTP multipart (ngrok-compatible)
router.post('/:id/upload-images', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    console.log('=== Upload Images via HTTP Multipart ===');
    console.log('Inspection ID:', req.params.id);
    console.log('Files received:', req.files?.length || 0);
    console.log('Body fields:', Object.keys(req.body));

    const inspectionId = BigInt(req.params.id);
    const { answerId, fieldId, section, questionText } = req.body;

    // Validate required fields
    if (!answerId || !fieldId || !section) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'answerId, fieldId, and section are required',
      });
    }

    if (!req.files || req.files.length === 0) {
      console.error('❌ No files received in req.files');
      console.error('   req.files:', req.files);
      console.error('   req.body:', req.body);
      console.error('   Content-Type:', req.headers['content-type']);
      return res.status(400).json({
        error: 'Validation Error',
        message: 'At least one image file is required',
        debug: {
          filesReceived: req.files?.length || 0,
          bodyKeys: Object.keys(req.body),
          contentType: req.headers['content-type'],
        },
      });
    }

    const answerIdBigInt = BigInt(answerId);

    // Verify inspection access
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // Verify that answer belongs to this inspection
    const answer = await prisma.InspectionAnswer.findFirst({
      where: {
        id: answerIdBigInt,
        inspectionId: inspectionId,
      },
    });

    if (!answer) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Answer not found for this inspection',
      });
    }

    console.log(`✅ Inspection ${inspectionId} verified, answer ${answerIdBigInt} found`);

    // Process uploaded files
    console.log(`📦 Processing ${req.files.length} uploaded file(s)`);
    
    // Rename files to correct format: inspection_{id}_ans_{answerId}_field_{fieldId}_{timestamp}_{order}.jpg
    const FTP_BASE_URL = process.env.FTP_BASE_URL || 'ftp://192.168.1.35';
    const FTP_REMOTE_PREFIX = process.env.FTP_REMOTE_PREFIX || 'test';
    const timestamp = Date.now();
    
    const uploadedImages = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const oldFilePath = file.path;
      const ext = path.extname(file.originalname) || '.jpg';
      
      // Generate new filename in correct format
      const newFileName = `inspection_${inspectionId}_ans_${answerId}_field_${fieldId}_${timestamp}_${i}${ext}`;
      const newFilePath = path.join(FTP_STORAGE_PATH, newFileName);
      
      // Rename file to correct format
      try {
        if (fs.existsSync(oldFilePath)) {
          fs.renameSync(oldFilePath, newFilePath);
          console.log(`✅ Renamed file: ${file.filename} -> ${newFileName}`);
        } else {
          console.error(`❌ Old file not found: ${oldFilePath}`);
          continue;
        }
      } catch (renameError) {
        console.error(`❌ Error renaming file: ${renameError.message}`);
        continue;
      }
      
      // Build FTP URL in format: ftp://192.168.1.35/test/{filename}
      const imageUrl = `${FTP_BASE_URL}/${FTP_REMOTE_PREFIX}/${newFileName}`;

      console.log(`  📸 Image ${i + 1}:`);
      console.log(`     Filename: ${newFileName}`);
      console.log(`     Saved to: ${newFilePath}`);
      console.log(`     Size: ${file.size} bytes`);
      console.log(`     URL: ${imageUrl}`);
      
      // Verify file actually exists
      if (fs.existsSync(newFilePath)) {
        console.log(`     ✅ File exists at: ${newFilePath}`);
      } else {
        console.error(`     ❌ File NOT found at: ${newFilePath}`);
        continue;
      }

      uploadedImages.push({
        order: i + 1,
        fileName: newFileName,
        fileSize: file.size,
        relativePath: `/${newFileName}`,
        imageUrl: imageUrl,
        mimeType: file.mimetype,
        filePath: newFilePath,
      });
    }

    // Save images directly to inspection_question_images table using raw SQL
    const savedImages = [];
    const userId = BigInt(req.user.id);
    
    for (let i = 0; i < uploadedImages.length; i++) {
      const img = uploadedImages[i];
      const imageOrder = i + 1;
      
      try {
        console.log(`💾 Saving image ${imageOrder} to database:`, {
          inspectionId: inspectionId.toString(),
          answerId: answerIdBigInt.toString(),
          fieldId: fieldId,
          section: section,
          imageOrder: imageOrder,
          imageUrl: img.imageUrl,
        });
        
        // Insert into inspection_question_images table
        // Note: inspection_question_images table does NOT have inspection_id column
        await prisma.$executeRaw`
          INSERT INTO inspection_question_images (
            answer_id,
            field_id,
            section,
            image_order,
            image_url,
            uploaded_by,
            uploaded_at,
            created_at,
            updated_at
          ) VALUES (
            ${answerIdBigInt},
            ${fieldId},
            ${section},
            ${imageOrder},
            ${img.imageUrl},
            ${userId},
            NOW(),
            NOW(),
            NOW()
          )
        `;
        
        console.log(`✅ Database INSERT successful for image ${imageOrder}`);
        
        // Get the inserted ID
        const result = await prisma.$queryRaw`
          SELECT id 
          FROM inspection_question_images 
          WHERE answer_id = ${answerIdBigInt}
            AND field_id = ${fieldId}
            AND image_order = ${imageOrder}
          ORDER BY id DESC 
          LIMIT 1
        `;
        
        const imageId = result?.[0]?.id ? result[0].id.toString() : null;
        
        console.log(`✅ Retrieved image ID: ${imageId}`);
        
        savedImages.push({
          id: imageId,
          fileName: img.fileName,
          fileSize: img.fileSize,
          mimeType: img.mimeType,
          relativePath: img.relativePath,
          imageUrl: img.imageUrl,
          order: imageOrder,
        });
        
        console.log(`✅ Successfully saved image ${imageOrder} to database (ID: ${imageId}, URL: ${img.imageUrl})`);
      } catch (imageError) {
        console.error(`❌ Error saving image ${imageOrder} to database:`, imageError);
        console.error(`   Error details:`, {
          message: imageError.message,
          code: imageError.code,
          stack: imageError.stack,
        });
        // Continue with other images
      }
    }

    console.log(`✅ Successfully uploaded and saved ${savedImages.length}/${uploadedImages.length} images`);

    // If no images were saved, return error
    if (savedImages.length === 0) {
      console.error('❌ No images were saved to database!');
      console.error('   req.files length:', req.files?.length || 0);
      console.error('   uploadedImages length:', uploadedImages.length);
      return res.status(500).json({
        error: 'Upload Failed',
        message: 'No images were saved. Please check server logs.',
        debug: {
          filesReceived: req.files?.length || 0,
          processedImages: uploadedImages.length,
          savedImages: savedImages.length,
        },
      });
    }

    return res.status(201).json({
      message: 'Images uploaded successfully',
      data: {
        inspectionId: inspectionId.toString(),
        answerId: answerIdBigInt.toString(),
        fieldId: fieldId,
        section: section,
        uploadedImages: savedImages,
        totalImages: savedImages.length,
      },
    });
  } catch (error) {
    console.error('❌ Error uploading images:', error);
    handleError(res, error, 'upload images via HTTP');
  }
});

// POST upload question images (for Flutter app)
router.post('/:id/question-images', authMiddleware, async (req, res) => {
  try {
    console.log('=== Upload Question Images Request ===');
    console.log('Request params id:', req.params.id);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body fieldId:', req.body.fieldId);
    console.log('Request body section:', req.body.section);
    console.log('Request body questionText:', req.body.questionText);
    console.log('Request body images type:', typeof req.body.images);
    console.log(
      'Request body images is array:',
      Array.isArray(req.body.images)
    );
    console.log('Request body images length:', req.body.images?.length);

    if (req.body.images && req.body.images.length > 0) {
      console.log('First image data keys:', Object.keys(req.body.images[0]));
      console.log('First image has file:', !!req.body.images[0].file);
      console.log(
        'First image file length:',
        req.body.images[0].file?.length || 0
      );
      console.log('First image originalName:', req.body.images[0].originalName);
      console.log('First image mimeType:', req.body.images[0].mimeType);
      console.log('First image order:', req.body.images[0].order);
    }

    // Don't stringify full body as base64 strings are too long
    console.log('Full request body (summary):', {
      inspectionId: req.body.inspectionId,
      answerId: req.body.answerId,
      fieldId: req.body.fieldId,
      section: req.body.section,
      questionText: req.body.questionText,
      imagesCount: req.body.images?.length || 0,
    });

    const inspectionId = BigInt(req.params.id);
    const { fieldId, section, questionText, images, answerId } = req.body;

    if (
      !fieldId ||
      !section ||
      !images ||
      !Array.isArray(images) ||
      images.length === 0
    ) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'fieldId, section, and images array are required',
      });
    }

    // answerId is required now (since inspection_id column was removed)
    if (!answerId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'answerId is required',
      });
    }

    const answerIdBigInt = BigInt(answerId);

    // Verify inspection access and answer exists
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    // Verify that answer belongs to this inspection
    const answer = await prisma.InspectionAnswer.findFirst({
      where: {
        id: answerIdBigInt,
        inspectionId: inspectionId,
      },
    });

    if (!answer) {
      return res.status(400).json({
        error: 'Validation Error',
        message:
          'Invalid answerId: answer does not exist or does not belong to this inspection',
      });
    }

    // Check if inspection_question_images table exists and has answer_id column
    try {
      const tableCheck = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
        AND table_name = 'inspection_question_images'
      `;
      const tableExists = tableCheck[0]?.count > 0;

      if (!tableExists) {
        console.error('❌ inspection_question_images table does not exist!');
        console.error('Please create the table first using SQL script.');
        return res.status(500).json({
          error: 'Database Configuration Error',
          message:
            'The inspection_question_images table does not exist. Please create it first using the SQL script.',
        });
      }

      // Check if answer_id column exists
      const columnCheck = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE()
          AND table_name = 'inspection_question_images'
          AND column_name = 'answer_id'
      `;
      const columnExists = columnCheck[0]?.count > 0;

      if (!columnExists) {
        console.error(
          '❌ answer_id column does not exist in inspection_question_images table!'
        );
        console.error(
          'Please run the migration script to add answer_id column.'
        );
        return res.status(500).json({
          error: 'Database Configuration Error',
          message:
            'The answer_id column does not exist. Please run the migration script to add it.',
        });
      }

      // Check for UNIQUE constraint on (answer_id, field_id, image_order)
      const uniqueCheck = await prisma.$queryRaw`
        SELECT 
          CONSTRAINT_NAME,
          COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE table_schema = DATABASE()
          AND table_name = 'inspection_question_images'
          AND CONSTRAINT_NAME != 'PRIMARY'
          AND CONSTRAINT_NAME IN (
            SELECT CONSTRAINT_NAME
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE table_schema = DATABASE()
              AND table_name = 'inspection_question_images'
              AND CONSTRAINT_TYPE = 'UNIQUE'
          )
          AND COLUMN_NAME IN ('answer_id', 'field_id', 'image_order')
      `;

      console.log('🔍 UNIQUE constraints found:', uniqueCheck);

      if (!uniqueCheck || uniqueCheck.length === 0) {
        console.warn(
          '⚠️ No UNIQUE constraint found on (answer_id, field_id, image_order). ON DUPLICATE KEY UPDATE may not work correctly.'
        );
      }

      console.log('✅ Table and answer_id column verified');
    } catch (checkError) {
      console.error('Error checking table/column existence:', checkError);
      // Continue anyway, let the INSERT fail if table/column doesn't exist
    }

    const uploadedImages = [];
    const userId = BigInt(req.user.id);

    console.log(`📋 Processing ${images.length} image(s)`);
    for (const imageData of images) {
      const orderRaw = imageData.order ?? imageData.imageOrder;
      const orderInt = parseInt(orderRaw, 10);
      
      if (!Number.isFinite(orderInt) || orderInt <= 0) {
        console.warn('❌ Skipping image with invalid order value', {
          fieldId,
          order: orderRaw,
        });
        uploadedImages.push({
          fieldId,
          order: orderRaw,
          failed: true,
          error: 'Invalid image order',
        });
        continue;
      }

      // Check if we have base64 image data
      const base64Data = imageData.file || imageData.base64 || imageData.data;
      let savedFileName = null;
      let storedUrl = null;
      let normalizedPath = null;

      if (base64Data && typeof base64Data === 'string') {
        // We have base64 data - need to save it to C:/ftp_data
        try {
          console.log(`💾 Saving base64 image to C:/ftp_data for field ${fieldId}, order ${orderInt}`);
          
          // Generate unique filename
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const ext = imageData.mimeType?.includes('png') ? '.png' : 
                     imageData.mimeType?.includes('gif') ? '.gif' : 
                     imageData.mimeType?.includes('webp') ? '.webp' : '.jpg';
          
          savedFileName = `inspection_${inspectionId}_ans_${answerId}_field_${fieldId}_${uniqueSuffix}_${orderInt}${ext}`;
          const filePath = path.join(FTP_STORAGE_PATH, savedFileName);
          
          // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
          let base64String = base64Data;
          if (base64String.includes(',')) {
            base64String = base64String.split(',')[1];
          }
          
          // Decode base64 and save to file
          const imageBuffer = Buffer.from(base64String, 'base64');
          await fsPromises.writeFile(filePath, imageBuffer);
          
          console.log(`✅ Saved image to: ${filePath}`);
          
          // Build public URL
          normalizedPath = savedFileName;
          storedUrl = buildPublicUrl(savedFileName);
          
          console.log(`✅ Generated URL: ${storedUrl}`);
          
        } catch (saveError) {
          console.error(`❌ Error saving base64 image:`, saveError);
          uploadedImages.push({
            fieldId,
            order: orderInt,
            failed: true,
            error: `Failed to save image: ${saveError.message}`,
          });
          continue;
        }
      } else {
        // Try to use existing path/URL
        const candidatePath =
          imageData.relativePath ||
          imageData.imageUrl ||
          imageData.url ||
          imageData.path;
        const fileName = imageData.fileName || null;
        
        console.log('🔍 Incoming image payload (no base64, using path)', {
          fieldId,
          orderRaw,
          orderInt,
          candidatePath,
          imageUrl: imageData.imageUrl,
          relativePath: imageData.relativePath,
          fileName,
        });

        normalizedPath = normalizeRelativePath(candidatePath);
        if (!normalizedPath) {
          console.warn('❌ Skipping image due to missing path/url', {
            fieldId,
            order: orderInt,
            candidatePath,
          });
          uploadedImages.push({
            fieldId,
            order: orderInt,
            failed: true,
            error: 'Missing image path information',
          });
          continue;
        }

        storedUrl =
          (imageData.imageUrl && imageData.imageUrl.trim()) ||
          buildPublicUrl(normalizedPath);
        savedFileName = fileName || normalizedPath;
      }

      console.log('🔁 Preparing to store image', {
        fieldId,
        order: orderInt,
        candidatePath,
        normalizedPath,
        storedUrl,
        fileName,
      });

      const existingImage = await prisma.$queryRaw`
        SELECT 
          id,
          image_url,
          image_order,
          uploaded_at
        FROM inspection_question_images
        WHERE answer_id = ${answerIdBigInt}
          AND field_id = ${fieldId}
          AND image_order = ${orderInt}
        LIMIT 1
      `;

      if (existingImage && existingImage.length > 0) {
        console.warn(
          '⚠️ Attempt to upload duplicate image without deleting existing one',
          {
            fieldId,
            order: orderInt,
            existingImage: existingImage[0],
          }
        );
        return res.status(409).json({
          error: 'ImageAlreadyExists',
          message:
            'Энэ талбарт аль хэдийн зураг байна. Шинэ зураг оруулахын өмнө өмнөх зургийг устгана уу.',
          details: {
            fieldId,
            order: orderInt,
            existingImage: existingImage[0],
          },
        });
      }

      try {
        await prisma.$executeRaw`
          INSERT INTO inspection_question_images (
            answer_id,
            field_id,
            section,
            image_order,
            image_url,
            uploaded_by,
            uploaded_at,
            created_at,
            updated_at
          ) VALUES (
            ${answerIdBigInt},
            ${fieldId},
            ${section},
            ${orderInt},
            ${storedUrl},
            ${userId},
            NOW(),
            NOW(),
            NOW()
          )
        `;

        const idResult = await prisma.$queryRaw`
          SELECT id
          FROM inspection_question_images
          WHERE answer_id = ${answerIdBigInt}
            AND field_id = ${fieldId}
            AND image_order = ${orderInt}
          ORDER BY id DESC
          LIMIT 1
        `;
        const rawId = idResult?.[0]?.id;
        const imageId =
          typeof rawId === 'bigint'
            ? rawId.toString()
            : rawId
              ? String(rawId)
              : null;

        // Load image payload for metadata (if file exists)
        const payload = normalizedPath ? await loadImagePayload(normalizedPath) : { base64: null, size: null };
        const mimeType = inferMimeType(normalizedPath || savedFileName || '');
        if (!payload.base64 && normalizedPath) {
          console.warn('⚠️ Failed to read uploaded image from disk', {
            normalizedPath,
            storedUrl,
          });
        }

        // Get file size if we just saved it
        let fileSize = payload.size;
        if (savedFileName && !fileSize) {
          try {
            const stats = await fsPromises.stat(path.join(FTP_STORAGE_PATH, savedFileName));
            fileSize = stats.size;
          } catch (e) {
            console.warn('⚠️ Could not get file size:', e.message);
          }
        }

        uploadedImages.push({
          id: imageId,
          fieldId,
          order: orderInt,
          imageUrl: storedUrl,
          relativePath: normalizedPath || savedFileName,
          fileName: savedFileName || fileName,
          mimeType,
          fileSize: fileSize,
        });

        console.log('✅ Image metadata stored', {
          imageId,
          fieldId,
          order: orderInt,
          imageUrl: storedUrl,
          relativePath: normalizedPath,
          mimeType,
          fileSize: payload.size,
        });

        console.log(
          `✅ Stored image ${orderInt} for field ${fieldId} (ID: ${imageId})`
        );
      } catch (imageError) {
        console.error(
          `❌ Error saving image metadata for order ${orderInt}, field ${fieldId}:`,
          imageError
        );
        uploadedImages.push({
          fieldId,
          order: orderInt,
          failed: true,
          error: imageError.message,
          relativePath: normalizedPath,
        });
      }
    }

    // Check if table exists for better error message
    let tableCheckMessage = '';
    try {
      const tableCheck = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
        AND table_name = 'inspection_question_images'
      `;
      const tableExists = tableCheck[0]?.count > 0;
      tableCheckMessage = tableExists
        ? 'Table exists'
        : 'Table does NOT exist - please run create_inspection_question_images_table.sql';
    } catch (e) {
      tableCheckMessage = `Could not check table: ${e.message}`;
    }

    // Get error details from failed uploads
    const failedUploads = uploadedImages.filter(img => img.failed);
    const successfulUploads = uploadedImages.filter(img => !img.failed);

    if (successfulUploads.length === 0) {
      console.error('❌ No images were successfully uploaded');
      console.error('Total images attempted:', images.length);
      console.error('Successful uploads:', successfulUploads.length);
      console.error('Failed uploads:', failedUploads.length);

      const errorDetails = failedUploads.map(img => ({
        fieldId: img.fieldId,
        order: img.order,
        error: img.error,
      }));

      return res.status(400).json({
        error: 'Upload Failed',
        message: 'No images were successfully uploaded',
        details: {
          attempted: images.length,
          successful: successfulUploads.length,
          failed: failedUploads.length,
          errors: errorDetails,
          tableStatus: tableCheckMessage,
        },
        debug: {
          requestBody: {
            fieldId: req.body.fieldId,
            section: req.body.section,
            imagesCount: req.body.images?.length || 0,
          },
        },
      });
    }

    // Filter out failed uploads from response
    const successfulImages = uploadedImages.filter(img => !img.failed);

    return res.json({
      message: `Successfully uploaded ${successfulImages.length} image(s)`,
      data: {
        inspectionId: inspection.id.toString(),
        fieldId,
        section,
        questionText,
        uploadedImages: successfulImages,
        uploadedCount: successfulImages.length,
      },
    });
  } catch (error) {
    console.error('Error uploading question images:', error);
    return res.status(500).json({
      error: 'Failed to upload question images',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// GET question images for an inspection
router.get('/:id/question-images', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const { fieldId, section } = req.query;

    console.log('=== GET Question Images ===');
    console.log('Request params id:', req.params.id);
    console.log('Parsed inspectionId (BigInt):', inspectionId.toString());
    console.log('Query params - fieldId:', fieldId, 'section:', section);

    // Verify inspection access
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId
    );

    console.log('Verified inspection ID:', inspection.id.toString());

    // Get answer_id from inspection_answer
    const answer = await prisma.InspectionAnswer.findFirst({
      where: { inspectionId },
      orderBy: { answeredAt: 'desc' },
      select: { id: true },
    });

    if (!answer) {
      console.log('No inspection answer found for inspection:', inspectionId.toString());
      return res.json({
        message: 'No images found',
        data: {
          inspectionId: inspection.id.toString(),
          images: [],
          count: 0,
        },
      });
    }

    const answerId = answer.id;
    console.log('Found answer_id:', answerId.toString());

    // Build WHERE conditions dynamically
    let query;
    if (fieldId && section) {
      query = prisma.$queryRaw`
        SELECT 
          id,
          answer_id,
          field_id,
          section,
          image_order,
          image_url,
          uploaded_by,
          uploaded_at,
          created_at,
          updated_at
        FROM inspection_question_images
        WHERE answer_id = ${answerId}
          AND field_id = ${fieldId}
          AND section = ${section}
        ORDER BY section, field_id, image_order ASC
      `;
    } else if (fieldId) {
      query = prisma.$queryRaw`
        SELECT 
          id,
          answer_id,
          field_id,
          section,
          image_order,
          image_url,
          uploaded_by,
          uploaded_at,
          created_at,
          updated_at
        FROM inspection_question_images
        WHERE answer_id = ${answerId}
          AND field_id = ${fieldId}
        ORDER BY section, field_id, image_order ASC
      `;
    } else if (section) {
      query = prisma.$queryRaw`
        SELECT 
          id,
          answer_id,
          field_id,
          section,
          image_order,
          image_url,
          uploaded_by,
          uploaded_at,
          created_at,
          updated_at
        FROM inspection_question_images
        WHERE answer_id = ${answerId}
          AND section = ${section}
        ORDER BY section, field_id, image_order ASC
      `;
    } else {
      // Get all images for this specific inspection only
      query = prisma.$queryRaw`
        SELECT 
          id,
          answer_id,
          field_id,
          section,
          image_order,
          image_url,
          uploaded_by,
          uploaded_at,
          created_at,
          updated_at
        FROM inspection_question_images
        WHERE answer_id = ${answerId}
        ORDER BY section, field_id, image_order ASC
      `;

      // Debug: Also check how many total images exist in the table
      const totalCountResult = await prisma.$queryRaw`
        SELECT COUNT(*) as total FROM inspection_question_images
      `;
      console.log(
        'Total images in table:',
        totalCountResult[0]?.total?.toString() || 'N/A'
      );

      const thisInspectionCountResult = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM inspection_question_images WHERE inspection_id = ${inspectionId}
      `;
      console.log(
        `Images for inspection ${inspectionId.toString()}:`,
        thisInspectionCountResult[0]?.count?.toString() || 'N/A'
      );
    }

    const images = await query;

    console.log(
      `Found ${images.length} image(s) for inspection ${inspectionId.toString()}`
    );
    if (images.length > 0) {
      console.log(
        'First image inspection_id:',
        images[0].inspection_id?.toString() || 'N/A'
      );
      console.log('Sample image data:', {
        id: images[0].id?.toString(),
        answer_id: images[0].answer_id?.toString(),
        field_id: images[0].field_id,
        section: images[0].section,
      });
    }

    // Format response - ensure all BigInt values are converted to strings
    const formattedImages = await Promise.all(
      images.map(async (img, index) => {
        const relativePath = normalizeRelativePath(img.image_url);
        const payload = await loadImagePayload(relativePath);
        const publicUrl = img.image_url || buildPublicUrl(relativePath);

        console.log(`[Images] Loaded image ${index + 1}`, {
          relativePath,
          hasBase64: !!payload.base64,
          size: payload.size,
          publicUrl,
        });

        return {
          id: img.id ? img.id.toString() : null,
          answerId: img.answer_id ? img.answer_id.toString() : null,
          fieldId: img.field_id,
          section: img.section,
          order: Number(img.image_order),
          imageUrl: publicUrl,
          storagePath: relativePath,
          fileSize: payload.size,
          mimeType: inferMimeType(relativePath),
          imageData: payload.base64,
          uploadedBy: img.uploaded_by ? img.uploaded_by.toString() : null,
          uploadedAt: img.uploaded_at ? img.uploaded_at.toISOString() : null,
          createdAt: img.created_at ? img.created_at.toISOString() : null,
          updatedAt: img.updated_at ? img.updated_at.toISOString() : null,
        };
      })
    );

    // Use serializeBigInt to ensure all BigInt values are converted
    return res.json(
      serializeBigInt({
        message: 'Question images retrieved successfully',
        data: {
          inspectionId: inspection.id.toString(),
          images: formattedImages,
          count: formattedImages.length,
        },
      })
    );
  } catch (error) {
    console.error('Error fetching question images:', error);
    return res.status(500).json({
      error: 'Failed to fetch question images',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * GET /api/inspections/:id/image-gallery
 * Returns all question images for the inspection (grouped by section/field)
 */
router.get('/:id/image-gallery', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const includeData = req.query.includeData !== 'false';

    console.log('=== GET Image Gallery ===');
    console.log('Inspection ID:', inspectionId.toString());
    console.log('Include base64 data:', includeData);

    // Verify access rights
    let inspection;
    try {
      inspection = await verifyInspectionAccess(
        inspectionId,
        req.user.id,
        req.user.orgId
      );
    } catch (verifyError) {
      console.warn(
        '[image-gallery] verifyInspectionAccess failed:',
        verifyError.message
      );

      if (verifyError.message?.includes('not found')) {
        return res.json(
          serializeBigInt({
            message: 'Үзлэг олдсонгүй эсвэл зураг хадгалагдаагүй байна.',
            data: {
              inspectionId: req.params.id,
              count: 0,
              sections: {},
              images: [],
              tableExists: null,
            },
          })
        );
      }

      if (verifyError.message?.includes('access')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: verifyError.message,
        });
      }

      throw verifyError;
    }

    // Ensure inspection_question_images table exists
    const tableCheck = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
        AND table_name = 'inspection_question_images'
    `;
    const tableExists = tableCheck?.[0]?.count > 0;

    if (!tableExists) {
      console.warn(
        '[image-gallery] inspection_question_images table not found. Returning empty result.'
      );
      return res.json(
        serializeBigInt({
          message:
            'Зургийн мэдээллийн хүснэгт олдсонгүй (inspection_question_images).',
          data: {
            inspectionId: inspection.id.toString(),
            count: 0,
            sections: {},
            images: [],
            tableExists: false,
          },
        })
      );
    }

    // Fetch images joined with answers to resolve inspection -> answer relation
    const rows = await prisma.$queryRaw`
      SELECT 
        qi.id,
        qi.answer_id,
        ia.inspection_id,
        qi.field_id,
        qi.section,
        qi.image_order,
        qi.image_url,
        qi.uploaded_by,
        qi.uploaded_at,
        qi.created_at,
        qi.updated_at
      FROM inspection_question_images qi
      INNER JOIN inspection_answers ia ON ia.id = qi.answer_id
      WHERE ia.inspection_id = ${inspectionId}
      ORDER BY qi.section, qi.field_id, qi.image_order
    `;

    console.log(
      `Found ${rows.length} image rows linked to inspection ${inspectionId.toString()}`
    );

    const images = await Promise.all(
      rows.map(async row => {
        const relativePath = normalizeRelativePath(row.image_url);
        const mimeType = inferMimeType(relativePath);

        let payload = { base64: null, size: null, localPath: null };
        if (includeData && relativePath) {
          payload = await loadImagePayload(relativePath);
        }

        const publicUrl =
          row.image_url ||
          (relativePath ? buildPublicUrl(relativePath) : null);

        return {
          id: row.id ? row.id.toString() : null,
          inspectionId: inspection.id.toString(),
          answerId: row.answer_id ? row.answer_id.toString() : null,
          fieldId: row.field_id,
          section: row.section,
          order: Number(row.image_order),
          imageUrl: publicUrl,
          storagePath: relativePath,
          fileSize: payload.size,
          mimeType,
          imageData: payload.base64,
          dataUri:
            payload.base64 && mimeType
              ? `data:${mimeType};base64,${payload.base64}`
              : null,
          uploadedBy: row.uploaded_by ? row.uploaded_by.toString() : null,
          uploadedAt: row.uploaded_at ? row.uploaded_at.toISOString() : null,
          createdAt: row.created_at ? row.created_at.toISOString() : null,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        };
      })
    );

    const sections = images.reduce((acc, image) => {
      const key = image.section || 'other';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(image);
      return acc;
    }, {});

    return res.json(
      serializeBigInt({
        message: 'Inspection image gallery loaded successfully',
        data: {
          inspectionId: inspection.id.toString(),
          count: images.length,
          sections,
          images,
        },
      })
    );
  } catch (error) {
    console.error('Error fetching inspection image gallery:', error);
    return handleError(res, error, 'fetch inspection image gallery');
  }
});

// POST save section answers (section by section saving with smart data management)
router.post('/section-answers', authMiddleware, async (req, res) => {
  try {
    console.log('=== Section Answers Request ===');
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const requestData = req.body.data || req.body;
    console.log(
      'Processed request data:',
      JSON.stringify(requestData, null, 2)
    );

    const serviceResult = await sectionAnswersService.saveSectionAnswers(
      requestData,
      req.user
    );
    const completedSections = await getCompletedSections(
      BigInt(requestData.inspectionId)
    );

    const baseMessage = serviceResult.isCompletion
      ? `Section '${requestData.section}' completed successfully. Inspection finished!`
      : `Section '${requestData.section}' saved successfully. ${serviceResult.nextSection ? `Next: ${serviceResult.nextSection}` : 'This was the last section.'}`;

    console.log(`Section '${requestData.section}' processed:`, {
      isCompletion: serviceResult.isCompletion,
      answerId: serviceResult.result.sectionAnswer.id.toString(),
      nextSection: serviceResult.nextSection,
      isLastSection: serviceResult.isLastSection,
      totalQuestions: Object.keys(
        serviceResult.result.sectionAnswer.answers || {}
      ).filter(key => key !== 'metadata').length,
    });

    const responseBuilder = serviceResult.result.didCreate
      ? res
          .status(201)
          .location(
            `/api/inspection-answers/${serviceResult.result.sectionAnswer.id.toString()}`
          )
      : res.status(200);

    // Үзлэг дуусахад автоматаар mail илгээх болгосонгүй — зөвхөн admin web-ээс "Mail илгээх" товч дарсан үед илгээнэ.

    return responseBuilder.json({
      message: baseMessage,
      data: {
        inspectionId: requestData.inspectionId.toString(),
        answerId: serviceResult.result.sectionAnswer.id.toString(),
        section: requestData.section,
        sectionIndex:
          requestData.sectionIndex ?? serviceResult.currentSectionIndex,
        status: requestData.status || 'IN_PROGRESS',
        progress: requestData.progress ?? null,
        answeredAt: serviceResult.result.sectionAnswer.answeredAt,
        metadata: serviceResult.result.extractedMetadata || null,
        isCompletion: serviceResult.isCompletion,
        isLastSection: serviceResult.isLastSection,
        isFirstSection: requestData.isFirstSection,
        nextSection: serviceResult.nextSection,
        sectionOrder:
          serviceResult.sectionOrder.length > 0
            ? serviceResult.sectionOrder
            : [requestData.section],
        currentSectionIndex:
          serviceResult.currentSectionIndex >= 0
            ? serviceResult.currentSectionIndex
            : 0,
        totalSections:
          serviceResult.sectionOrder.length > 0
            ? serviceResult.sectionOrder.length
            : 1,
        completedSections: completedSections,
        hasTemplate: serviceResult.template,
        navigation: {
          canGoToNext: serviceResult.nextSection !== null,
          canGoToPrevious: serviceResult.currentSectionIndex > 0,
          nextSection: serviceResult.nextSection,
          previousSection:
            serviceResult.currentSectionIndex > 0 &&
            serviceResult.sectionOrder.length > 0
              ? serviceResult.sectionOrder[
                  serviceResult.currentSectionIndex - 1
                ]
              : null,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error saving section answers:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    if (
      error.message.includes('Missing required field') ||
      error.message.includes('must be') ||
      error.message.includes('does not exist') ||
      error.message.includes('do not have access')
    ) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.message,
        details:
          process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }

    if (error.message.includes('access')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
        details:
          process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }

    return res.status(500).json({
      error: 'Failed to save section answers',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// =============================================================================
// DEVICE AND TEMPLATE ENDPOINTS
// =============================================================================

// GET /api/inspections/:id/devices - Get devices for an inspection
router.get('/:id/devices', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId,
      { 
        deviceId: true,
        device: {
          include: {
            model: {
              select: { id: true, manufacturer: true, model: true, specs: true }
            },
            site: { select: { id: true, name: true } },
            contract: {
              select: { id: true, contractName: true, contractNumber: true }
            },
            organization: { select: { id: true, name: true, code: true } }
          }
        },
        template: true,
        assignee: {
          select: { id: true, fullName: true, email: true }
        }
      }
    );

    const templateQuestions = inspection.template?.questions || [];
    const sections =
      sectionAnswersService.getTemplateSections(templateQuestions);
    const sectionAnswers = await prisma.InspectionAnswer.findMany({
      where: { inspectionId: inspectionId },
      orderBy: { answeredAt: 'desc' }, // Get latest first
    });

    // Organize answers by section (process latest first, so latest overwrites older)
    const organizedAnswers = {};
    let inspectionMetadata = null;

    // Reverse to process from oldest to newest (so latest overwrites)
    const reversedAnswers = [...sectionAnswers].reverse();
    reversedAnswers.forEach(answer => {
      const answerData = answer.answers || {};

      if (answerData.metadata && !inspectionMetadata) {
        inspectionMetadata = answerData.metadata;
      }

      const sectionData = answerData.data || answerData; // Support both formats
      if (sectionData) {
        Object.keys(sectionData).forEach(sectionName => {
          if (sectionName !== 'metadata') {
            organizedAnswers[sectionName] = sectionData[sectionName];
          }
        });
      }
    });

    const completedSections = await getCompletedSections(inspectionId);

    // Format device info for cross-organization support
    const deviceInfo = inspection.device ? {
      id: inspection.device.id.toString(),
      serialNumber: inspection.device.serialNumber,
      assetTag: inspection.device.assetTag,
      status: inspection.device.status,
      location: inspection.device.location,
      installedAt: inspection.device.installedAt,
      metadata: inspection.device.metadata,
      model: inspection.device.model ? {
        id: inspection.device.model.id.toString(),
        manufacturer: inspection.device.model.manufacturer,
        model: inspection.device.model.model,
        specs: inspection.device.model.specs
      } : null,
      site: inspection.device.site ? {
        id: inspection.device.site.id.toString(),
        name: inspection.device.site.name
      } : null,
      contract: inspection.device.contract ? {
        id: inspection.device.contract.id.toString(),
        contractName: inspection.device.contract.contractName,
        contractNumber: inspection.device.contract.contractNumber
      } : null,
      organization: inspection.device.organization ? {
        id: inspection.device.organization.id.toString(),
        name: inspection.device.organization.name,
        code: inspection.device.organization.code
      } : null
    } : null;

    return res.json({
      message: 'Devices retrieved successfully',
      data: {
        inspection: {
          id: inspection.id.toString(),
          title: inspection.title,
          status: inspection.status,
          progress: inspection.progress,
          assignedTo: inspection.assignee
            ? {
                id: inspection.assignee.id.toString(),
                fullName: inspection.assignee.fullName,
                email: inspection.assignee.email,
              }
            : null,
          createdAt: inspection.createdAt,
          updatedAt: inspection.updatedAt,
        },
        device: deviceInfo,
        template: {
          id: inspection.template?.id?.toString(),
          name: inspection.template?.name,
          type: inspection.template?.type,
          sections: sections,
          totalSections: Object.keys(sections).length,
        },
        answers: organizedAnswers,
        metadata: inspectionMetadata,
        completedSections: completedSections,
        summary: {
          totalSections: Object.keys(sections).length,
          completedSections: completedSections.length,
          progress: inspection.progress || 0,
        },
      },
    });
  } catch (error) {
    handleError(res, error, 'get inspection devices');
  }
});

// GET all device models
router.get('/device-models', authMiddleware, async (req, res) => {
  try {
    const deviceModels = await prisma.DeviceModel.findMany({
      include: { _count: { select: { devices: true } } },
      orderBy: { manufacturer: 'asc' },
    });

    const formattedModels = deviceModels.map(model => ({
      id: model.id.toString(),
      manufacturer: model.manufacturer,
      model: model.model,
      specs: model.specs,
      deviceCount: model._count.devices,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    }));

    res.json({
      message: 'Device models retrieved successfully',
      data: formattedModels,
      count: formattedModels.length,
    });
  } catch (error) {
    handleError(res, error, 'fetch device models');
  }
});

// GET specific device model by ID
router.get('/device-models/:id', authMiddleware, async (req, res) => {
  try {
    const deviceModel = await prisma.DeviceModel.findUnique({
      where: { id: BigInt(req.params.id) },
      include: {
        _count: { select: { devices: true } },
        devices: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            status: true,
            installedAt: true,
            organization: { select: { name: true, code: true } },
            site: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!deviceModel) {
      return res.status(404).json({
        error: 'Device model not found',
        message: 'The requested device model does not exist',
      });
    }

    const formattedModel = {
      id: deviceModel.id.toString(),
      manufacturer: deviceModel.manufacturer,
      model: deviceModel.model,
      specs: deviceModel.specs,
      deviceCount: deviceModel._count.devices,
      devices: deviceModel.devices.map(device => ({
        id: device.id.toString(),
        serialNumber: device.serialNumber,
        assetTag: device.assetTag,
        status: device.status,
        installedAt: device.installedAt,
        organization: device.organization,
        site: device.site,
      })),
      createdAt: deviceModel.createdAt,
      updatedAt: deviceModel.updatedAt,
    };

    res.json({
      message: 'Device model retrieved successfully',
      data: formattedModel,
    });
  } catch (error) {
    handleError(res, error, 'fetch device model');
  }
});

// GET all devices (for organization users + devices from assigned inspections)
router.get('/devices', authMiddleware, async (req, res) => {
  try {
    const orgIdFromToken = req.user.orgId;
    const userId = BigInt(req.user.id);
    const { status, siteId, modelId, search, page = 1, limit = 10 } = req.query;

    // Get device IDs from inspections assigned to this user (cross-organization support)
    // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
    const assignedInspections = await prisma.Inspection.findMany({
      where: {
        deletedAt: null,
        deviceId: { not: null },
        OR: [
          { assignedTo: userId },
          { assignments: { some: { userId: userId } } },
        ],
      },
      select: { deviceId: true }
    });
    
    const assignedDeviceIds = assignedInspections
      .map(i => i.deviceId)
      .filter(id => id !== null);

    // Build where clause - include devices from user's org OR devices from assigned inspections
    const where = { 
      deletedAt: null,
      OR: [
        { orgId: BigInt(orgIdFromToken) },
        ...(assignedDeviceIds.length > 0 ? [{ id: { in: assignedDeviceIds } }] : [])
      ]
    };
    
    if (status) where.status = status.toUpperCase();
    if (siteId) where.siteId = BigInt(siteId);
    if (modelId) where.modelId = BigInt(modelId);
    if (search) {
      where.AND = [
        {
          OR: [
            { serialNumber: { contains: search, mode: 'insensitive' } },
            { assetTag: { contains: search, mode: 'insensitive' } },
          ]
        }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Fetch devices with related data
    const [devices, totalCount] = await Promise.all([
      prisma.Device.findMany({
        where,
        include: {
          model: {
            select: { id: true, manufacturer: true, model: true, specs: true },
          },
          site: { select: { id: true, name: true } },
          contract: {
            select: { id: true, contractName: true, contractNumber: true },
          },
          organization: { select: { id: true, name: true, code: true } },
          _count: { select: { inspections: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.Device.count({ where }),
    ]);

    const formattedDevices = devices.map(device => ({
      id: device.id.toString(),
      serialNumber: device.serialNumber,
      assetTag: device.assetTag,
      status: device.status,
      installedAt: device.installedAt,
      metadata: device.metadata,
      inspectionCount: device._count.inspections,
      model: device.model
        ? { ...device.model, id: device.model.id.toString() }
        : null,
      site: device.site
        ? { ...device.site, id: device.site.id.toString() }
        : null,
      contract: device.contract
        ? { ...device.contract, id: device.contract.id.toString() }
        : null,
      organization: {
        ...device.organization,
        id: device.organization.id.toString(),
      },
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    }));

    const totalPages = Math.ceil(totalCount / take);

    res.json({
      message: 'Devices retrieved successfully',
      data: formattedDevices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    handleError(res, error, 'fetch devices');
  }
});

// GET specific device by ID
router.get('/devices/:id', authMiddleware, async (req, res) => {
  try {
    const device = await prisma.Device.findFirst({
      where: {
        id: BigInt(req.params.id),
        orgId: BigInt(req.user.orgId),
        deletedAt: null,
      },
      include: {
        model: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
            specs: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        site: { select: { id: true, name: true } },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
            startDate: true,
            endDate: true,
            metadata: true,
          },
        },
        organization: { select: { id: true, name: true, code: true } },
        inspections: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            progress: true,
            scheduledAt: true,
            completedAt: true,
            assignee: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { inspections: true, attachments: true } },
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        message:
          'The requested device does not exist or you do not have access to it',
      });
    }

    const formattedDevice = {
      id: device.id.toString(),
      serialNumber: device.serialNumber,
      assetTag: device.assetTag,
      status: device.status,
      installedAt: device.installedAt,
      retiredAt: device.retiredAt,
      metadata: device.metadata,
      inspectionCount: device._count.inspections,
      attachmentCount: device._count.attachments,
      model: device.model
        ? { ...device.model, id: device.model.id.toString() }
        : null,
      site: device.site
        ? { ...device.site, id: device.site.id.toString() }
        : null,
      contract: device.contract
        ? { ...device.contract, id: device.contract.id.toString() }
        : null,
      organization: {
        ...device.organization,
        id: device.organization.id.toString(),
      },
      inspections: device.inspections.map(inspection => ({
        ...inspection,
        id: inspection.id.toString(),
        assignee: inspection.assignee
          ? { ...inspection.assignee, id: inspection.assignee.id.toString() }
          : null,
      })),
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };

    res.json({
      message: 'Device retrieved successfully',
      data: formattedDevice,
    });
  } catch (error) {
    handleError(res, error, 'fetch device');
  }
});

// =============================================================================
// GET INSPECTIONS WITH REPAIRS NEEDED
// =============================================================================

/**
 * GET /api/inspections/repairs-needed
 * Get all inspections that have items requiring repair
 * Analyzes inspection_answer.answers JSON to find statuses that need repair
 * IMPORTANT: This route must be registered BEFORE /:id route to avoid route conflicts
 */
router.get('/repairs-needed', authMiddleware, async (req, res) => {
  try {
    console.log('🔍 [GET /api/inspections/repairs-needed] Request received');
    console.log('   User ID:', req.user?.id);
    console.log('   User orgId:', req.user?.orgId);
    
    const userId = BigInt(req.user.id);
    const user = await prisma.User.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });

    if (!user) {
      console.error('❌ [GET /api/inspections/repairs-needed] User not found');
      return res.status(403).json({
        error: 'Access denied',
        message: 'User not found',
      });
    }

    console.log('✅ [GET /api/inspections/repairs-needed] User found, orgId:', user.orgId.toString());

    // Get inspections accessible by user
    // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
    console.log('🔍 [GET /api/inspections/repairs-needed] Fetching inspections...');
    const inspections = await prisma.Inspection.findMany({
      where: {
        OR: [
          { orgId: user.orgId },
          { assignedTo: userId },
          { assignments: { some: { userId: userId } } },
        ],
        deletedAt: null,
      },
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            model: {
              select: {
                manufacturer: true,
                model: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`✅ [GET /api/inspections/repairs-needed] Found ${inspections.length} inspection(s)`);

    const repairsNeeded = [];

    // Get all completed/verified repairs to filter them out
    const completedRepairs = await prisma.Repair.findMany({
      where: {
        repairStatus: {
          in: ['COMPLETED', 'VERIFIED']
        }
      },
      select: {
        inspectionId: true,
        fieldId: true,
        section: true,
      },
    });

    // Create a set of completed repair keys (inspectionId_fieldId_section) for fast lookup
    const completedRepairKeys = new Set(
      completedRepairs.map(r => `${r.inspectionId.toString()}_${r.fieldId}_${r.section}`)
    );

    console.log(`🔍 Found ${completedRepairs.length} completed/verified repair(s) to filter out`);

    // Analyze each inspection's answers
    for (const inspection of inspections) {
      const answers = await prisma.InspectionAnswer.findMany({
        where: { inspectionId: inspection.id },
        orderBy: { answeredAt: 'desc' }, // Get latest first
      });

      if (answers.length === 0) continue;

      // Get latest answer (now first in array)
      const latestAnswer = answers[0];
      const answerData = latestAnswer.answers || {};

      // Support multiple JSON structures
      let sections = {};
      if (answerData.data && typeof answerData.data === 'object') {
        sections = answerData.data;
      } else if (answerData.answers && typeof answerData.answers === 'object') {
        const sectionName = answerData.section || answerData.sectionTitle || 'unknown';
        sections[sectionName] = answerData.answers;
      } else {
        sections = answerData;
      }

      // Find items requiring repair
      const inspectionRepairs = [];
      for (const [sectionName, sectionData] of Object.entries(sections)) {
        // Skip metadata and other non-section keys
        if (
          sectionName === 'metadata' ||
          sectionName === 'signatures' ||
          sectionName === 'remarks' ||
          !sectionData ||
          typeof sectionData !== 'object'
        ) {
          continue;
        }

        // Check each field in the section
        for (const [fieldId, fieldValue] of Object.entries(sectionData)) {
          // Skip non-object values and excluded keys
          if (
            typeof fieldValue !== 'object' ||
            fieldValue === null ||
            ['sectionStatus', 'completedAt', 'section', 'sessionStartedAt', 'lastUpdatedAt'].includes(fieldId)
          ) {
            continue;
          }

          // Get status
          const status = fieldValue.status ||
                        fieldValue.answer ||
                        fieldValue.value ||
                        (Array.isArray(fieldValue.selectedOptions) && fieldValue.selectedOptions[0]) ||
                        '';
          const questionText = fieldValue.question ||
                             fieldValue.questionText ||
                             fieldId ||
                             '';

          // Check if repair is needed (status is not "Хэвийн" or "Цэвэр")
          const statusTrimmed = status ? status.toString().trim() : '';
          if (
            statusTrimmed !== '' &&
            statusTrimmed !== 'Хэвийн' &&
            statusTrimmed !== 'Цэвэр' &&
            statusTrimmed.toLowerCase() !== 'normal' &&
            statusTrimmed.toLowerCase() !== 'clean'
          ) {
            // Check if this repair has already been completed or verified
            const repairKey = `${inspection.id.toString()}_${fieldId}_${sectionName}`;
            const isRepairCompleted = completedRepairKeys.has(repairKey);

            if (!isRepairCompleted) {
              inspectionRepairs.push({
                fieldId,
                section: sectionName,
                questionText,
                originalStatus: statusTrimmed,
                description: fieldValue.comment || fieldValue.textAnswer || fieldValue.notes || null,
              });
            } else {
              console.log(`⏭️  Skipping completed repair: ${repairKey}`);
            }
          }
        }
      }

      // Only include inspections with repairs needed
      if (inspectionRepairs.length > 0) {
        repairsNeeded.push({
          inspection: {
            id: inspection.id.toString(),
            title: inspection.title,
            status: inspection.status,
            device: inspection.device ? {
              id: inspection.device.id.toString(),
              serialNumber: inspection.device.serialNumber,
              assetTag: inspection.device.assetTag,
              model: inspection.device.model,
            } : null,
          },
          repairs: inspectionRepairs,
          totalRepairs: inspectionRepairs.length,
        });
      }
    }

    console.log(`✅ [GET /api/inspections/repairs-needed] Found ${repairsNeeded.length} inspection(s) with repairs needed`);

    return res.json({
      message: 'Inspections with repairs needed retrieved successfully',
      data: serializeBigInt(repairsNeeded),
      count: repairsNeeded.length,
    });
  } catch (error) {
    console.error('❌ [GET /api/inspections/repairs-needed] Error:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    handleError(res, error, 'get inspections with repairs needed');
  }
});

// =============================================================================
// GET INSPECTIONS BY DEVICE
// =============================================================================

/**
 * GET /api/inspections/device/:deviceId
 * Get all inspections for a specific device
 */
router.get('/device/:deviceId', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;

    const inspections = await prisma.Inspection.findMany({
      where: {
        deviceId: BigInt(deviceId),
        deletedAt: null,
      },
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
          },
        },
      },
      orderBy: {
        scheduledAt: 'desc',
      },
    });

    // Format response
    const formattedInspections = inspections.map(inspection => ({
      id: inspection.id.toString(),
      title: inspection.title,
      type: inspection.type,
      status: inspection.status,
      scheduledAt: inspection.scheduledAt,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      progress: inspection.progress,
      assignee: inspection.assignee
        ? {
            id: inspection.assignee.id.toString(),
            fullName: inspection.assignee.fullName,
            email: inspection.assignee.email,
          }
        : null,
      device: inspection.device
        ? {
            id: inspection.device.id.toString(),
            serialNumber: inspection.device.serialNumber,
            assetTag: inspection.device.assetTag,
          }
        : null,
      createdAt: inspection.createdAt,
    }));

    res.json({
      message: 'Inspections retrieved successfully',
      data: formattedInspections,
    });
  } catch (error) {
    console.error('Error fetching inspections:', error);
    res.status(500).json({
      error: 'Failed to fetch inspections',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// =============================================================================
// GET INSPECTION BY ID (Must be after all specific routes)
// =============================================================================

// GET inspection by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    // Check if this is actually a repairs-needed request (route conflict check)
    if (req.params.id === 'repairs-needed') {
      console.error('⚠️ [GET /:id] Route conflict detected! "repairs-needed" was matched by /:id route');
      return res.status(404).json({
        error: 'Route conflict',
        message: 'The repairs-needed route should be registered before /:id route',
      });
    }
    
    console.log(`🔍 [GET /api/inspections/:id] Request received, id: ${req.params.id}`);
    const inspectionId = BigInt(req.params.id);
    const inspection = await verifyInspectionAccess(
      inspectionId,
      req.user.id,
      req.user.orgId,
      {
        device: {
          include: {
            model: true,
            organization: true,
            site: true,
            contract: true,
          },
        },
        assignee: true,
        template: true,
      }
    );

    const formatted = {
      id: inspection.id.toString(),
      orgId: inspection.orgId.toString(),
      deviceId: inspection.deviceId?.toString(),
      siteId: inspection.siteId?.toString(),
      contractId: inspection.contractId?.toString(),
      templateId: inspection.templateId?.toString(),
      type: inspection.type,
      title: inspection.title,
      scheduleType: inspection.scheduleType,
      scheduledAt: inspection.scheduledAt,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      status: inspection.status,
      progress: inspection.progress,
      assignedTo: inspection.assignedTo?.toString(),
      createdBy: inspection.createdBy?.toString(),
      notes: inspection.notes,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,
      device: formatDeviceInfo(inspection.device),
      assignee: inspection.assignee
        ? {
            id: inspection.assignee.id.toString(),
            fullName: inspection.assignee.fullName,
            email: inspection.assignee.email,
          }
        : null,
      template: inspection.template
        ? {
            ...inspection.template,
            id: inspection.template.id.toString(),
          }
        : null,
    };

    return res.json(
      serializeBigInt({
      message: 'Inspection retrieved successfully',
      data: formatted,
      })
    );
  } catch (error) {
    handleError(res, error, 'fetch inspection by ID');
  }
});

// =============================================================================
// ASSIGN INSPECTION TO USER
// =============================================================================

/**
 * POST /api/inspections
 * Create a new inspection
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      orgId,
      deviceId,
      siteId,
      contractId,
      templateId,
      type,
      scheduleType,
      title,
      scheduledAt,
      startedAt,
      completedAt,
      notes,
    } = req.body;

    // Validation
    // For INSTALLATION type, deviceId is optional
    const normalizedType = type?.toUpperCase();
    const isInstallation = normalizedType === 'INSTALLATION';
    
    if (!isInstallation && !deviceId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device is required for non-installation inspections',
      });
    }
    
    if (!type || !title) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Type and title are required',
      });
    }

    // For INSTALLATION type, orgId and contractId are required instead of deviceId
    if (isInstallation) {
      if (!orgId) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Organization is required for installation inspections',
        });
      }
      if (!contractId) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Contract is required for installation inspections',
        });
      }
    }

    let device = null;
    let finalOrgId = orgId;
    let finalSiteId = siteId;
    let finalContractId = contractId;

    // Only fetch device if deviceId is provided
    if (deviceId) {
      // Verify device exists and get related data including model's device_type
      device = await prisma.Device.findUnique({
        where: { id: BigInt(deviceId) },
        include: {
          organization: true,
          site: true,
          contract: true,
          model: {
            select: {
              id: true,
              manufacturer: true,
              model: true,
              deviceType: true,
            },
          },
        },
      });

      if (!device) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Device not found',
        });
      }

      // Use device's related data if not provided
      finalOrgId = orgId || device.orgId.toString();
      finalSiteId = siteId || device.siteId?.toString();
      finalContractId = contractId || device.contractId?.toString();
    }

    // Get device type from device metadata or model (only if device exists)
    const deviceType = device ? getDeviceType(device) : null;

    // If templateId not provided, auto-select template based on device type
    let finalTemplateId = templateId;
    if (!finalTemplateId && deviceType && device) {
      const autoTemplate = await findTemplateByDeviceType(deviceType, normalizedType, false);

      if (autoTemplate) {
        finalTemplateId = autoTemplate.id.toString();
        console.log(`[POST /api/inspections] Auto-selected template ${finalTemplateId} for device type ${deviceType}`);
      } else {
        console.warn(`[POST /api/inspections] No template found for device type ${deviceType} and inspection type ${normalizedType}`);
      }
    }

    // Verify template if provided or auto-selected
    if (finalTemplateId) {
      const template = await prisma.InspectionTemplate.findUnique({
        where: { id: BigInt(finalTemplateId) },
      });

      if (!template) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Template not found',
        });
      }
    }

    
    // Normalize scheduleType - handle empty strings and undefined/null properly
    // Only default to 'SCHEDULED' if scheduleType is truly not provided
    let normalizedScheduleType;
    if (scheduleType && typeof scheduleType === 'string' && scheduleType.trim() !== '') {
      normalizedScheduleType = scheduleType.toUpperCase().trim();
    } else {
      // Default to SCHEDULED only if scheduleType is not provided
      normalizedScheduleType = 'SCHEDULED';
      console.warn(`[POST /api/inspections] scheduleType not provided or empty, defaulting to SCHEDULED. Received: "${scheduleType}"`);
    }

    console.log(`[POST /api/inspections] Creating inspection:`);
    console.log(`  - scheduleType from request: "${scheduleType}" (type: ${typeof scheduleType})`);
    console.log(`  - normalizedScheduleType: "${normalizedScheduleType}"`);
    console.log(`  - Full request body:`, JSON.stringify(req.body, null, 2));

    // Validate scheduleType
    const allowedScheduleTypes = ['DAILY', 'SCHEDULED'];
    if (!allowedScheduleTypes.includes(normalizedScheduleType)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `scheduleType must be one of: ${allowedScheduleTypes.join(', ')}. Received: "${scheduleType}"`,
      });
    }

    // Validate inspection dates are within contract date range
    // Check if device has a contract OR if contractId is provided
    let contractToCheck = device.contract;
    
    // If contractId is provided but device.contract is not loaded, fetch it
    if (!contractToCheck && finalContractId) {
      const contract = await prisma.Contract.findUnique({
        where: { id: BigInt(finalContractId) },
      });
      contractToCheck = contract;
    }
    
    if (contractToCheck) {
      const contractStartDate = contractToCheck.startDate;
      const contractEndDate = contractToCheck.endDate;
      
      console.log(`[POST /api/inspections] Contract dates - startDate: ${contractStartDate}, endDate: ${contractEndDate}`);
      console.log(`[POST /api/inspections] Inspection dates - startedAt: ${startedAt}, completedAt: ${completedAt}`);
      
      if (contractStartDate && contractEndDate) {
        // Validate startedAt and completedAt for ALL inspections (DAILY and SCHEDULED)
        if (startedAt && completedAt) {
          const inspectionStartDate = new Date(startedAt);
          const inspectionEndDate = new Date(completedAt);
          
          console.log(`[POST /api/inspections] Validating dates...`);
          console.log(`  - inspectionStartDate: ${inspectionStartDate.toISOString()}`);
          console.log(`  - inspectionEndDate: ${inspectionEndDate.toISOString()}`);
          console.log(`  - contractStartDate: ${contractStartDate.toISOString()}`);
          console.log(`  - contractEndDate: ${contractEndDate.toISOString()}`);
          
          // Check if end date is after start date
          if (inspectionEndDate < inspectionStartDate) {
            return res.status(400).json({
              error: 'Validation failed',
              message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй',
            });
          }
          
          // Check if inspection dates are within contract date range
          if (inspectionStartDate < contractStartDate || inspectionEndDate > contractEndDate) {
            return res.status(400).json({
              error: 'Validation failed',
              message: `Үзлэгийн хугацаа гэрээний хугацааны дотор байх ёстой. Гэрээний хугацаа: ${contractStartDate.toISOString().split('T')[0]} - ${contractEndDate.toISOString().split('T')[0]}`,
            });
          }
          
          console.log(`[POST /api/inspections] ✅ Date validation passed`);
        } else if (normalizedScheduleType === 'DAILY') {
          // For DAILY inspections, startedAt and completedAt are required
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Өдөр тутмын үзлэгийн хувьд эхлэх болон дуусах огноо заавал шаардлагатай',
          });
        }
      } else {
        console.log(`[POST /api/inspections] Contract exists but startDate or endDate is missing`);
      }
    } else {
      console.log(`[POST /api/inspections] No contract found for validation`);
    }

    // Create inspection
    const inspection = await prisma.Inspection.create({
      data: {
        orgId: BigInt(finalOrgId),
        deviceId: deviceId ? BigInt(deviceId) : null, // Optional for INSTALLATION type
        siteId: finalSiteId ? BigInt(finalSiteId) : null,
        contractId: finalContractId ? BigInt(finalContractId) : null,
        templateId: finalTemplateId ? BigInt(finalTemplateId) : null,
        type: normalizedType,
        scheduleType: normalizedScheduleType,
        title: title,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        startedAt: startedAt ? new Date(startedAt) : null,
        completedAt: completedAt ? new Date(completedAt) : null,
        status: 'DRAFT',
        progress: 0,
        createdBy: BigInt(req.user.id),
        notes: notes || null,
      },
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            model: {
              select: {
                id: true,
                manufacturer: true,
                model: true,
                deviceType: true,
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            type: true,
            deviceType: true,
          },
        },
      },
    });

    res.status(201).json({
      message: 'Inspection created successfully',
      data: {
        id: inspection.id.toString(),
        orgId: inspection.orgId.toString(),
        deviceId: inspection.deviceId?.toString(),
        siteId: inspection.siteId?.toString(),
        contractId: inspection.contractId?.toString(),
        templateId: inspection.templateId?.toString(),
        type: inspection.type,
        scheduleType: inspection.scheduleType,
        title: inspection.title,
        scheduledAt: inspection.scheduledAt,
        status: inspection.status,
        progress: inspection.progress,
        notes: inspection.notes,
        device: inspection.device
          ? {
              id: inspection.device.id.toString(),
              serialNumber: inspection.device.serialNumber,
              assetTag: inspection.device.assetTag,
              model: inspection.device.model ? {
                id: inspection.device.model.id.toString(),
                manufacturer: inspection.device.model.manufacturer,
                model: inspection.device.model.model,
                deviceType: inspection.device.model.deviceType,
              } : null,
            }
          : null,
        site: inspection.site
          ? {
              id: inspection.site.id.toString(),
              name: inspection.site.name,
            }
          : null,
        template: inspection.template
          ? {
              id: inspection.template.id.toString(),
              name: inspection.template.name,
              type: inspection.template.type,
              deviceType: inspection.template.deviceType,
            }
          : null,
        createdAt: inspection.createdAt,
        updatedAt: inspection.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error creating inspection:', error);
    res.status(500).json({
      error: 'Failed to create inspection',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * PUT /api/inspections/:id
 * Update an inspection
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, 
      scheduledAt, 
      startedAt, 
      completedAt, 
      notes, 
      status, 
      scheduleType,
      deviceId,
      templateId,
      contractId,
      siteId,
    } = req.body;

    // Check if inspection exists
    const inspection = await prisma.Inspection.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
      },
      include: {
        device: {
          include: {
            contract: true,
          },
        },
      },
    });

    if (!inspection) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Inspection not found',
      });
    }

    // Build update data
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (scheduledAt !== undefined)
      updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (startedAt !== undefined)
      updateData.startedAt = startedAt ? new Date(startedAt) : null;
    if (completedAt !== undefined)
      updateData.completedAt = completedAt ? new Date(completedAt) : null;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) {
      // Normalize status to uppercase to match Prisma enum (DRAFT, IN_PROGRESS, SUBMITTED, APPROVED, REJECTED, CANCELED)
      const normalizedStatus = status.toUpperCase();
      const allowedStatuses = ['DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELED'];
      if (!allowedStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `status must be one of: ${allowedStatuses.join(', ')}`,
        });
      }
      updateData.status = normalizedStatus;
    }

    // Handle deviceId update
    if (deviceId !== undefined) {
      if (deviceId === null || deviceId === '') {
        updateData.deviceId = null;
        // If device is removed, also remove contractId if it was linked to that device
        if (inspection.deviceId && inspection.contractId) {
          const oldDevice = await prisma.Device.findUnique({
            where: { id: inspection.deviceId },
            select: { contractId: true },
          });
          if (oldDevice?.contractId?.toString() === inspection.contractId?.toString()) {
            updateData.contractId = null;
          }
        }
      } else {
        // Verify device exists
        const device = await prisma.Device.findUnique({
          where: { id: BigInt(deviceId) },
          include: {
            organization: true,
            site: true,
            contract: true,
            model: {
              select: {
                id: true,
                manufacturer: true,
                model: true,
                deviceType: true,
              },
            },
          },
        });

        if (!device) {
          return res.status(404).json({
            error: 'Not found',
            message: 'Device not found',
          });
        }

        // Verify device belongs to same organization
        if (device.orgId.toString() !== inspection.orgId.toString()) {
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Device must belong to the same organization as the inspection',
          });
        }

        updateData.deviceId = BigInt(deviceId);
        
        // Auto-update siteId and contractId from device if not explicitly provided
        if (siteId === undefined && device.siteId) {
          updateData.siteId = device.siteId;
        }
        if (contractId === undefined && device.contractId) {
          updateData.contractId = device.contractId;
        }

        // Auto-select template based on device type if templateId is not explicitly provided
        // This is especially useful for repair assignments where device info is added later
        if (templateId === undefined && inspection.templateId === null) {
          // Use the device we already fetched (it includes model)
          if (device) {
            const deviceType = getDeviceType(device);
            
            if (deviceType) {
              console.log(`[PUT /api/inspections/:id] Auto-selecting template for device type ${deviceType}, inspection type ${inspection.type}`);
              
              const autoTemplate = await findTemplateByDeviceType(
                deviceType,
                inspection.type,
                false // Don't fallback to deviceType-only, require exact match
              );
              
              if (autoTemplate) {
                updateData.templateId = autoTemplate.id;
                console.log(`[PUT /api/inspections/:id] Auto-selected template ${autoTemplate.id.toString()} (${autoTemplate.name}) for device type ${deviceType}`);
              } else {
                console.warn(`[PUT /api/inspections/:id] No template found for device type ${deviceType} and inspection type ${inspection.type}`);
              }
            } else {
              console.warn(`[PUT /api/inspections/:id] Could not determine device type for device ${deviceId}`);
            }
          }
        }
      }
    }

    // Handle templateId update
    if (templateId !== undefined) {
      if (templateId === null || templateId === '') {
        updateData.templateId = null;
      } else {
        // Verify template exists
        const template = await prisma.InspectionTemplate.findUnique({
          where: { id: BigInt(templateId) },
        });

        if (!template) {
          return res.status(404).json({
            error: 'Not found',
            message: 'Template not found',
          });
        }

        // Verify template type matches inspection type
        if (template.type !== inspection.type) {
          return res.status(400).json({
            error: 'Validation failed',
            message: `Template type (${template.type}) must match inspection type (${inspection.type})`,
          });
        }

        updateData.templateId = BigInt(templateId);
      }
    }

    // Handle contractId update
    if (contractId !== undefined) {
      if (contractId === null || contractId === '') {
        updateData.contractId = null;
      } else {
        // Verify contract exists
        const contract = await prisma.Contract.findUnique({
          where: { id: BigInt(contractId) },
        });

        if (!contract) {
          return res.status(404).json({
            error: 'Not found',
            message: 'Contract not found',
          });
        }

        // Verify contract belongs to same organization
        if (contract.orgId.toString() !== inspection.orgId.toString()) {
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Contract must belong to the same organization as the inspection',
          });
        }

        updateData.contractId = BigInt(contractId);
      }
    }

    // Handle siteId update
    if (siteId !== undefined) {
      if (siteId === null || siteId === '') {
        updateData.siteId = null;
      } else {
        // Verify site exists
        const site = await prisma.Site.findUnique({
          where: { id: BigInt(siteId) },
        });

        if (!site) {
          return res.status(404).json({
            error: 'Not found',
            message: 'Site not found',
          });
        }

        // Verify site belongs to same organization
        if (site.orgId.toString() !== inspection.orgId.toString()) {
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Site must belong to the same organization as the inspection',
          });
        }

        updateData.siteId = BigInt(siteId);
      }
    }
    
    // Validate inspection dates are within contract date range (for updates)
    if ((startedAt !== undefined || completedAt !== undefined) && inspection.device?.contract) {
      const contractStartDate = inspection.device.contract.startDate;
      const contractEndDate = inspection.device.contract.endDate;
      
      if (contractStartDate && contractEndDate) {
        const inspectionStartDate = updateData.startedAt || inspection.startedAt;
        const inspectionEndDate = updateData.completedAt || inspection.completedAt;
        
        if (inspectionStartDate && inspectionEndDate) {
          if (inspectionStartDate < contractStartDate || inspectionEndDate > contractEndDate) {
            return res.status(400).json({
              error: 'Validation failed',
              message: `Үзлэгийн хугацаа гэрээний хугацааны дотор байх ёстой. Гэрээний хугацаа: ${contractStartDate.toISOString().split('T')[0]} - ${contractEndDate.toISOString().split('T')[0]}`,
            });
          }
          
          if (inspectionEndDate < inspectionStartDate) {
            return res.status(400).json({
              error: 'Validation failed',
              message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй',
            });
          }
        }
      }
    }
    if (scheduleType !== undefined) {
      const normalizedScheduleType = scheduleType.toUpperCase();
      const allowedScheduleTypes = ['DAILY', 'SCHEDULED'];
      if (!allowedScheduleTypes.includes(normalizedScheduleType)) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `scheduleType must be one of: ${allowedScheduleTypes.join(', ')}`,
        });
      }
      updateData.scheduleType = normalizedScheduleType;
    }
    updateData.updatedBy = BigInt(req.user.id);

    // Update inspection
    const updatedInspection = await prisma.Inspection.update({
      where: { id: BigInt(id) },
      data: updateData,
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            metadata: true,
            model: {
              select: {
                id: true,
                manufacturer: true,
                model: true,
                deviceType: true,
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            type: true,
            deviceType: true,
          },
        },
      },
    });

    res.json({
      message: 'Inspection updated successfully',
      data: {
        id: updatedInspection.id.toString(),
        orgId: updatedInspection.orgId.toString(),
        deviceId: updatedInspection.deviceId?.toString(),
        siteId: updatedInspection.siteId?.toString(),
        contractId: updatedInspection.contractId?.toString(),
        templateId: updatedInspection.templateId?.toString(),
        type: updatedInspection.type,
        scheduleType: updatedInspection.scheduleType,
        title: updatedInspection.title,
        scheduledAt: updatedInspection.scheduledAt,
        status: updatedInspection.status,
        notes: updatedInspection.notes,
        device: updatedInspection.device
          ? {
              id: updatedInspection.device.id.toString(),
              serialNumber: updatedInspection.device.serialNumber,
              assetTag: updatedInspection.device.assetTag,
              metadata: updatedInspection.device.metadata,
              model: updatedInspection.device.model
                ? {
                    id: updatedInspection.device.model.id.toString(),
                    manufacturer: updatedInspection.device.model.manufacturer,
                    model: updatedInspection.device.model.model,
                    deviceType: updatedInspection.device.model.deviceType,
                  }
                : null,
            }
          : null,
        contract: updatedInspection.contract
          ? {
              id: updatedInspection.contract.id.toString(),
              contractName: updatedInspection.contract.contractName,
              contractNumber: updatedInspection.contract.contractNumber,
            }
          : null,
        site: updatedInspection.site
          ? {
              id: updatedInspection.site.id.toString(),
              name: updatedInspection.site.name,
            }
          : null,
        template: updatedInspection.template
          ? {
              id: updatedInspection.template.id.toString(),
              name: updatedInspection.template.name,
              type: updatedInspection.template.type,
              deviceType: updatedInspection.template.deviceType,
            }
          : null,
        updatedAt: updatedInspection.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating inspection:', error);
    res.status(500).json({
      error: 'Failed to update inspection',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * DELETE /api/inspections/:id
 * Hard delete an inspection (permanently remove from MySQL)
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ DELETE inspection request: ID=${id}, User=${req.user.id}`);

    // Check if inspection exists
    const inspection = await prisma.Inspection.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
      },
    });

    if (!inspection) {
      console.log(`❌ Inspection not found: ID=${id}`);
      return res.status(404).json({
        error: 'Not found',
        message: 'Inspection not found',
      });
    }

    console.log(`✅ Inspection found: ${inspection.title} (ID=${id})`);

    // Hard delete - permanently remove from database
    // Delete in the correct order to avoid foreign key constraint violations
    
    // Step 1: Delete related RepairImages (they have foreign key to Repair)
    console.log(`🗑️ Step 1: Deleting repair images for inspection ${id}...`);
    try {
      const repairImages = await prisma.RepairImage.findMany({
        where: {
          repair: {
            inspectionId: BigInt(id),
          },
        },
        select: { id: true },
      });
      
      if (repairImages.length > 0) {
        const repairImageIds = repairImages.map(img => img.id);
        await prisma.RepairImage.deleteMany({
          where: {
            id: { in: repairImageIds },
          },
        });
        console.log(`✅ Deleted ${repairImages.length} repair image(s)`);
      } else {
        console.log(`ℹ️  No repair images found for inspection ${id}`);
      }
    } catch (repairImageError) {
      console.error('⚠️ Error deleting repair images (non-critical):', repairImageError.message);
    }

    // Step 2: Delete related Repairs
    console.log(`🗑️ Step 2: Deleting repairs for inspection ${id}...`);
    try {
      const deleteRepairsResult = await prisma.Repair.deleteMany({
        where: {
          inspectionId: BigInt(id),
        },
      });
      console.log(`✅ Deleted ${deleteRepairsResult.count} repair(s) for inspection ${id}`);
    } catch (repairError) {
      console.error('⚠️ Error deleting repairs (non-critical):', repairError.message);
      // Continue even if repair deletion fails - might not exist
    }

    // Step 3: Delete related inspection_question_images (using answer_id, not inspection_id)
    console.log(`🗑️ Step 3: Deleting inspection question images for inspection ${id}...`);
    try {
      // First, get all answer_ids for this inspection
      const answers = await prisma.InspectionAnswer.findMany({
        where: { inspectionId: BigInt(id) },
        select: { id: true },
      });

      if (answers.length > 0) {
        const answerIds = answers.map(a => a.id);
        
        // Check if inspection_question_images table exists
        const tableCheck = await prisma.$queryRaw`
          SELECT COUNT(*) as count
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
          AND table_name = 'inspection_question_images'
        `;
        
        const tableExists = tableCheck?.[0]?.count > 0;
        
        if (tableExists) {
          // Delete images using answer_id (correct column name)
          // Delete for each answer_id to avoid SQL injection and handle BigInt correctly
          let totalDeleted = 0;
          for (const answerId of answerIds) {
            const deleteResult = await prisma.$executeRaw`
              DELETE FROM inspection_question_images
              WHERE answer_id = ${answerId}
            `;
            totalDeleted += deleteResult;
          }
          
          console.log(`✅ Deleted images from inspection_question_images for inspection ${id} (affected rows: ${totalDeleted})`);
        } else {
          console.log(`⚠️ inspection_question_images table does not exist, skipping image deletion`);
        }
      } else {
        console.log(`ℹ️  No inspection answers found for inspection ${id}, skipping image deletion`);
      }
    } catch (imageError) {
      console.error('⚠️ Error deleting inspection_question_images (non-critical):', imageError.message);
      // Continue with inspection deletion even if image deletion fails
    }

    // Step 3b: Delete FTP storage files for this inspection (inspection_{id}_ans_*)
    console.log(`🗑️ Step 3b: Deleting FTP storage images for inspection ${id}...`);
    try {
      const prefix = `inspection_${id}_`;
      const files = await fsPromises.readdir(FTP_STORAGE_PATH);
      const toDelete = files.filter((f) => f.startsWith(prefix));
      for (const file of toDelete) {
        const filePath = path.join(FTP_STORAGE_PATH, file);
        try {
          await fsPromises.unlink(filePath);
          console.log(`  ✅ Deleted FTP file: ${file}`);
        } catch (unlinkErr) {
          console.warn(`  ⚠️ Could not delete ${filePath}:`, unlinkErr.message);
        }
      }
      if (toDelete.length > 0) {
        console.log(`✅ Deleted ${toDelete.length} FTP file(s) for inspection ${id}`);
      } else {
        console.log(`ℹ️  No FTP files found matching ${prefix}*`);
      }
    } catch (ftpErr) {
      console.error('⚠️ Error deleting FTP inspection images (non-critical):', ftpErr.message);
    }

    // Step 4: Hard delete the inspection
    // This will cascade delete InspectionAnswer, InspectionQuestionAnswer, and Attachment records
    console.log(`🗑️ Step 4: Attempting to hard delete inspection: ${inspection.title} (ID=${id})`);
    const deletedInspection = await prisma.Inspection.delete({
      where: { id: BigInt(id) },
    });

    console.log(`✅ Inspection hard deleted successfully from MySQL: ${deletedInspection.title} (ID=${id})`);
    res.json({
      message: 'Inspection deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting inspection:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      inspectionId: id,
    });
    res.status(500).json({
      error: 'Failed to delete inspection',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        stack: error.stack,
      } : undefined,
    });
  }
});

/**
 * PUT /api/inspections/site/:siteId/assign
 * Assign all inspections in a site to a user
 * This is used for repair assignment - assigning site inspections makes repairs visible to user
 * IMPORTANT: This route must be registered BEFORE /:id/assign route to avoid route conflicts
 */
router.put('/site/:siteId/assign', authMiddleware, async (req, res) => {
  try {
    const { siteId } = req.params;
    const { userId } = req.body;

    console.log(`[PUT /site/:siteId/assign] Assigning site ${siteId} inspections to user ${userId}`);

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'userId is required',
      });
    }

    // Check if site exists
    const site = await prisma.Site.findUnique({
      where: { id: BigInt(siteId) },
      include: {
        _count: {
          select: {
            inspections: true,
          },
        },
      },
    });

    if (!site) {
      console.error(`[PUT /site/:siteId/assign] Site ${siteId} not found`);
      return res.status(404).json({
        error: 'Site not found',
        message: 'Site not found',
      });
    }

    console.log(`[PUT /site/:siteId/assign] Site found: ${site.name} (ID: ${site.id.toString()}), orgId: ${site.orgId.toString()}, total inspections in relation: ${site._count.inspections}`);

    // Also check inspections by organization and site name (in case siteId is null in some inspections)
    const inspectionsByOrg = await prisma.Inspection.findMany({
      where: {
        orgId: site.orgId,
        siteId: null, // Check if there are inspections with null siteId
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
      take: 5,
    });

    if (inspectionsByOrg.length > 0) {
      console.log(`[PUT /site/:siteId/assign] WARNING: Found ${inspectionsByOrg.length} inspection(s) with null siteId but matching orgId ${site.orgId.toString()}`);
    }

    // Check if target user exists and is active
    const targetUser = await prisma.User.findFirst({
      where: {
        id: BigInt(userId),
        deletedAt: null,
        isActive: true,
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found or inactive',
      });
    }

    // Debug: Check all inspections for this site (including deleted ones)
    const allInspections = await prisma.Inspection.findMany({
      where: {
        siteId: BigInt(siteId),
      },
      select: {
        id: true,
        title: true,
        status: true,
        deletedAt: true,
        assignedTo: true,
        type: true,
      },
    });

    console.log(`[PUT /site/:siteId/assign] DEBUG: Found ${allInspections.length} total inspection(s) for site ${siteId} (including deleted)`);
    if (allInspections.length > 0) {
      console.log(`[PUT /site/:siteId/assign] DEBUG: Sample inspections:`, allInspections.slice(0, 3).map(i => ({
        id: i.id.toString(),
        title: i.title,
        status: i.status,
        deletedAt: i.deletedAt,
        assignedTo: i.assignedTo?.toString(),
        type: i.type,
      })));
    }

    // Find all inspections for this site that are not deleted
    // First try direct siteId match
    let inspections = await prisma.Inspection.findMany({
      where: {
        siteId: BigInt(siteId),
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        assignedTo: true,
        type: true,
        deviceId: true,
      },
    });

    console.log(`[PUT /site/:siteId/assign] Found ${inspections.length} active (non-deleted) inspection(s) with direct siteId=${siteId}`);

    // If no inspections found with direct siteId, try finding inspections through devices in this site
    if (inspections.length === 0) {
      console.log(`[PUT /site/:siteId/assign] No inspections with direct siteId, checking through devices...`);
      
      // Find devices in this site
      const devicesInSite = await prisma.Device.findMany({
        where: {
          siteId: BigInt(siteId),
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      console.log(`[PUT /site/:siteId/assign] Found ${devicesInSite.length} device(s) in site ${siteId}`);

      if (devicesInSite.length > 0) {
        const deviceIds = devicesInSite.map(d => d.id);
        console.log(`[PUT /site/:siteId/assign] Device IDs in site:`, deviceIds.map(id => id.toString()));
        
        // Debug: Check all inspections for these devices (including deleted)
        const allDeviceInspections = await prisma.Inspection.findMany({
          where: {
            deviceId: {
              in: deviceIds,
            },
          },
          select: {
            id: true,
            title: true,
            status: true,
            deviceId: true,
            siteId: true,
            orgId: true,
            deletedAt: true,
          },
        });
        console.log(`[PUT /site/:siteId/assign] DEBUG: Found ${allDeviceInspections.length} total inspection(s) for devices (including deleted)`);
        if (allDeviceInspections.length > 0) {
          console.log(`[PUT /site/:siteId/assign] DEBUG: Device inspections:`, allDeviceInspections.map(i => ({
            id: i.id.toString(),
            deviceId: i.deviceId?.toString(),
            siteId: i.siteId?.toString(),
            orgId: i.orgId.toString(),
            deletedAt: i.deletedAt,
          })));
        }
        
        // Find inspections for these devices
        inspections = await prisma.Inspection.findMany({
          where: {
            deviceId: {
              in: deviceIds,
            },
            orgId: site.orgId, // Also match by organization
            deletedAt: null,
          },
          select: {
            id: true,
            title: true,
            status: true,
            assignedTo: true,
            type: true,
            deviceId: true,
            siteId: true,
          },
        });

        console.log(`[PUT /site/:siteId/assign] Found ${inspections.length} active inspection(s) through devices in site ${siteId}`);
        
        // If still no inspections, try without orgId filter (in case orgId mismatch)
        if (inspections.length === 0) {
          console.log(`[PUT /site/:siteId/assign] No inspections with orgId filter, trying without orgId filter...`);
          inspections = await prisma.Inspection.findMany({
            where: {
              deviceId: {
                in: deviceIds,
              },
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              status: true,
              assignedTo: true,
              type: true,
              deviceId: true,
              siteId: true,
              orgId: true,
            },
          });
          console.log(`[PUT /site/:siteId/assign] Found ${inspections.length} inspection(s) without orgId filter`);
        }
        
        // Update these inspections to have the correct siteId if they don't have it
        if (inspections.length > 0) {
          const inspectionsWithoutSiteId = inspections.filter(i => !i.siteId);
          if (inspectionsWithoutSiteId.length > 0) {
            console.log(`[PUT /site/:siteId/assign] Found ${inspectionsWithoutSiteId.length} inspection(s) without siteId, will update them`);
          }
        }
      }
      
      // If still no inspections found, try finding by organization only (in case deviceId is null)
      if (inspections.length === 0) {
        console.log(`[PUT /site/:siteId/assign] No inspections through devices, trying by organization only...`);
        const orgInspections = await prisma.Inspection.findMany({
          where: {
            orgId: site.orgId,
            deletedAt: null,
            // Try to find inspections that might be related to this site but don't have siteId set
            OR: [
              { siteId: null },
              { siteId: BigInt(siteId) },
            ],
          },
          select: {
            id: true,
            title: true,
            status: true,
            assignedTo: true,
            type: true,
            deviceId: true,
            siteId: true,
          },
          take: 20, // Limit to avoid too many results
        });
        console.log(`[PUT /site/:siteId/assign] Found ${orgInspections.length} inspection(s) by organization (orgId: ${site.orgId.toString()})`);
        if (orgInspections.length > 0) {
          console.log(`[PUT /site/:siteId/assign] Sample org inspections:`, orgInspections.slice(0, 3).map(i => ({
            id: i.id.toString(),
            deviceId: i.deviceId?.toString(),
            siteId: i.siteId?.toString(),
          })));
          // Use these inspections if we found any
          inspections = orgInspections;
        }
      }
    }

    if (inspections.length > 0) {
      console.log(`[PUT /site/:siteId/assign] Current inspection details:`, inspections.map(i => ({
        id: i.id.toString(),
        title: i.title,
        status: i.status,
        assignedTo: i.assignedTo?.toString(),
        type: i.type,
        deviceId: i.deviceId?.toString(),
        siteId: i.siteId?.toString(),
      })));
    }

    if (inspections.length === 0) {
      console.log(`[PUT /site/:siteId/assign] No inspections found for site ${siteId}, creating new maintenance inspection...`);
      
      // Create a new inspection for repair/maintenance assignment
      try {
        const newInspection = await prisma.Inspection.create({
          data: {
            orgId: site.orgId,
            siteId: BigInt(siteId),
            deviceId: null, // Will be set later from Flutter app
            contractId: null, // Will be set later if needed
            templateId: null, // Will be set later from Flutter app
            type: 'MAINTENANCE',
            scheduleType: 'SCHEDULED', // Use SCHEDULED instead of DAILY to avoid showing in daily inspections list
            title: `${site.name} - Засварын томилолт`,
            scheduledAt: new Date(),
            status: 'DRAFT',
            progress: 0,
            assignedTo: BigInt(userId),
            createdBy: BigInt(req.user.id),
            updatedBy: BigInt(req.user.id),
            notes: 'Засварын томилолт (admin-web-аас автоматаар үүсгэсэн)',
          },
        });

        console.log(`[PUT /site/:siteId/assign] Created new inspection ${newInspection.id.toString()} for site ${siteId}`);

      return res.json({
          message: `Successfully created and assigned 1 new inspection for repairs`,
        data: {
          siteId,
            userId,
            inspectionsAssigned: 1,
            inspections: [{
              id: newInspection.id.toString(),
              title: newInspection.title,
              status: newInspection.status,
              type: newInspection.type,
              isNewlyCreated: true,
            }],
        },
      });
      } catch (createError) {
        console.error(`[PUT /site/:siteId/assign] Error creating new inspection:`, createError);
        return res.status(500).json({
          error: 'Failed to create inspection',
          message: process.env.NODE_ENV === 'development' ? createError.message : 'Could not create inspection for repair assignment',
        });
      }
    }

    // Update all inspections to assign them to the user and set type to MAINTENANCE for repair assignment
    // Use explicit updatedAt to ensure the timestamp is updated
    const updateData = {
      assignedTo: BigInt(userId),
      type: 'MAINTENANCE',
      updatedBy: BigInt(req.user.id),
      updatedAt: new Date(),
      // Also update siteId if it was null (for inspections found through devices)
      siteId: BigInt(siteId),
    };

    console.log(`[PUT /site/:siteId/assign] Updating ${inspections.length} inspection(s) with data:`, {
      assignedTo: userId,
      type: 'MAINTENANCE',
      updatedBy: req.user.id,
      siteId: siteId,
    });

    // Get inspection IDs to update
    const inspectionIds = inspections.map(i => i.id);

    // Update inspections by their IDs (this works for both direct siteId and device-based inspections)
    const updatedInspections = await prisma.Inspection.updateMany({
      where: {
        id: {
          in: inspectionIds,
        },
        deletedAt: null,
      },
      data: updateData,
    });

    console.log(`[PUT /site/:siteId/assign] Update result: ${updatedInspections.count} inspection(s) updated (out of ${inspectionIds.length} found)`);

    // Verify the update actually happened by querying the database
    const verifyInspections = await prisma.Inspection.findMany({
      where: {
        siteId: BigInt(siteId),
        deletedAt: null,
        assignedTo: BigInt(userId),
      },
      select: {
        id: true,
        assignedTo: true,
        type: true,
        updatedAt: true,
      },
      take: 5, // Check first 5 to verify
    });

    console.log(`[PUT /site/:siteId/assign] Verification: Found ${verifyInspections.length} inspection(s) with assignedTo=${userId}`);
    if (verifyInspections.length > 0) {
      console.log(`[PUT /site/:siteId/assign] Sample updated inspection:`, {
        id: verifyInspections[0].id.toString(),
        assignedTo: verifyInspections[0].assignedTo?.toString(),
        type: verifyInspections[0].type,
        updatedAt: verifyInspections[0].updatedAt,
      });
    }

    if (updatedInspections.count === 0) {
      console.warn(`[PUT /site/:siteId/assign] WARNING: updateMany returned count=0, but ${inspections.length} inspections were found`);
      return res.status(500).json({
        error: 'Update failed',
        message: 'No inspections were updated. This may indicate a database constraint issue.',
      data: {
          siteId,
          inspectionsFound: inspections.length,
          inspectionsUpdated: 0,
      },
    });
    }

    // Verify that the update actually persisted
    if (verifyInspections.length === 0 && updatedInspections.count > 0) {
      console.error(`[PUT /site/:siteId/assign] ERROR: updateMany reported ${updatedInspections.count} updates, but verification query found 0`);
      return res.status(500).json({
        error: 'Update verification failed',
        message: 'The update was reported as successful, but the data was not persisted in the database.',
        data: {
          siteId,
          inspectionsFound: inspections.length,
          inspectionsUpdated: updatedInspections.count,
          verifiedCount: 0,
        },
      });
    }

    // If verification found fewer than expected, log a warning but don't fail
    if (verifyInspections.length < Math.min(updatedInspections.count, 5)) {
      console.warn(`[PUT /site/:siteId/assign] WARNING: Expected at least ${Math.min(updatedInspections.count, 5)} updated inspections, but verification found ${verifyInspections.length}`);
    }

    res.json({
      message: `Successfully assigned ${updatedInspections.count} inspection(s) to user`,
      data: {
        siteId,
        userId,
        inspectionsAssigned: updatedInspections.count,
        inspections: inspections.map(i => ({
          id: i.id.toString(),
          title: i.title,
          status: i.status,
        })),
      },
    });
  } catch (error) {
    console.error('Error assigning site inspections:', error);
    res.status(500).json({
      error: 'Failed to assign site inspections',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * PUT /api/inspections/contract/:contractId/assign
 * Assign all inspections in a contract to a user
 * This is used for repair assignment - assigning contract inspections makes repairs visible to user
 * IMPORTANT: This route must be registered BEFORE /:id/assign route to avoid route conflicts
 */
router.put('/contract/:contractId/assign', authMiddleware, async (req, res) => {
  try {
    const { contractId } = req.params;
    const { userId } = req.body;

    console.log(`[PUT /contract/:contractId/assign] Assigning contract ${contractId} inspections to user ${userId}`);

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'userId is required',
      });
    }

    // Check if contract exists
    const contract = await prisma.Contract.findUnique({
      where: { id: BigInt(contractId) },
      include: {
        _count: {
          select: {
            inspections: true,
          },
        },
      },
    });

    if (!contract) {
      console.error(`[PUT /contract/:contractId/assign] Contract ${contractId} not found`);
      return res.status(404).json({
        error: 'Contract not found',
        message: 'Contract not found',
      });
    }

    console.log(`[PUT /contract/:contractId/assign] Contract found: ${contract.contractName} (ID: ${contract.id.toString()}), orgId: ${contract.orgId.toString()}, total inspections: ${contract._count.inspections}`);

    // Check if target user exists and is active
    const targetUser = await prisma.User.findFirst({
      where: {
        id: BigInt(userId),
        deletedAt: null,
        isActive: true,
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found or inactive',
      });
    }

    // Find all inspections for this contract
    // First try direct contractId match
    let inspections = await prisma.Inspection.findMany({
      where: {
        contractId: BigInt(contractId),
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        type: true,
        deviceId: true,
        siteId: true,
        orgId: true,
      },
    });

    console.log(`[PUT /contract/:contractId/assign] Found ${inspections.length} active (non-deleted) inspection(s) with direct contractId=${contractId}`);

    // If no inspections found with direct contractId, try finding inspections through devices in this contract
    if (inspections.length === 0) {
      console.log(`[PUT /contract/:contractId/assign] No inspections with direct contractId, checking through devices...`);
      
      // Find devices in this contract
      const devicesInContract = await prisma.Device.findMany({
        where: {
          contractId: BigInt(contractId),
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      console.log(`[PUT /contract/:contractId/assign] Found ${devicesInContract.length} device(s) in contract ${contractId}`);

      if (devicesInContract.length > 0) {
        const deviceIds = devicesInContract.map(d => d.id);
        console.log(`[PUT /contract/:contractId/assign] Device IDs in contract:`, deviceIds.map(id => id.toString()));
        
        // Find inspections for these devices
        inspections = await prisma.Inspection.findMany({
          where: {
            deviceId: {
              in: deviceIds,
            },
            orgId: contract.orgId, // Also match by organization
            deletedAt: null,
          },
          select: {
            id: true,
            title: true,
            status: true,
            type: true,
            deviceId: true,
            siteId: true,
            orgId: true,
          },
        });

        console.log(`[PUT /contract/:contractId/assign] Found ${inspections.length} active inspection(s) through devices in contract ${contractId}`);
        
        // If still no inspections, try without orgId filter (in case orgId mismatch)
        if (inspections.length === 0) {
          console.log(`[PUT /contract/:contractId/assign] No inspections with orgId filter, trying without orgId filter...`);
          inspections = await prisma.Inspection.findMany({
            where: {
              deviceId: {
                in: deviceIds,
              },
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              status: true,
              type: true,
              deviceId: true,
              siteId: true,
              orgId: true,
            },
          });
          console.log(`[PUT /contract/:contractId/assign] Found ${inspections.length} inspection(s) without orgId filter`);
        }
        
        // Update these inspections to have the correct contractId if they don't have it
        if (inspections.length > 0) {
          const inspectionsWithoutContractId = inspections.filter(i => !i.contractId);
          if (inspectionsWithoutContractId.length > 0) {
            console.log(`[PUT /contract/:contractId/assign] Found ${inspectionsWithoutContractId.length} inspection(s) without contractId, will update them`);
          }
        }
      }
      
      // If still no inspections found, try finding by organization only (in case deviceId is null)
      if (inspections.length === 0) {
        console.log(`[PUT /contract/:contractId/assign] No inspections through devices, trying by organization only...`);
        const orgInspections = await prisma.Inspection.findMany({
          where: {
            orgId: contract.orgId,
            deletedAt: null,
            // Try to find inspections that might be related to this contract but don't have contractId set
            OR: [
              { contractId: null },
              { contractId: BigInt(contractId) },
            ],
          },
          select: {
            id: true,
            title: true,
            status: true,
            type: true,
            deviceId: true,
            siteId: true,
            orgId: true,
          },
          take: 20, // Limit to avoid too many results
        });
        console.log(`[PUT /contract/:contractId/assign] Found ${orgInspections.length} inspection(s) by organization (orgId: ${contract.orgId.toString()})`);
        if (orgInspections.length > 0) {
          console.log(`[PUT /contract/:contractId/assign] Sample org inspections:`, orgInspections.slice(0, 3).map(i => ({
            id: i.id.toString(),
            deviceId: i.deviceId?.toString(),
            contractId: i.contractId?.toString(),
          })));
          // Use these inspections if we found any
          inspections = orgInspections;
        }
      }
    }

    if (inspections.length === 0) {
      console.log(`[PUT /contract/:contractId/assign] No inspections found for contract ${contractId}, creating new maintenance inspection...`);
      
      // Create a new inspection for repair/maintenance assignment
      try {
        const newInspection = await prisma.Inspection.create({
          data: {
            orgId: contract.orgId,
            contractId: BigInt(contractId),
            deviceId: null, // Will be set later from Flutter app
            siteId: null, // Will be set later if needed
            templateId: null, // Will be set later from Flutter app
            type: 'MAINTENANCE',
            scheduleType: 'SCHEDULED', // Use SCHEDULED instead of DAILY to avoid showing in daily inspections list
            title: `${contract.contractName} - Засварын томилолт`,
            scheduledAt: new Date(),
            status: 'DRAFT',
            progress: 0,
            assignedTo: BigInt(userId),
            createdBy: BigInt(req.user.id),
            updatedBy: BigInt(req.user.id),
            notes: 'Засварын томилолт (admin-web-аас автоматаар үүсгэсэн)',
          },
        });

        console.log(`[PUT /contract/:contractId/assign] Created new inspection ${newInspection.id.toString()} for contract ${contractId}`);

        return res.json({
          message: `Successfully created and assigned 1 new inspection for repairs`,
          data: {
            contractId,
            userId,
            inspectionsAssigned: 1,
            inspections: [{
              id: newInspection.id.toString(),
              title: newInspection.title,
              status: newInspection.status,
              type: newInspection.type,
              isNewlyCreated: true,
            }],
          },
        });
      } catch (createError) {
        console.error(`[PUT /contract/:contractId/assign] Error creating new inspection:`, createError);
        return res.status(500).json({
          error: 'Failed to create inspection',
          message: process.env.NODE_ENV === 'development' ? createError.message : 'Could not create inspection for repair assignment',
        });
      }
    }

    // Update all inspections to assign them to the user and set type to MAINTENANCE for repair assignment
    // Also update contractId if it was null (for inspections found through devices)
    const updateData = {
      assignedTo: BigInt(userId),
      type: 'MAINTENANCE',
      updatedBy: BigInt(req.user.id),
      updatedAt: new Date(),
      contractId: BigInt(contractId), // Ensure contractId is set
    };

    console.log(`[PUT /contract/:contractId/assign] Updating ${inspections.length} inspection(s) with data:`, {
      assignedTo: userId,
      type: 'MAINTENANCE',
      updatedBy: req.user.id,
    });

    // Get inspection IDs to update
    const inspectionIds = inspections.map(i => i.id);

    // Update inspections by their IDs
    const updatedInspections = await prisma.Inspection.updateMany({
      where: {
        id: {
          in: inspectionIds,
        },
        deletedAt: null,
      },
      data: updateData,
    });

    console.log(`[PUT /contract/:contractId/assign] Update result: ${updatedInspections.count} inspection(s) updated (out of ${inspectionIds.length} found)`);

    // Verify the update actually happened by querying the database
    const verifyInspections = await prisma.Inspection.findMany({
      where: {
        contractId: BigInt(contractId),
        deletedAt: null,
        assignedTo: BigInt(userId),
      },
      select: {
        id: true,
        assignedTo: true,
        type: true,
        updatedAt: true,
      },
      take: 5, // Check first 5 to verify
    });

    console.log(`[PUT /contract/:contractId/assign] Verification: Found ${verifyInspections.length} inspection(s) with assignedTo=${userId}`);

    if (updatedInspections.count === 0) {
      console.warn(`[PUT /contract/:contractId/assign] WARNING: updateMany returned count=0, but ${inspections.length} inspections were found`);
      return res.status(500).json({
        error: 'Update failed',
        message: 'No inspections were updated. This may indicate a database constraint issue.',
      });
    }

    // Verify that the update actually persisted
    if (verifyInspections.length === 0 && updatedInspections.count > 0) {
      console.error(`[PUT /contract/:contractId/assign] ERROR: updateMany reported ${updatedInspections.count} updates, but verification query found 0`);
      return res.status(500).json({
        error: 'Update verification failed',
        message: 'The update was reported as successful, but the data was not persisted in the database.',
      });
    }

    res.json({
      message: `Successfully assigned ${updatedInspections.count} inspection(s) for repairs`,
      count: updatedInspections.count,
      contract: {
        id: contract.id.toString(),
        name: contract.contractName,
        number: contract.contractNumber,
      },
      assignedTo: {
        id: targetUser.id.toString(),
        name: targetUser.fullName,
        email: targetUser.email,
      },
    });
  } catch (error) {
    console.error(`[PUT /contract/:contractId/assign] Error:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * PUT /api/inspections/:id/assign
 * Assign an inspection to one or multiple users
 * Supports both single userId (string) and multiple userIds (array)
 */
router.put('/:id/assign', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userIds } = req.body;

    // Support both single userId and userIds array
    const userIdsToAssign = userIds || (userId ? [userId] : []);
    
    console.log(`Assigning inspection ${id} to users:`, userIdsToAssign);

    // Validate userIds
    if (!userIdsToAssign || userIdsToAssign.length === 0) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'userId or userIds array is required',
      });
    }

    // Check if inspection exists
    const inspection = await prisma.Inspection.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
      },
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
          },
        },
        organization: {
          select: {
            name: true,
          },
        },
        site: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found',
        message: 'Inspection not found',
      });
    }

    // Validate all users exist and are active
    const userIdsBigInt = userIdsToAssign.map(id => BigInt(id));
    const targetUsers = await prisma.User.findMany({
      where: {
        id: { in: userIdsBigInt },
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (targetUsers.length !== userIdsToAssign.length) {
      return res.status(404).json({
        error: 'User not found',
        message: 'One or more users not found or inactive',
      });
    }

    // Get existing assignments to avoid duplicates
    const existingAssignments = await prisma.InspectionAssignment.findMany({
      where: {
        inspectionId: BigInt(id),
      },
      select: {
        userId: true,
      },
    });

    const existingUserIds = new Set(existingAssignments.map(a => a.userId.toString()));
    
    // Only create assignments for users that don't already exist
    const newUserIds = userIdsBigInt.filter(userId => !existingUserIds.has(userId.toString()));
    
    // Remove assignments for users that are not in the new list
    const userIdsToRemove = existingAssignments
      .filter(a => !userIdsBigInt.some(newId => newId.toString() === a.userId.toString()))
      .map(a => a.userId);
    
    if (userIdsToRemove.length > 0) {
      await prisma.InspectionAssignment.deleteMany({
        where: {
          inspectionId: BigInt(id),
          userId: { in: userIdsToRemove },
        },
      });
    }

    // Create new assignments only for users that don't already exist
    let assignmentsCount = 0;
    if (newUserIds.length > 0) {
      const result = await prisma.InspectionAssignment.createMany({
        data: newUserIds.map(userIdBigInt => ({
          inspectionId: BigInt(id),
          userId: userIdBigInt,
          assignedBy: BigInt(req.user.id),
        })),
        skipDuplicates: true, // Extra safety to avoid duplicates
      });
      assignmentsCount = result.count;
    }
    
    // Total assignments count (existing + new)
    const totalAssignments = existingAssignments.length - userIdsToRemove.length + assignmentsCount;

    // Also update the legacy assignedTo field with the first user (for backward compatibility)
    const firstUserId = userIdsBigInt[0];
    await prisma.Inspection.update({
      where: { id: BigInt(id) },
      data: {
        assignedTo: firstUserId,
        updatedBy: BigInt(req.user.id),
      },
    });

    console.log(`[PUT /:id/assign] Inspection ${id} assigned successfully. Total: ${totalAssignments} user(s), New: ${assignmentsCount}, Removed: ${userIdsToRemove.length}`);

    // Send email notifications to all assigned users
    const orgName = inspection.organization?.name || 'Тодорхойгүй байгууллага';
    const siteName = inspection.site?.name || 'Талбайн мэдээлэл байхгүй';
    const scheduledDate = formatDateTime(inspection.scheduledAt);
    const deviceParts = [];

    if (inspection.device?.serialNumber) {
      deviceParts.push(`Сериал: ${inspection.device.serialNumber}`);
    }

    if (inspection.device?.assetTag) {
      deviceParts.push(`Asset: ${inspection.device.assetTag}`);
    }

    const deviceInfo =
      deviceParts.length > 0
        ? deviceParts.join(' / ')
        : 'Төхөөрөмжийн дэлгэрэнгүй мэдээлэл одоогоор байхгүй байна.';

    const instructions = inspection.notes?.trim()
      ? inspection.notes.trim()
      : 'Нэмэлт заавар ирээгүй байна. Дэлгэрэнгүйг систем дээрх тэмдэглэлээс шалгана уу.';

    // Send emails to all assigned users
    for (const user of targetUsers) {
      if (user.email) {
        const subject = `Шинэ үзлэгийн томилолт - ${inspection.title}`;
        const text = [
          `Сайн байна уу ${user.fullName || ''},`,
          '',
          'Танд дараах үзлэгийн томилолт ирлээ:',
          `• Үзлэг: ${inspection.title}`,
          `• Төрөл: ${inspection.type}`,
          `• Төлөвлөсөн огноо: ${scheduledDate}`,
          `• Байгууллага: ${orgName}`,
          `• Талбай: ${siteName}`,
          `• Төхөөрөмж: ${deviceInfo}`,
          '',
          'Үзлэгийн заавар / тэмдэглэл:',
          instructions,
          '',
          'Амжилттай гүйцэтгэнэ үү.',
          '',
          'Хүндэтгэсэн,',
          'Inspection System',
        ].join('\n');

        try {
          await sendInspectionAssignmentEmail({
            to: user.email,
            subject,
            text,
          });
        } catch (emailError) {
          console.error(`Failed to send assignment email to ${user.email}:`, emailError);
        }
      }
    }

    // Get updated inspection with assignments
    const updatedInspection = await prisma.Inspection.findUnique({
      where: { id: BigInt(id) },
      include: {
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    res.json({
      message: `Inspection assigned successfully to ${totalAssignments} user(s)`,
      data: {
        id: updatedInspection.id.toString(),
        title: updatedInspection.title,
        assignees: updatedInspection.assignments.map(a => ({
          id: a.user.id.toString(),
          fullName: a.user.fullName,
          email: a.user.email,
        })),
        // Keep backward compatibility
        assignee: updatedInspection.assignee
          ? {
              id: updatedInspection.assignee.id.toString(),
              fullName: updatedInspection.assignee.fullName,
              email: updatedInspection.assignee.email,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error assigning inspection:', error);
    res.status(500).json({
      error: 'Failed to assign inspection',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

module.exports = router;
