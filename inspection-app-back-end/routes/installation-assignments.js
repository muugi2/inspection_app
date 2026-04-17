const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { handleError } = require('../utils/routeHelpers');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { buildPublicUrl } = require('../utils/imageStorage');

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
    console.log(`[Installation Upload] 📁 Multer destination: ${FTP_STORAGE_PATH}`);
    // Ensure directory exists
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      console.log(`[Installation Upload] 📁 Creating directory: ${FTP_STORAGE_PATH}`);
      fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
    }
    cb(null, FTP_STORAGE_PATH);
  },
  filename: function (req, file, cb) {
    // Generate temporary filename - will be renamed later with correct format
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `temp-installation-${uniqueSuffix}${ext}`;
    console.log(`[Installation Upload] 📝 Generated temporary filename: ${fileName} (will be renamed later)`);
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

// File filter for act files (PDF and images)
const actFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, PNG, GIF, and WebP files are allowed.'), false);
  }
};

// Configure multer for act uploads
const actUpload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for PDFs
  },
  fileFilter: actFileFilter,
});

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

// Utility function to convert BigInt to string for JSON serialization
const serializeBigInt = obj => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }

  if (typeof obj === 'object') {
    const serialized = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeBigInt(value);
    }
    return serialized;
  }

  return obj;
};

/**
 * POST /api/installation-assignments
 * Create installation assignments (supports multiple templates and users)
 */
