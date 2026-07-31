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
// MULTER CONFIGURATION FOR ACT FILE UPLOADS
// =============================================================================

// Ensure upload directory exists
const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
if (!fs.existsSync(FTP_STORAGE_PATH)) {
  fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    console.log(`[Installation Act Upload] 📁 Multer destination: ${FTP_STORAGE_PATH}`);
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
    }
    cb(null, FTP_STORAGE_PATH);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.pdf';
    const fileName = `temp-installation-act-${uniqueSuffix}${ext}`;
    console.log(`[Installation Act Upload] 📝 Generated temporary filename: ${fileName}`);
    cb(null, fileName);
  }
});

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
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for PDFs
  },
  fileFilter: actFileFilter,
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
 * GET /api/installation-acts
 * Get all installation acts with optional filters
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, orgId, title, templateId } = req.query;

    let query = 'SELECT * FROM installation_acts WHERE 1=1';
    const params = [];

    if (assignmentId) {
      query += ' AND installation_assignment_id = ?';
      params.push(BigInt(assignmentId));
    }

    if (orgId) {
      query += ' AND org_id = ?';
      params.push(BigInt(orgId));
    }

    if (title) {
      query += ' AND title = ?';
      params.push(title);
    }

    if (templateId) {
      query += ' AND template_id = ?';
      params.push(BigInt(templateId));
    }

    query += ' ORDER BY created_at DESC';

    const acts = await prisma.$queryRawUnsafe(query, ...params);

    res.json({
      message: 'Installation acts fetched successfully',
      data: serializeBigInt(acts),
      count: acts.length,
    });
  } catch (error) {
    console.error('[GET /api/installation-acts] ❌ Error:', error);
    handleError(res, error, 'Акт мэдээлэл авахад алдаа гарлаа');
  }
});

/**
 * GET /api/installation-acts/assignment/:assignmentId/template/:templateId
 * Get installation acts for a specific assignment and template
 */
router.get('/assignment/:assignmentId/template/:templateId', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, templateId } = req.params;

    const acts = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_acts
      WHERE installation_assignment_id = ?
        AND template_id = ?
      ORDER BY created_at DESC
    `, BigInt(assignmentId), BigInt(templateId));

    res.json({
      message: 'Installation acts fetched successfully',
      data: serializeBigInt(acts),
      count: acts.length,
    });
  } catch (error) {
    console.error('[GET /api/installation-acts/assignment/:assignmentId/template/:templateId] ❌ Error:', error);
    handleError(res, error, 'Акт мэдээлэл авахад алдаа гарлаа');
  }
});

/**
 * GET /api/installation-acts/:id
 * Get a single installation act by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const [act] = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_acts WHERE id = ?
    `, BigInt(id));

    if (!act) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Акт олдсонгүй',
      });
    }

    res.json({
      message: 'Акт мэдээлэл амжилттай авлаа',
      data: serializeBigInt(act),
    });
  } catch (error) {
    console.error('[GET /api/installation-acts/:id] ❌ Error:', error);
    handleError(res, error, 'Акт мэдээлэл авахад алдаа гарлаа');
  }
});

