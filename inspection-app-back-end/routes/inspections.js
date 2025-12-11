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
const { sendInspectionAssignmentEmail, sendInspectionCompletionEmail } = require('../services/email-service');
const { generateInspectionDocx } = require('./documents');
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
 * Get section answers for a specific section
 */
async function getSectionAnswers(inspectionId, sectionName) {
  const answers = await prisma.InspectionAnswer.findMany({
    where: { inspectionId },
    orderBy: { answeredAt: 'asc' },
    select: { id: true, answers: true, answeredBy: true, answeredAt: true },
  });

  if (answers.length === 0) return {};

  // Find the latest answer that contains this section
  for (let i = answers.length - 1; i >= 0; i--) {
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
  
  const whereClause = {
    assignedTo: userId,
    deletedAt: null,
    status: {
      in: ACTIVE_STATUSES,
    },
  };

  if (inspectionType) whereClause.type = inspectionType;

  console.log(`[getAssignedInspectionsByType] Query:`, JSON.stringify({
    assignedTo: userId.toString(),
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
      device: {
        select: {
          id: true,
          serialNumber: true,
          assetTag: true,
          model: { select: { manufacturer: true, model: true } },
        },
      },
      site: { select: { id: true, name: true } },
      contract: {
        select: { id: true, contractName: true, contractNumber: true },
      },
      createdByUser: { select: { id: true, fullName: true, email: true } },
      template: { select: { id: true, name: true, type: true } },
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
    const allAssigned = await prisma.Inspection.findMany({
      where: {
        assignedTo: userId,
        deletedAt: null,
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
    createdBy: inspection.createdBy.toString(),
    updatedBy: inspection.updatedBy?.toString(),
    device: inspection.device
      ? { ...inspection.device, id: inspection.device.id.toString() }
      : null,
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
  const isCreator = inspection.createdBy.toString() === userId;
  return sameOrg || isAssignee || isCreator;
}

/**
 * Common inspection verification and access check
 */
async function verifyInspectionAccess(
  inspectionId,
  userId,
  orgIdFromToken,
  selectFields = {}
) {
  const defaultSelect = {
    id: true,
    orgId: true,
    assignedTo: true,
    createdBy: true,
    templateId: true,
    type: true,
    title: true,
  };

  const inspection = await prisma.Inspection.findUnique({
    where: { id: inspectionId },
    select: { ...defaultSelect, ...selectFields },
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
 */
async function getTemplateAndSections(inspection) {
  let template = null;
  if (inspection.templateId) {
    template = await prisma.InspectionTemplate.findUnique({
      where: { id: inspection.templateId },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        questions: true,
        isActive: true,
      },
    });
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
    if (currentUser?.role?.name !== 'admin') {
      whereClause.OR = [
        { orgId: BigInt(req.user.orgId) },
        { assignedTo: BigInt(req.user.id) },
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
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
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
      device: inspection.device
        ? {
            id: inspection.device.id.toString(),
            serialNumber: inspection.device.serialNumber,
            assetTag: inspection.device.assetTag,
            model: inspection.device.model,
          }
        : null,
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
      createdByUser: inspection.createdByUser
        ? {
            id: inspection.createdByUser.id.toString(),
            fullName: inspection.createdByUser.fullName,
          }
        : null,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,
    }));

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
    
    const whereClause = {
      deletedAt: null,
      scheduleType: requestedScheduleType,
      status: {
        in: ACTIVE_STATUSES,
      },
    };

    if (!isAdmin) {
      // Only filter by assignedTo to support cross-organization assignments
      // Remove orgId filter to allow users to see inspections assigned to them
      // from other organizations
      whereClause.assignedTo = BigInt(req.user.id);
    }
    
    console.log(`[GET /by-schedule-type/:scheduleType] Query:`, JSON.stringify({
      scheduleType: requestedScheduleType,
      status: { in: ACTIVE_STATUSES },
      assignedTo: !isAdmin ? req.user.id : 'all users (admin)',
      note: 'Cross-organization assignments are now supported'
    }, null, 2));

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
              },
            },
            metadata: true,
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
      notes: inspection.notes,
      device: inspection.device
        ? {
            id: inspection.device.id.toString(),
            serialNumber: inspection.device.serialNumber,
            assetTag: inspection.device.assetTag,
            model: inspection.device.model,
            metadata: inspection.device.metadata,
          }
        : null,
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
            select: { id: true, manufacturer: true, model: true, specs: true },
          },
          organization: { select: { id: true, name: true, code: true } },
          site: { select: { id: true, name: true } },
        },
      });

      if (device) {
        deviceInfo = {
          id: device.id.toString(),
          serialNumber: device.serialNumber,
          assetTag: device.assetTag,
          location: device.metadata?.location || 'Тодорхойлогдоогүй',
          model: { ...device.model, id: device.model?.id?.toString() },
          organization: device.organization
            ? { ...device.organization, id: device.organization.id.toString() }
            : null,
          site: device.site
            ? { ...device.site, id: device.site.id.toString() }
            : null,
          metadata: device.metadata,
        };
      }
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
        template: { ...template, id: template.id.toString() },
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
      orderBy: { answeredAt: 'asc' },
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
      orderBy: { answeredAt: 'asc' },
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

    // Get the latest answer
    const latestAnswer = sectionAnswers[sectionAnswers.length - 1];
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
      orderBy: { answeredAt: 'asc' },
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

    // Find the main inspection answer record
    const mainAnswer = await prisma.InspectionAnswer.findFirst({
      where: {
        inspectionId,
        answers: {
          path: '$.data',
          not: null,
        },
      },
      orderBy: { answeredAt: 'asc' },
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
      },
    });

    console.log(`Updated main record ${updatedAnswer.id} with signatures`);

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

    // Extract remarks and signatures from all answers
    let extractedRemarks = null;
    let extractedSignatures = null;
    let extractedMetadata = null;

    answers.forEach(answer => {
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
          },
        });

        console.log(
          `Updated target record ${updatedAnswer.id} with signature image`
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
      // Try to find any record for this inspection
      const anyAnswer = await prisma.InspectionAnswer.findFirst({
        where: { inspectionId },
        orderBy: { answeredAt: 'asc' },
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
        },
      });

      console.log(`Updated record ${updatedAnswer.id} with signature image`);

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
      },
    });

    console.log(`Updated main record ${updatedAnswer.id} with signature image`);
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
    const FTP_BASE_URL = process.env.FTP_BASE_URL || 'ftp://192.168.1.71';
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
      
      // Build FTP URL in format: ftp://192.168.0.6/test/{filename}
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

    // Debug: Log completion status for email sending
    console.log('📧 Email sending check:', {
      isCompletion: serviceResult.isCompletion,
      section: requestData.section,
      status: requestData.status,
      sectionStatus: requestData.sectionStatus,
      isLastSection: serviceResult.isLastSection,
      sectionOrder: serviceResult.sectionOrder,
      currentSectionIndex: serviceResult.currentSectionIndex,
    });

    // Send email with DOCX report when inspection is completed
    // Check if this is the signatures section and it's completed (final step)
    // Also check if all main sections are completed
    const isSignaturesCompleted = requestData.section === 'signatures' && 
                                  (requestData.sectionStatus === 'COMPLETED' || requestData.progress === 100);
    const allMainSectionsCompleted = completedSections.length >= 6; // exterior, indicator, jbox, sensor, foundation, cleanliness
    
    const shouldSendEmail = serviceResult.isCompletion || 
      (isSignaturesCompleted && allMainSectionsCompleted);

    if (shouldSendEmail) {
      console.log('📧 Email sending triggered:', {
        reason: serviceResult.isCompletion ? 'isCompletion=true' : 'signatures section completed with all main sections done',
        isSignaturesCompleted,
        allMainSectionsCompleted,
        completedSectionsCount: completedSections.length,
        completedSections: completedSections.map(s => s.section),
      });
      // Run email sending in background to avoid blocking the response
      (async () => {
        try {
          console.log('📧 Preparing to send completion email with DOCX report...');
          
          // Get inspection with organization details
          const inspection = await prisma.Inspection.findUnique({
            where: { id: BigInt(requestData.inspectionId) },
            select: {
              id: true,
              title: true,
              organization: {
                select: {
                  id: true,
                  name: true,
                  contactEmail: true,
                  contactName: true,
                },
              },
            },
          });

          if (!inspection) {
            console.warn('⚠️ Inspection not found for email sending');
            return;
          }

          // Check if organization has contact email
          if (!inspection.organization?.contactEmail) {
            console.warn(`⚠️ Organization ${inspection.organization?.name || 'Unknown'} does not have contact_email configured. Skipping email.`);
            return;
          }

          console.log(`📧 Generating DOCX report for inspection ${requestData.inspectionId}...`);
          
          // Generate DOCX report
          const answerId = serviceResult.result.sectionAnswer.id;
          const docxBuffer = await generateInspectionDocx(answerId);
          
          console.log(`📧 DOCX report generated (${docxBuffer.length} bytes). Sending email to ${inspection.organization.contactEmail}...`);

          // Send email with DOCX attachment
          await sendInspectionCompletionEmail({
            to: inspection.organization.contactEmail,
            organizationName: inspection.organization.name || 'Байгууллага',
            inspectionTitle: inspection.title || `Үзлэг #${requestData.inspectionId}`,
            inspectionId: requestData.inspectionId.toString(),
            completedAt: serviceResult.result.sectionAnswer.answeredAt || new Date(),
            contactName: inspection.organization.contactName || null,
            docxBuffer: docxBuffer,
          });

          console.log(`✅ Completion email with DOCX report sent successfully to ${inspection.organization.contactEmail}`);
        } catch (emailError) {
          // Log error but don't fail the request
          console.error('\n========================================');
          console.error('❌ EMAIL SENDING FAILED');
          console.error('========================================');
          console.error('Inspection ID:', requestData.inspectionId);
          console.error('Error Message:', emailError.message);
          console.error('Error Code:', emailError.code || 'N/A');
          console.error('Error Type:', emailError.name || 'Unknown');
          
          // Additional context
          if (emailError.code === 'EAUTH') {
            console.error('\n⚠️  AUTHENTICATION ERROR:');
            console.error('   - Check NOTIFY_EMAIL_USER and NOTIFY_EMAIL_PASSWORD in config.env');
            console.error('   - For Microsoft 365, use full email address as username');
            console.error('   - If MFA is enabled, use App Password instead of regular password');
          } else if (emailError.code === 'ECONNECTION') {
            console.error('\n⚠️  CONNECTION ERROR:');
            console.error('   - Check internet connection');
            console.error('   - Check NOTIFY_EMAIL_HOST setting (should be smtp.office365.com)');
            console.error('   - Check firewall settings (ports 587 or 465 should be open)');
          } else if (emailError.code === 'ETIMEDOUT') {
            console.error('\n⚠️  TIMEOUT ERROR:');
            console.error('   - Check network connection');
            console.error('   - Check firewall settings');
            console.error('   - SMTP server might be slow or unreachable');
          } else if (emailError.responseCode === 535) {
            console.error('\n⚠️  MICROSOFT 365 AUTHENTICATION FAILED:');
            if (emailError.response && emailError.response.includes('security defaults policy')) {
              console.error('   - ERROR: User is locked by organization\'s Security Defaults policy');
              console.error('   - SOLUTION: SMTP AUTH must be enabled for this mailbox');
              console.error('   - Contact your administrator to enable SMTP AUTH');
              console.error('   - Admin steps: Exchange Admin Center → Mailboxes → Select user → Mail → Enable "Authenticated SMTP"');
            } else {
              console.error('   - Invalid credentials');
              console.error('   - Check if MFA is enabled - use App Password if needed');
              console.error('   - Make sure you are using full email address as username');
            }
          } else if (emailError.responseCode === 550) {
            console.error('\n⚠️  MICROSOFT 365 ERROR:');
            console.error('   - Mailbox unavailable');
            console.error('   - Recipient email might be invalid or rejected');
          } else if (emailError.responseCode === 421) {
            console.error('\n⚠️  MICROSOFT 365 SERVICE ERROR:');
            console.error('   - Service temporarily unavailable');
            console.error('   - Try again later');
          }
          
          // Stack trace for debugging
          if (process.env.NODE_ENV === 'development') {
            console.error('\nStack Trace:');
            console.error(emailError.stack);
          }
          
          console.error('========================================\n');
        }
      })();
    }

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
      orderBy: { answeredAt: 'asc' },
    });

    // Organize answers by section
    const organizedAnswers = {};
    let inspectionMetadata = null;

    sectionAnswers.forEach(answer => {
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
    const assignedInspections = await prisma.Inspection.findMany({
      where: {
        assignedTo: userId,
        deletedAt: null,
        deviceId: { not: null }
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
    console.log('🔍 [GET /api/inspections/repairs-needed] Fetching inspections...');
    const inspections = await prisma.Inspection.findMany({
      where: {
        OR: [
          { orgId: user.orgId },
          { assignedTo: userId }
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
        orderBy: { answeredAt: 'asc' },
      });

      if (answers.length === 0) continue;

      // Get latest answer
      const latestAnswer = answers[answers.length - 1];
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
        id: true,
        orgId: true,
        deviceId: true,
        siteId: true,
        contractId: true,
        templateId: true,
        type: true,
        title: true,
        scheduleType: true,
        scheduledAt: true,
        startedAt: true,
        completedAt: true,
        status: true,
        progress: true,
        assignedTo: true,
        createdBy: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        device: {
          select: {
            id: true,
            serialNumber: true,
            assetTag: true,
            metadata: true,
            model: {
              select: { id: true, manufacturer: true, model: true, specs: true },
            },
            organization: { select: { id: true, name: true, code: true } },
            site: { select: { id: true, name: true } },
            contract: {
              select: {
                id: true,
                contractName: true,
                contractNumber: true,
              },
            },
          },
        },
        assignee: {
          select: { id: true, fullName: true, email: true },
        },
        template: {
          select: { id: true, name: true, type: true },
        },
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
      device: inspection.device
        ? {
            id: inspection.device.id.toString(),
            serialNumber: inspection.device.serialNumber,
            assetTag: inspection.device.assetTag,
            metadata: inspection.device.metadata,
            model: inspection.device.model
              ? {
                  ...inspection.device.model,
                  id: inspection.device.model.id.toString(),
                }
              : null,
            organization: inspection.device.organization
              ? {
                  ...inspection.device.organization,
                  id: inspection.device.organization.id.toString(),
                }
              : null,
            site: inspection.device.site
              ? {
                  ...inspection.device.site,
                  id: inspection.device.site.id.toString(),
                }
              : null,
            contract: inspection.device.contract
              ? {
                  ...inspection.device.contract,
                  id: inspection.device.contract.id.toString(),
                }
              : null,
          }
        : null,
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

    return res.json({
      message: 'Inspection retrieved successfully',
      data: formatted,
    });
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
      notes,
    } = req.body;

    // Validation
    if (!deviceId || !type || !title) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device, type, and title are required',
      });
    }

    // Verify device exists and get related data
    const device = await prisma.Device.findUnique({
      where: { id: BigInt(deviceId) },
      include: {
        organization: true,
        site: true,
        contract: true,
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Device not found',
      });
    }

    // Use device's related data if not provided
    const finalOrgId = orgId || device.orgId.toString();
    const finalSiteId = siteId || device.siteId?.toString();
    const finalContractId = contractId || device.contractId?.toString();

    // Verify template if provided
    if (templateId) {
      const template = await prisma.InspectionTemplate.findUnique({
        where: { id: BigInt(templateId) },
      });

      if (!template) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Template not found',
        });
      }
    }

    // Normalize type to uppercase (Prisma enum requirement)
    const normalizedType = type.toUpperCase();
    
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

    // Create inspection
    const inspection = await prisma.Inspection.create({
      data: {
        orgId: BigInt(finalOrgId),
        deviceId: BigInt(deviceId),
        siteId: finalSiteId ? BigInt(finalSiteId) : null,
        contractId: finalContractId ? BigInt(finalContractId) : null,
        templateId: templateId ? BigInt(templateId) : null,
        type: normalizedType,
        scheduleType: normalizedScheduleType,
        title: title,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
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
    const { title, scheduledAt, notes, status, scheduleType } = req.body;

    // Check if inspection exists
    const inspection = await prisma.Inspection.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
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
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;
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
    // First, delete related inspection_question_images (raw SQL table)
    try {
      // Check if inspection_question_images table exists
      const tableCheck = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_name = 'inspection_question_images'
      `;
      
      const tableExists = tableCheck?.[0]?.count > 0;
      
      if (tableExists) {
        console.log(`🗑️ Deleting related images from inspection_question_images for inspection ${id}...`);
        
        // Delete images using inspection_id directly
        const deleteResult = await prisma.$executeRaw`
          DELETE FROM inspection_question_images
          WHERE inspection_id = ${BigInt(id)}
        `;
        
        console.log(`✅ Deleted images from inspection_question_images for inspection ${id} (affected rows: ${deleteResult})`);
      } else {
        console.log(`⚠️ inspection_question_images table does not exist, skipping image deletion`);
      }
    } catch (imageError) {
      console.error('⚠️ Error deleting inspection_question_images (non-critical):', imageError.message);
      // Continue with inspection deletion even if image deletion fails
    }

    // Hard delete the inspection
    // This will cascade delete InspectionAnswer, InspectionQuestionAnswer, and Attachment records
    console.log(`🗑️ Attempting to hard delete inspection: ${inspection.title} (ID=${id})`);
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
 * PUT /api/inspections/:id/assign
 * Assign an inspection to a user
 */
router.put('/:id/assign', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    console.log(`Assigning inspection ${id} to user ${userId}`);

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'userId is required',
      });
    }

    // Check if inspection exists
    const inspection = await prisma.Inspection.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
      },
    });

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found',
        message: 'Inspection not found',
      });
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

    // Optionally verify user belongs to same organization as inspection
    // (commented out to allow admin to assign across organizations)
    // if (targetUser.orgId !== inspection.orgId) {
    //   return res.status(400).json({
    //     error: 'Invalid assignment',
    //     message: 'User must belong to the same organization as the inspection',
    //   });
    // }

    // Update inspection assignee
    // DRAFT status is fine - it will be shown in Flutter app
    // We don't change status when assigning, keep the current status
    console.log(`[PUT /:id/assign] Current inspection status: ${inspection.status}`);
    console.log(`[PUT /:id/assign] Assigning to user ${userId}, keeping status as ${inspection.status}`);
    
    const updatedInspection = await prisma.Inspection.update({
      where: { id: BigInt(id) },
      data: {
        assignedTo: BigInt(userId),
        updatedBy: BigInt(req.user.id),
        // Keep current status - DRAFT status is fine and will be shown in Flutter app
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

    console.log(`[PUT /:id/assign] Inspection ${id} assigned successfully to user ${userId}`);
    console.log(`[PUT /:id/assign] Updated inspection status: ${updatedInspection.status}`);
    console.log(`[PUT /:id/assign] Updated inspection assignedTo: ${updatedInspection.assignedTo?.toString()}`);

    if (updatedInspection.assignee?.email) {
      const orgName = updatedInspection.organization?.name || 'Тодорхойгүй байгууллага';
      const siteName = updatedInspection.site?.name || 'Талбайн мэдээлэл байхгүй';
      const scheduledDate = formatDateTime(updatedInspection.scheduledAt);
      const deviceParts = [];

      if (updatedInspection.device?.serialNumber) {
        deviceParts.push(`Сериал: ${updatedInspection.device.serialNumber}`);
      }

      if (updatedInspection.device?.assetTag) {
        deviceParts.push(`Asset: ${updatedInspection.device.assetTag}`);
      }

      const deviceInfo =
        deviceParts.length > 0
          ? deviceParts.join(' / ')
          : 'Төхөөрөмжийн дэлгэрэнгүй мэдээлэл одоогоор байхгүй байна.';

      const instructions = updatedInspection.notes?.trim()
        ? updatedInspection.notes.trim()
        : 'Нэмэлт заавар ирээгүй байна. Дэлгэрэнгүйг систем дээрх тэмдэглэлээс шалгана уу.';

      const subject = `Шинэ үзлэгийн томилолт - ${updatedInspection.title}`;
      const text = [
        `Сайн байна уу ${updatedInspection.assignee.fullName || ''},`,
        '',
        'Танд дараах үзлэгийн томилолт ирлээ:',
        `• Үзлэг: ${updatedInspection.title}`,
        `• Төрөл: ${updatedInspection.type}`,
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
          to: updatedInspection.assignee.email,
          subject,
          text,
        });
      } catch (emailError) {
        console.error('Failed to send assignment email:', emailError);
      }
    } else {
      console.warn(
        `Assigned user ${userId} does not have an email address, skipping notification.`
      );
    }

    res.json({
      message: 'Inspection assigned successfully',
      data: {
        id: updatedInspection.id.toString(),
        title: updatedInspection.title,
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