router.post('/', authMiddleware, async (req, res) => {
  console.log('[POST /api/installation-assignments] Request received');
  console.log('[POST /api/installation-assignments] Request body:', JSON.stringify(req.body, null, 2));
  console.log('[POST /api/installation-assignments] User ID:', req.user?.id);
  try {
    const {
      contractId,
      templateIds, // Array of template IDs
      userIds, // Array of user IDs
      title,
      extraInfo,
    } = req.body;
    
    console.log('[POST /api/installation-assignments] Parsed data:', {
      contractId,
      templateIds,
      userIds,
      title,
      extraInfo,
    });

    // Validation
    if (!contractId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Contract ID is required',
      });
    }

    if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one template ID is required',
      });
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one user ID is required',
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Title is required',
      });
    }

    // Verify contract exists
    console.log('[POST /api/installation-assignments] Verifying contract:', contractId);
    const contract = await prisma.Contract.findUnique({
      where: { id: BigInt(contractId) },
    });

    if (!contract) {
      console.log('[POST /api/installation-assignments] ❌ Contract not found:', contractId);
      return res.status(404).json({
        error: 'Not found',
        message: 'Contract not found',
      });
    }
    console.log('[POST /api/installation-assignments] ✅ Contract found:', contract.id.toString());

    // Verify all templates exist and are INSTALLATION type
    // Installation templates are stored in settlement_template table, not inspection_templates
    console.log('[POST /api/installation-assignments] Verifying templates:', templateIds);
    const templateIdsBigInt = templateIds.map(id => BigInt(id));
    
    // Check in settlement_template table (where installation templates are stored)
    const templateIdsPlaceholders = templateIdsBigInt.map(() => '?').join(',');
    const settlementTemplatesQuery = `
      SELECT id, name, type, device_type, is_active
      FROM settlement_template
      WHERE id IN (${templateIdsPlaceholders}) AND type = 'INSTALLATION' AND is_active = 1
    `;
    const settlementTemplates = await prisma.$queryRawUnsafe(
      settlementTemplatesQuery,
      ...templateIdsBigInt
    );
    
    console.log('[POST /api/installation-assignments] Found templates in settlement_template:', settlementTemplates.length);
    settlementTemplates.forEach(t => {
      console.log(`[POST /api/installation-assignments]   - Template ${t.id.toString()}: name="${t.name}", type="${t.type}", device_type="${t.device_type}", is_active=${t.is_active}`);
    });
    
    // Also check in inspection_templates table for backward compatibility
    const inspectionTemplates = await prisma.InspectionTemplate.findMany({
      where: {
        id: { in: templateIdsBigInt },
        type: 'INSTALLATION',
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
      },
    });
    
    console.log('[POST /api/installation-assignments] Found templates in inspection_templates:', inspectionTemplates.length);
    
    // Combine results from both tables
    const allFoundTemplates = [
      ...settlementTemplates.map(t => ({
        id: t.id.toString(),
        name: t.name,
        type: t.type,
        isActive: t.is_active === 1,
      })),
      ...inspectionTemplates.map(t => ({
        id: t.id.toString(),
        name: t.name,
        type: t.type,
        isActive: t.isActive,
      })),
    ];
    
    // Remove duplicates based on ID
    const uniqueTemplates = Array.from(
      new Map(allFoundTemplates.map(t => [t.id, t])).values()
    );
    
    console.log('[POST /api/installation-assignments] Total unique INSTALLATION templates found:', uniqueTemplates.length, 'out of', templateIds.length);
    
    if (uniqueTemplates.length !== templateIds.length) {
      console.log('[POST /api/installation-assignments] ❌ Template validation failed');
      console.log('[POST /api/installation-assignments] Expected:', templateIds.length, 'Found:', uniqueTemplates.length);
      const missingIds = templateIds.filter(id => {
        const found = uniqueTemplates.find(t => t.id === id);
        return !found;
      });
      console.log('[POST /api/installation-assignments] Missing template IDs:', missingIds);
      return res.status(404).json({
        error: 'Not found',
        message: `One or more templates not found or not INSTALLATION type. Missing IDs: ${missingIds.join(', ')}`,
      });
    }
    console.log('[POST /api/installation-assignments] ✅ All templates verified');

    // Verify all users exist and are active
    console.log('[POST /api/installation-assignments] Verifying users:', userIds);
    const userIdsBigInt = userIds.map(id => BigInt(id));
    const users = await prisma.User.findMany({
      where: {
        id: { in: userIdsBigInt },
        deletedAt: null,
        isActive: true,
      },
    });

    console.log('[POST /api/installation-assignments] Found users:', users.length, 'out of', userIds.length);
    if (users.length !== userIds.length) {
      console.log('[POST /api/installation-assignments] ❌ User validation failed');
      console.log('[POST /api/installation-assignments] Expected:', userIds.length, 'Found:', users.length);
      return res.status(404).json({
        error: 'Not found',
        message: 'One or more users not found or inactive',
      });
    }
    console.log('[POST /api/installation-assignments] ✅ All users verified');

    // Create assignments for each template and user combination
    console.log('[POST /api/installation-assignments] Creating assignments...');
    console.log('[POST /api/installation-assignments] Template count:', templateIds.length, 'User count:', userIds.length);
    const assignments = [];
    const assignedBy = BigInt(req.user.id);
    console.log('[POST /api/installation-assignments] Assigned by user ID:', assignedBy.toString());

    for (const templateId of templateIds) {
      for (const userId of userIds) {
        console.log('[POST /api/installation-assignments] Processing: template', templateId, 'user', userId, 'title', title);
        // Check if assignment already exists (contract_id, template_id, user_id, title must all match)
        const existing = await prisma.$queryRaw`
          SELECT id FROM installation_assignments
          WHERE contract_id = ${BigInt(contractId)}
            AND template_id = ${BigInt(templateId)}
            AND user_id = ${BigInt(userId)}
            AND title = ${title.trim()}
          LIMIT 1
        `;

        if (existing && existing.length > 0) {
          console.log(`[POST /api/installation-assignments] ⚠️ Assignment already exists for contract ${contractId}, template ${templateId}, user ${userId}, title ${title}`);
          continue; // Skip duplicate
        }

        // Create assignment
        console.log('[POST /api/installation-assignments] Creating new assignment...');
        const assignment = await prisma.$executeRaw`
          INSERT INTO installation_assignments (
            contract_id,
            template_id,
            user_id,
            assigned_by,
            title,
            status,
            extra_info,
            created_at,
            updated_at
          ) VALUES (
            ${BigInt(contractId)},
            ${BigInt(templateId)},
            ${BigInt(userId)},
            ${assignedBy},
            ${title.trim()},
            'PENDING',
            ${extraInfo ? JSON.stringify(extraInfo) : null},
            NOW(),
            NOW()
          )
        `;

        // Get the created assignment ID
        const createdAssignment = await prisma.$queryRaw`
          SELECT * FROM installation_assignments
          WHERE contract_id = ${BigInt(contractId)}
            AND template_id = ${BigInt(templateId)}
            AND user_id = ${BigInt(userId)}
          ORDER BY id DESC
          LIMIT 1
        `;

        if (createdAssignment && createdAssignment.length > 0) {
          console.log('[POST /api/installation-assignments] ✅ Assignment created:', createdAssignment[0].id.toString());
          assignments.push(createdAssignment[0]);
        } else {
          console.log('[POST /api/installation-assignments] ⚠️ Assignment created but not found in database');
        }
      }
    }

    console.log('[POST /api/installation-assignments] Total assignments created:', assignments.length);
    // Format response
    const formattedAssignments = assignments.map(a => ({
      id: a.id.toString(),
      contractId: a.contract_id.toString(),
      templateId: a.template_id.toString(),
      userId: a.user_id.toString(),
      assignedBy: a.assigned_by.toString(),
      title: a.title,
      status: a.status,
      extraInfo: a.extra_info
        ? (typeof a.extra_info === 'string'
            ? JSON.parse(a.extra_info)
            : a.extra_info)
        : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));

    console.log('[POST /api/installation-assignments] ✅ Successfully created', assignments.length, 'assignment(s)');
    res.json({
      message: `Successfully created ${assignments.length} installation assignment(s)`,
      data: formattedAssignments,
      count: assignments.length,
    });
  } catch (error) {
    console.error('[POST /api/installation-assignments] ❌ Error creating installation assignments:', error);
    console.error('[POST /api/installation-assignments] Error stack:', error.stack);
    handleError(res, error, 'create installation assignments');
  }
});