/**
 * POST /api/installation-acts
 * Create a new installation act
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, orgId, title, templateId, actTitle, comment } = req.body;

    // Validation
    if (!assignmentId || !orgId || !title || !templateId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Assignment ID, Organization ID, Title, and Template ID are required',
      });
    }

    // Verify assignment exists
    const assignment = await prisma.$queryRawUnsafe(`
      SELECT id, user_id, contract_id
      FROM installation_assignments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, BigInt(assignmentId), BigInt(req.user.id));

    if (!assignment || assignment.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Installation assignment not found or access denied',
      });
    }

    // Create act
    await prisma.$executeRawUnsafe(`
      INSERT INTO installation_acts (
        installation_assignment_id,
        org_id,
        title,
        template_id,
        act_title,
        comment,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
      BigInt(assignmentId),
      BigInt(orgId),
      title.trim(),
      BigInt(templateId),
      actTitle ? actTitle.trim() : null,
      comment || null,
      BigInt(req.user.id)
    );

    // Get the created act
    const [newAct] = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_acts
      WHERE installation_assignment_id = ?
        AND org_id = ?
        AND title = ?
        AND template_id = ?
        AND created_by = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
      BigInt(assignmentId),
      BigInt(orgId),
      title.trim(),
      BigInt(templateId),
      BigInt(req.user.id)
    );

    res.status(201).json({
      message: 'Акт амжилттай үүслээ',
      data: serializeBigInt(newAct),
    });
  } catch (error) {
    console.error('[POST /api/installation-acts] ❌ Error:', error);
    handleError(res, error, 'Акт үүсгэхэд алдаа гарлаа');
  }
});

/**
 * POST /api/installation-acts/:id/upload-file
 * Upload act file (PDF or image)
 */