/**
 * GET /api/installation-assignments
 * Get all installation assignments with filters
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      contractId,
      templateId,
      userId,
      status,
      page = 1,
      limit = 10,
    } = req.query;

    let whereConditions = [];
    const queryParams = [];

    if (contractId) {
      whereConditions.push('contract_id = ?');
      queryParams.push(BigInt(contractId));
    }

    if (templateId) {
      whereConditions.push('template_id = ?');
      queryParams.push(BigInt(templateId));
    }

    if (userId) {
      whereConditions.push('user_id = ?');
      queryParams.push(BigInt(userId));
    }

    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status.toUpperCase());
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Count query
    const countQuery = `SELECT COUNT(*) as count FROM installation_assignments ${whereClause}`;
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...queryParams);
    const totalCount = Number(countResult[0]?.count || 0);

    // Data query
    // Note: Installation templates are stored in settlement_template table, not inspection_templates
    const dataQuery = `
      SELECT 
        ia.*,
        c.contract_name,
        c.contract_number,
        COALESCE(st.name, it.name) as template_name,
        st.device_type as template_device_type,
        u.full_name as user_name,
        u.email as user_email,
        ab.full_name as assigned_by_name
      FROM installation_assignments ia
      LEFT JOIN contracts c ON ia.contract_id = c.id
      LEFT JOIN settlement_template st ON ia.template_id = st.id
      LEFT JOIN inspection_templates it ON ia.template_id = it.id
      LEFT JOIN users u ON ia.user_id = u.id
      LEFT JOIN users ab ON ia.assigned_by = ab.id
      ${whereClause}
      ORDER BY ia.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataResult = await prisma.$queryRawUnsafe(
      dataQuery,
      ...queryParams,
      take,
      skip
    );

    const assignments = dataResult.map(a => ({
      id: a.id.toString(),
      contractId: a.contract_id.toString(),
      contractName: a.contract_name,
      contractNumber: a.contract_number,
      templateId: a.template_id.toString(),
      templateName: a.template_name,
      userId: a.user_id.toString(),
      userName: a.user_name,
      userEmail: a.user_email,
      assignedBy: a.assigned_by.toString(),
      assignedByName: a.assigned_by_name,
      title: a.title,
      status: a.status,
      extraInfo: a.extra_info
        ? (typeof a.extra_info === 'string'
            ? JSON.parse(a.extra_info)
            : a.extra_info)
        : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));

    const totalPages = Math.ceil(totalCount / take);

    res.json({
      message: 'Installation assignments fetched successfully',
      data: serializeBigInt(assignments),
      pagination: {
        page: parseInt(page),
        limit: take,
        totalCount,
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error('Error fetching installation assignments:', error);
    handleError(res, error, 'fetch installation assignments');
  }
});

/**
 * GET /api/installation-assignments/user/:userId
 * Get installation assignments for a specific user
 */
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    // Note: Installation templates are stored in settlement_template table, not inspection_templates
    const assignments = await prisma.$queryRawUnsafe(`
      SELECT 
        ia.*,
        c.contract_name,
        c.contract_number,
        c.org_id,
        o.name as org_name,
        COALESCE(st.name, it.name) as template_name,
        COALESCE(st.device_type, it.device_type) as device_type
      FROM installation_assignments ia
      LEFT JOIN contracts c ON ia.contract_id = c.id
      LEFT JOIN organizations o ON c.org_id = o.id
      LEFT JOIN settlement_template st ON ia.template_id = st.id
      LEFT JOIN inspection_templates it ON ia.template_id = it.id
      WHERE ia.user_id = ?
        AND ia.status IN ('PENDING', 'IN_PROGRESS')
      ORDER BY o.name, ia.title, ia.created_at DESC
    `, BigInt(userId));

    const formattedAssignments = assignments.map(a => ({
      id: a.id.toString(),
      contractId: a.contract_id.toString(),
      contractName: a.contract_name,
      contractNumber: a.contract_number,
      orgId: a.org_id ? a.org_id.toString() : null,
      orgName: a.org_name || null,
      templateId: a.template_id.toString(),
      templateName: a.template_name,
      deviceType: a.device_type,
      title: a.title,
      status: a.status,
      extraInfo: a.extra_info
        ? (typeof a.extra_info === 'string'
            ? JSON.parse(a.extra_info)
            : a.extra_info)
        : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));

    res.json({
      message: 'Installation assignments fetched successfully',
      data: serializeBigInt(formattedAssignments),
      count: formattedAssignments.length,
    });
  } catch (error) {
    console.error('Error fetching user installation assignments:', error);
    handleError(res, error, 'fetch user installation assignments');
  }
});

/**
 * GET /api/installation-assignments/:id
 * Get a specific installation assignment by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const assignment = await prisma.$queryRawUnsafe(`
      SELECT 
        ia.*,
        c.contract_name,
        c.contract_number,
        COALESCE(st.name, it.name) as template_name,
        COALESCE(st.device_type, it.device_type) as device_type,
        u.full_name as user_name,
        u.email as user_email,
        ab.full_name as assigned_by_name
      FROM installation_assignments ia
      LEFT JOIN contracts c ON ia.contract_id = c.id
      LEFT JOIN settlement_template st ON ia.template_id = st.id
      LEFT JOIN inspection_templates it ON ia.template_id = it.id
      LEFT JOIN users u ON ia.user_id = u.id
      LEFT JOIN users ab ON ia.assigned_by = ab.id
      WHERE ia.id = ?
      LIMIT 1
    `, BigInt(id));

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Installation assignment not found',
      });
    }

    const a = assignment[0];
    const formattedAssignment = {
      id: a.id.toString(),
      contractId: a.contract_id.toString(),
      contractName: a.contract_name,
      contractNumber: a.contract_number,
      templateId: a.template_id.toString(),
      templateName: a.template_name,
      deviceType: a.device_type,
      userId: a.user_id.toString(),
      userName: a.user_name,
      userEmail: a.user_email,
      assignedBy: a.assigned_by.toString(),
      assignedByName: a.assigned_by_name,
      title: a.title,
      status: a.status,
      extraInfo: a.extra_info
        ? (typeof a.extra_info === 'string'
            ? JSON.parse(a.extra_info)
            : a.extra_info)
        : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };

    res.json({
      message: 'Installation assignment fetched successfully',
      data: serializeBigInt(formattedAssignment),
    });
  } catch (error) {
    console.error('Error fetching installation assignment:', error);
    handleError(res, error, 'fetch installation assignment');
  }
});

/**
 * PUT /api/installation-assignments/:id
 * Update an installation assignment
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actUrl, actFileName, actFileSize, title, extraInfo } = req.body;

    // Verify assignment exists
    const existing = await prisma.$queryRawUnsafe(`
      SELECT id FROM installation_assignments WHERE id = ?
    `, BigInt(id));

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Installation assignment not found',
      });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (status !== undefined) {
      // Validate status
      const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }
      updates.push('status = ?');
      params.push(status.toUpperCase());
    }

    if (title !== undefined) {
      const nextTitle = String(title ?? '').trim();
      if (!nextTitle) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Title cannot be empty',
        });
      }
      updates.push('title = ?');
      params.push(nextTitle);
    }

    if (extraInfo !== undefined) {
      // Allow null to clear
      if (extraInfo === null) {
        updates.push('extra_info = NULL');
      } else {
        // Store as JSON string
        updates.push('extra_info = ?');
        params.push(JSON.stringify(extraInfo));
      }
    }

    if (actUrl !== undefined) {
      updates.push('act_url = ?');
      params.push(actUrl);
    }

    if (actFileName !== undefined) {
      updates.push('act_file_name = ?');
      params.push(actFileName);
    }

    if (actFileSize !== undefined) {
      updates.push('act_file_size = ?');
      params.push(actFileSize);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'No fields to update',
      });
    }

    updates.push('updated_at = NOW()');
    params.push(BigInt(id));

    const updateQuery = `
      UPDATE installation_assignments
      SET ${updates.join(', ')}
      WHERE id = ?
    `;

    await prisma.$executeRawUnsafe(updateQuery, ...params);

    // Fetch updated assignment
    const updated = await prisma.$queryRawUnsafe(`
      SELECT 
        ia.*,
        c.contract_name,
        c.contract_number,
        COALESCE(st.name, it.name) as template_name,
        COALESCE(st.device_type, it.device_type) as device_type,
        u.full_name as user_name,
        u.email as user_email,
        ab.full_name as assigned_by_name
      FROM installation_assignments ia
      LEFT JOIN contracts c ON ia.contract_id = c.id
      LEFT JOIN settlement_template st ON ia.template_id = st.id
      LEFT JOIN inspection_templates it ON ia.template_id = it.id
      LEFT JOIN users u ON ia.user_id = u.id
      LEFT JOIN users ab ON ia.assigned_by = ab.id
      WHERE ia.id = ?
      LIMIT 1
    `, BigInt(id));

    const a = updated[0];
    const formattedAssignment = {
      id: a.id.toString(),
      contractId: a.contract_id.toString(),
      contractName: a.contract_name,
      contractNumber: a.contract_number,
      templateId: a.template_id.toString(),
      templateName: a.template_name,
      deviceType: a.device_type,
      userId: a.user_id.toString(),
      userName: a.user_name,
      userEmail: a.user_email,
      assignedBy: a.assigned_by.toString(),
      assignedByName: a.assigned_by_name,
      title: a.title,
      status: a.status,
      extraInfo: a.extra_info
        ? (typeof a.extra_info === 'string'
            ? JSON.parse(a.extra_info)
            : a.extra_info)
        : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };

    res.json({
      message: 'Installation assignment updated successfully',
      data: serializeBigInt(formattedAssignment),
    });
  } catch (error) {
    console.error('Error updating installation assignment:', error);
    handleError(res, error, 'update installation assignment');
  }
});

/**
 * DELETE /api/installation-assignments/:id
 * Delete an installation assignment
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify assignment exists
    const existing = await prisma.$queryRawUnsafe(`
      SELECT id, title FROM installation_assignments WHERE id = ?
    `, BigInt(id));

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Installation assignment not found',
      });
    }

    // Delete assignment
    await prisma.$executeRawUnsafe(`
      DELETE FROM installation_assignments WHERE id = ?
    `, BigInt(id));

    res.json({
      message: 'Installation assignment deleted successfully',
      data: {
        id: id,
        title: existing[0].title,
      },
    });
  } catch (error) {
    console.error('Error deleting installation assignment:', error);
    handleError(res, error, 'delete installation assignment');
  }
});

/**
 * POST /api/installation-assignments/:assignmentId/upload-images
 * Upload images for installation assignment fields
 * 
 * Form-data fields:
 * - images: Array of image files (multipart/form-data)
 * - templateId: Template ID (required)
 * - section: Section name (required)
 * - fieldId: Field ID (required)
 */