router.post('/:id/upload-file', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    console.log('[POST /api/installation-acts/:id/upload-file] Request received');
    console.log('[Act Upload] Act ID:', req.params.id);
    console.log('[Act Upload] File received:', req.file?.originalname);

    const actId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    // Verify act exists and user has access
    const [act] = await prisma.$queryRawUnsafe(`
      SELECT ia.*, iaa.user_id
      FROM installation_acts ia
      INNER JOIN installation_assignments iaa ON ia.installation_assignment_id = iaa.id
      WHERE ia.id = ? AND iaa.user_id = ?
      LIMIT 1
    `, actId, userId);

    if (!act) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Акт олдсонгүй эсвэл хандах эрхгүй',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Файл оруулаагүй байна',
      });
    }

    console.log(`[Act Upload] ✅ Act ${actId} verified`);

    // Process uploaded file
    const file = req.file;
    const oldFilePath = file.path;
    const ext = path.extname(file.originalname) || '.pdf';
    const timestamp = Date.now();
    
    // Generate new filename: installation_act_{actId}_{timestamp}{ext}
    const newFileName = `installation_act_${actId}_${timestamp}${ext}`;
    const newFilePath = path.join(FTP_STORAGE_PATH, newFileName);
    
    // Rename file to correct format
    try {
      if (fs.existsSync(oldFilePath)) {
        fs.renameSync(oldFilePath, newFilePath);
        console.log(`[Act Upload] ✅ Renamed file: ${file.filename} -> ${newFileName}`);
      } else {
        console.error(`[Act Upload] ❌ Old file not found: ${oldFilePath}`);
        return res.status(500).json({
          error: 'File processing error',
          message: 'Failed to process uploaded file',
        });
      }
    } catch (renameError) {
      console.error(`[Act Upload] ❌ Error renaming file: ${renameError.message}`);
      return res.status(500).json({
        error: 'File processing error',
        message: renameError.message,
      });
    }
    
    // Build public URL
    const FTP_PUBLIC_BASE_URL = process.env.FTP_PUBLIC_BASE_URL || 'http://192.168.1.54:4555/uploads';
    const relativePath = newFileName;
    let publicUrl = buildPublicUrl(relativePath);
    
    // If buildPublicUrl returns null, construct URL manually
    if (!publicUrl) {
      publicUrl = `${FTP_PUBLIC_BASE_URL}/${newFileName}`;
    }

    console.log(`[Act Upload] 📄 Act file:`);
    console.log(`     Filename: ${newFileName}`);
    console.log(`     Saved to: ${newFilePath}`);
    console.log(`     Size: ${file.size} bytes`);
    console.log(`     URL: ${publicUrl}`);

    // Update act with file info
    await prisma.$executeRawUnsafe(`
      UPDATE installation_acts
      SET image_url = ?,
          file_name = ?,
          file_size = ?,
          updated_at = NOW()
      WHERE id = ?
    `, publicUrl, newFileName, file.size, actId);
    
    console.log(`[Act Upload] ✅ Updated act with file info`);

    // Get updated act
    const [updatedAct] = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_acts WHERE id = ?
    `, actId);

    res.json({
      message: 'Акт файл амжилттай upload хийгдлээ',
      data: serializeBigInt(updatedAct),
    });
  } catch (error) {
    console.error('[POST /api/installation-acts/:id/upload-file] ❌ Error:', error);
    handleError(res, error, 'Акт файл upload хийхэд алдаа гарлаа');
  }
});

/**
 * PUT /api/installation-acts/:id
 * Update an installation act
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { actTitle, comment, imageUrl, fileName, fileSize } = req.body;

    // Verify act exists and user has access
    const [act] = await prisma.$queryRawUnsafe(`
      SELECT ia.*, iaa.user_id
      FROM installation_acts ia
      INNER JOIN installation_assignments iaa ON ia.installation_assignment_id = iaa.id
      WHERE ia.id = ? AND iaa.user_id = ?
      LIMIT 1
    `, BigInt(id), BigInt(req.user.id));

    if (!act) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Акт олдсонгүй эсвэл хандах эрхгүй',
      });
    }

    const updateFields = [];
    const params = [];
    
    if (actTitle !== undefined) {
      updateFields.push('act_title = ?');
      params.push(actTitle ? actTitle.trim() : null);
    }

    if (comment !== undefined) {
      updateFields.push('comment = ?');
      params.push(comment);
    }

    if (imageUrl !== undefined) {
      updateFields.push('image_url = ?');
      params.push(imageUrl);
    }

    if (fileName !== undefined) {
      updateFields.push('file_name = ?');
      params.push(fileName);
    }

    if (fileSize !== undefined) {
      updateFields.push('file_size = ?');
      params.push(fileSize);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Шинэчлэх мэдээлэл оруулаагүй байна',
      });
    }

    updateFields.push('updated_at = NOW()');
    params.push(BigInt(id));

    const updateQuery = `UPDATE installation_acts SET ${updateFields.join(', ')} WHERE id = ?`;
    await prisma.$executeRawUnsafe(updateQuery, ...params);

    // Get updated act
    const [updatedAct] = await prisma.$queryRawUnsafe(`
      SELECT * FROM installation_acts WHERE id = ?
    `, BigInt(id));

    res.json({
      message: 'Акт амжилттай шинэчлэгдлээ',
      data: serializeBigInt(updatedAct),
    });
  } catch (error) {
    console.error('[PUT /api/installation-acts/:id] ❌ Error:', error);
    handleError(res, error, 'Акт шинэчлэхэд алдаа гарлаа');
  }
});

/**
 * DELETE /api/installation-acts/:id
 * Delete an installation act
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify act exists and user has access
    const [act] = await prisma.$queryRawUnsafe(`
      SELECT ia.*, iaa.user_id
      FROM installation_acts ia
      INNER JOIN installation_assignments iaa ON ia.installation_assignment_id = iaa.id
      WHERE ia.id = ? AND iaa.user_id = ?
      LIMIT 1
    `, BigInt(id), BigInt(req.user.id));

    if (!act) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Акт олдсонгүй эсвэл хандах эрхгүй',
      });
    }

    // Delete file from FTP storage if exists
    if (act.file_name) {
      try {
        const filePath = path.join(FTP_STORAGE_PATH, act.file_name);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[DELETE /api/installation-acts/:id] ✅ Deleted file: ${filePath}`);
        }
      } catch (fileError) {
        console.error(`[DELETE /api/installation-acts/:id] ⚠️ Error deleting file (non-critical):`, fileError);
      }
    }

    // Delete act from database
    await prisma.$executeRawUnsafe(`
      DELETE FROM installation_acts WHERE id = ?
    `, BigInt(id));

    res.json({
      message: 'Акт амжилттай устгалаа',
    });
  } catch (error) {
    console.error('[DELETE /api/installation-acts/:id] ❌ Error:', error);
    handleError(res, error, 'Акт устгахад алдаа гарлаа');
  }
});

module.exports = router;