router.post('/:assignmentId/upload-images', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    console.log('[POST /api/installation-assignments/:assignmentId/upload-images] Request received');
    console.log('[Installation Upload] Assignment ID:', req.params.assignmentId);
    console.log('[Installation Upload] Files received:', req.files?.length || 0);
    console.log('[Installation Upload] Body fields:', Object.keys(req.body));

    const assignmentId = BigInt(req.params.assignmentId);
    const { templateId, section, fieldId } = req.body;

    // Validate required fields
    if (!templateId || !section || !fieldId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'templateId, section, and fieldId are required',
      });
    }

    if (!req.files || req.files.length === 0) {
      console.error('[Installation Upload] ❌ No files received in req.files');
      return res.status(400).json({
        error: 'Validation Error',
        message: 'At least one image file is required',
      });
    }

    const templateIdBigInt = BigInt(templateId);
    const userId = BigInt(req.user.id);

    // Verify assignment exists and user has access
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id, user_id, template_id, title
      FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, assignmentId, userId);

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Installation assignment not found or access denied',
      });
    }

    console.log(`[Installation Upload] ✅ Assignment ${assignmentId} verified`);

    // Process uploaded files
    console.log(`[Installation Upload] 📦 Processing ${req.files.length} uploaded file(s)`);
    
    const FTP_BASE_URL = process.env.FTP_BASE_URL || 'ftp://192.168.1.35';
    const FTP_REMOTE_PREFIX = process.env.FTP_REMOTE_PREFIX || 'test';
    const FTP_PUBLIC_BASE_URL = process.env.FTP_PUBLIC_BASE_URL || 'http://192.168.1.35:4555/uploads';
    const timestamp = Date.now();
    
    const uploadedImages = [];
    
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const oldFilePath = file.path;
      const ext = path.extname(file.originalname) || '.jpg';
      
      // Generate new filename: installation_{assignmentId}_template_{templateId}_field_{fieldId}_{timestamp}_{order}.jpg
      const newFileName = `installation_${assignmentId}_template_${templateId}_field_${fieldId}_${timestamp}_${i}${ext}`;
      const newFilePath = path.join(FTP_STORAGE_PATH, newFileName);
      
      // Rename file to correct format
      try {
        if (fs.existsSync(oldFilePath)) {
          fs.renameSync(oldFilePath, newFilePath);
          console.log(`[Installation Upload] ✅ Renamed file: ${file.filename} -> ${newFileName}`);
        } else {
          console.error(`[Installation Upload] ❌ Old file not found: ${oldFilePath}`);
          continue;
        }
      } catch (renameError) {
        console.error(`[Installation Upload] ❌ Error renaming file: ${renameError.message}`);
        continue;
      }
      
      // Build public URL (use HTTP URL, not FTP URL)
      const relativePath = newFileName;
      let publicUrl = buildPublicUrl(relativePath);
      
      // If buildPublicUrl returns null, construct URL manually
      if (!publicUrl) {
        publicUrl = `${FTP_PUBLIC_BASE_URL}/${newFileName}`;
      }
      
      const imageUrl = publicUrl;

      console.log(`[Installation Upload] 📸 Image ${i + 1}:`);
      console.log(`     Filename: ${newFileName}`);
      console.log(`     Saved to: ${newFilePath}`);
      console.log(`     Size: ${file.size} bytes`);
      console.log(`     URL: ${imageUrl}`);
      
      // Verify file actually exists
      if (fs.existsSync(newFilePath)) {
        console.log(`[Installation Upload] ✅ File exists at: ${newFilePath}`);
      } else {
        console.error(`[Installation Upload] ❌ File NOT found at: ${newFilePath}`);
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

    // Save images to installation_answer_images table
    const savedImages = [];
    
    for (let i = 0; i < uploadedImages.length; i++) {
      const img = uploadedImages[i];
      const imageOrder = i + 1;
      
      try {
        console.log(`[Installation Upload] 💾 Saving image ${imageOrder} to database:`, {
          assignmentId: assignmentId.toString(),
          templateId: templateId,
          section: section,
          fieldId: fieldId,
          imageOrder: imageOrder,
          imageUrl: img.imageUrl,
        });
        
        // Insert into installation_answer_images table
        await prisma.$executeRawUnsafe(`
          INSERT INTO installation_answer_images (
            installation_assignment_id,
            template_id,
            section,
            field_id,
            image_order,
            image_url,
            file_name,
            file_size,
            uploaded_by,
            uploaded_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
        `,
          assignmentId,
          templateIdBigInt,
          section,
          fieldId,
          imageOrder,
          img.imageUrl,
          img.fileName,
          img.fileSize,
          userId
        );
        
        console.log(`[Installation Upload] ✅ Database INSERT successful for image ${imageOrder}`);
        
        // Get the inserted ID
        const result = await prisma.$queryRawUnsafe(`
          SELECT id 
          FROM installation_answer_images 
          WHERE installation_assignment_id = ?
            AND template_id = ?
            AND section = ?
            AND field_id = ?
            AND image_order = ?
          ORDER BY id DESC 
          LIMIT 1
        `, assignmentId, templateIdBigInt, section, fieldId, imageOrder);
        
        const imageId = result?.[0]?.id ? result[0].id.toString() : null;
        
        console.log(`[Installation Upload] ✅ Retrieved image ID: ${imageId}`);
        
        savedImages.push({
          id: imageId,
          fileName: img.fileName,
          fileSize: img.fileSize,
          mimeType: img.mimeType,
          relativePath: img.relativePath,
          imageUrl: img.imageUrl,
          order: imageOrder,
        });
        
        console.log(`[Installation Upload] ✅ Successfully saved image ${imageOrder} to database (ID: ${imageId}, URL: ${img.imageUrl})`);
      } catch (imageError) {
        console.error(`[Installation Upload] ❌ Error saving image ${imageOrder} to database:`, imageError);
        console.error(`   Error details:`, {
          message: imageError.message,
          code: imageError.code,
          stack: imageError.stack,
        });
        // Continue with other images
      }
    }

    console.log(`[Installation Upload] ✅ Successfully uploaded and saved ${savedImages.length}/${uploadedImages.length} images`);

    // If no images were saved, return error
    if (savedImages.length === 0) {
      console.error('[Installation Upload] ❌ No images were saved to database!');
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
        assignmentId: assignmentId.toString(),
        templateId: templateId,
        section: section,
        fieldId: fieldId,
        uploadedImages: savedImages,
        totalImages: savedImages.length,
      },
    });
  } catch (error) {
    console.error('[Installation Upload] ❌ Error uploading images:', error);
    handleError(res, error, 'upload installation images');
  }
});

/**
 * POST /api/installation-assignments/:assignmentId/answers
 * Save or update field answer (comment) for installation assignment
 * 
 * Body:
 * - templateId: Template ID (required)
 * - section: Section name (required)
 * - fieldId: Field ID (required)
 * - question: Question text (required)
 * - comment: Comment text (required)
 * - status: Status (optional, default: '')
 */
router.post('/:assignmentId/answers', authMiddleware, async (req, res) => {
  try {
    console.log('[POST /api/installation-assignments/:assignmentId/answers] Request received');
    const { assignmentId } = req.params;
    const { templateId, section, fieldId, question, comment, status } = req.body;

    // Validate required fields
    if (!templateId || !section || !fieldId || !question) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'templateId, section, fieldId, and question are required',
      });
    }

    const assignmentIdBigInt = BigInt(assignmentId);
    const templateIdBigInt = BigInt(templateId);
    const userId = BigInt(req.user.id);

    // Verify assignment exists and user has access
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id, user_id FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, assignmentIdBigInt, userId);

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Installation assignment not found or access denied',
      });
    }

    // Get existing answers or create new
    const existing = await prisma.$queryRawUnsafe(`
      SELECT id, answers FROM installation_answers
      WHERE installation_assignment_id = ? AND template_id = ?
      LIMIT 1
    `, assignmentIdBigInt, templateIdBigInt);

    let currentAnswers = {};
    let answerId = null;

    if (existing && existing.length > 0) {
      // Parse existing JSON - MySQL JSON field can be string or already parsed object
      try {
        const rawAnswers = existing[0].answers;
        if (rawAnswers) {
          if (typeof rawAnswers === 'string') {
            currentAnswers = JSON.parse(rawAnswers);
          } else if (typeof rawAnswers === 'object') {
            currentAnswers = rawAnswers;
          } else {
            console.warn('[POST /api/installation-assignments/:assignmentId/answers] Unexpected answers type:', typeof rawAnswers);
            currentAnswers = {};
          }
        }
      } catch (parseError) {
        console.error('[POST /api/installation-assignments/:assignmentId/answers] JSON parse error:', parseError);
        console.error('[POST /api/installation-assignments/:assignmentId/answers] Raw answers value:', existing[0].answers);
        currentAnswers = {};
      }
      answerId = existing[0].id;
    }

    // Update JSON answers
    if (!currentAnswers[section]) {
      currentAnswers[section] = {};
    }

    currentAnswers[section][fieldId] = {
      status: status || '',
      comment: comment || '',
      question: question,
    };

    // Update or insert
    if (answerId) {
      // Update existing
      await prisma.$executeRawUnsafe(`
        UPDATE installation_answers
        SET answers = ?,
            status = 'IN_PROGRESS',
            answered_by = ?,
            answered_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `, JSON.stringify(currentAnswers), userId, answerId);
    } else {
      // Insert new
      const result = await prisma.$executeRawUnsafe(`
        INSERT INTO installation_answers (
          installation_assignment_id,
          template_id,
          answers,
          status,
          answered_by,
          answered_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'IN_PROGRESS', ?, NOW(), NOW(), NOW())
      `, assignmentIdBigInt, templateIdBigInt, JSON.stringify(currentAnswers), userId);

      // Get inserted ID
      const inserted = await prisma.$queryRawUnsafe(`
        SELECT id FROM installation_answers
        WHERE installation_assignment_id = ? AND template_id = ?
        ORDER BY id DESC
        LIMIT 1
      `, assignmentIdBigInt, templateIdBigInt);

      answerId = inserted?.[0]?.id;
    }

    res.json({
      message: 'Answer saved successfully',
      data: {
        id: answerId.toString(),
        installationAssignmentId: assignmentId,
        templateId: templateId,
        section: section,
        fieldId: fieldId,
        comment: comment,
        status: status || '',
      },
    });
  } catch (error) {
    console.error('[POST /api/installation-assignments/:assignmentId/answers] Error:', error);
    handleError(res, error, 'save installation answer');
  }
});

/**
 * GET /api/installation-assignments/:assignmentId/answers/:templateId
 * Get answers for a specific template within an installation assignment
 */
router.get('/:assignmentId/answers/:templateId', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, templateId } = req.params;

    const assignmentIdBigInt = BigInt(assignmentId);
    const templateIdBigInt = BigInt(templateId);
    const userId = BigInt(req.user.id);

    // Verify assignment exists and user has access
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, assignmentIdBigInt, userId);

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Installation assignment not found or access denied',
      });
    }

    // Get answers
    const answer = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_answers
      WHERE installation_assignment_id = ? AND template_id = ?
      LIMIT 1
    `, assignmentIdBigInt, templateIdBigInt);

    if (!answer || answer.length === 0) {
      return res.json({
        message: 'No answers found',
        data: null,
      });
    }

    const a = answer[0];
    
    console.log('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Raw answers:', a.answers);
    console.log('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Answers type:', typeof a.answers);
    
    // Parse JSON - MySQL JSON field can be string or already parsed object
    let answers = {};
    try {
      if (a.answers) {
        if (typeof a.answers === 'string') {
          console.log('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Parsing string JSON...');
          answers = JSON.parse(a.answers);
        } else if (typeof a.answers === 'object') {
          console.log('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Using object directly...');
          answers = a.answers;
        } else {
          console.warn('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Unexpected answers type:', typeof a.answers);
          answers = {};
        }
        console.log('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Parsed answers:', JSON.stringify(answers, null, 2));
      }
    } catch (parseError) {
      console.error('[GET /api/installation-assignments/:assignmentId/answers/:templateId] JSON parse error:', parseError);
      console.error('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Raw answers value:', a.answers);
      console.error('[GET /api/installation-assignments/:assignmentId/answers/:templateId] Answers type:', typeof a.answers);
      // Return empty object if parse fails
      answers = {};
    }

    res.json({
      message: 'Answers fetched successfully',
      data: {
        id: a.id.toString(),
        installationAssignmentId: assignmentId,
        templateId: templateId,
        answers: answers,
        status: a.status,
        answeredBy: a.answered_by?.toString(),
        answeredAt: a.answered_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching installation answers:', error);
    handleError(res, error, 'fetch installation answers');
  }
});

/**
 * GET /api/installation-assignments/:assignmentId/images
 * Get images for an installation assignment
 * 
 * Query params:
 * - templateId: Template ID (optional)
 * - section: Section name (optional)
 * - fieldId: Field ID (optional)
 */
router.get('/:assignmentId/images', authMiddleware, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { templateId, section, fieldId } = req.query;

    const assignmentIdBigInt = BigInt(assignmentId);
    const userId = BigInt(req.user.id);

    // Verify assignment exists and user has access
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, assignmentIdBigInt, userId);

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Installation assignment not found or access denied',
      });
    }

    // Build WHERE clause
    let whereConditions = ['installation_assignment_id = ?'];
    const queryParams = [assignmentIdBigInt];

    if (templateId) {
      whereConditions.push('template_id = ?');
      queryParams.push(BigInt(templateId));
    }

    if (section) {
      whereConditions.push('section = ?');
      queryParams.push(section);
    }

    if (fieldId) {
      whereConditions.push('field_id = ?');
      queryParams.push(fieldId);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // Fetch images
    const images = await prisma.$queryRawUnsafe(`
      SELECT 
        id,
        installation_assignment_id,
        template_id,
        section,
        field_id,
        image_order,
        image_url,
        file_name,
        file_size,
        uploaded_by,
        uploaded_at,
        created_at,
        updated_at
      FROM installation_answer_images
      ${whereClause}
      ORDER BY section, field_id, image_order ASC
    `, ...queryParams);

    const formattedImages = images.map(img => ({
      id: img.id.toString(),
      installationAssignmentId: img.installation_assignment_id.toString(),
      templateId: img.template_id.toString(),
      section: img.section,
      fieldId: img.field_id,
      imageOrder: img.image_order,
      imageUrl: img.image_url,
      fileName: img.file_name,
      fileSize: img.file_size ? Number(img.file_size) : null,
      uploadedBy: img.uploaded_by.toString(),
      uploadedAt: img.uploaded_at,
      createdAt: img.created_at,
      updatedAt: img.updated_at,
    }));

    res.json({
      message: 'Images fetched successfully',
      data: serializeBigInt(formattedImages),
      count: formattedImages.length,
    });
  } catch (error) {
    console.error('Error fetching installation images:', error);
    handleError(res, error, 'fetch installation images');
  }
});

/**
 * DELETE /api/installation-assignments/:assignmentId/images/:imageId
 * Delete a specific image from installation assignment
 */
router.delete('/:assignmentId/images/:imageId', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, imageId } = req.params;

    const assignmentIdBigInt = BigInt(assignmentId);
    const imageIdBigInt = BigInt(imageId);
    const userId = BigInt(req.user.id);

    console.log('[DELETE /api/installation-assignments/:assignmentId/images/:imageId] Request received');
    console.log('  Assignment ID:', assignmentId);
    console.log('  Image ID:', imageId);
    console.log('  User ID:', userId.toString());

    // Verify assignment exists and user has access
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, assignmentIdBigInt, userId);

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Installation assignment not found or access denied',
      });
    }

    // Verify image exists and belongs to this assignment
    const image = await prisma.$queryRawUnsafe(`
      SELECT id, image_url, file_name
      FROM installation_answer_images
      WHERE id = ? AND installation_assignment_id = ?
      LIMIT 1
    `, imageIdBigInt, assignmentIdBigInt);

    if (!image || image.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Image not found or does not belong to this assignment',
      });
    }

    const imageData = image[0];
    const imageUrl = imageData.image_url;
    const fileName = imageData.file_name;

    console.log('  Image URL:', imageUrl);
    console.log('  File name:', fileName);

    // Delete image file from FTP storage if it exists
    try {
      if (fileName) {
        const filePath = path.join(FTP_STORAGE_PATH, fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('✅ Deleted image file from FTP storage:', filePath);
        } else {
          console.warn('⚠️ Image file not found in FTP storage:', filePath);
        }
      }
    } catch (fileError) {
      console.error('⚠️ Error deleting image file (non-critical):', fileError);
      // Continue with database deletion even if file deletion fails
    }

    // Delete image record from database
    await prisma.$executeRawUnsafe(`
      DELETE FROM installation_answer_images
      WHERE id = ?
    `, imageIdBigInt);

    console.log('✅ Image deleted successfully from database');

    res.json({
      message: 'Image deleted successfully',
      data: {
        id: imageId,
        imageUrl: imageUrl,
        fileName: fileName,
      },
    });
  } catch (error) {
    console.error('[DELETE /api/installation-assignments/:assignmentId/images/:imageId] Error:', error);
    handleError(res, error, 'delete installation image');
  }
});

module.exports = router;
