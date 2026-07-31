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
    console.log(`[Verification Upload] 📁 Multer destination: ${FTP_STORAGE_PATH}`);
    // Ensure directory exists
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      console.log(`[Verification Upload] 📁 Creating directory: ${FTP_STORAGE_PATH}`);
      fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
    }
    cb(null, FTP_STORAGE_PATH);
  },
  filename: function (req, file, cb) {
    // Generate temporary filename - will be renamed later with correct format
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `temp-verification-${uniqueSuffix}${ext}`;
    console.log(`[Verification Upload] 📝 Generated temporary filename: ${fileName} (will be renamed later)`);
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
 * POST /api/verifications
 * Create verification assignments (supports multiple users)
 */
router.post('/', authMiddleware, async (req, res) => {
  console.log('[POST /api/verifications] Request received');
  console.log('[POST /api/verifications] Request body:', JSON.stringify(req.body, null, 2));
  console.log('[POST /api/verifications] User ID:', req.user?.id);
  try {
    const {
      orgId,
      siteId,
      contractId,
      title,
      userIds, // Array of user IDs
    } = req.body;

    // Validation
    if (!orgId) {
      return res.status(400).json({ error: 'Байгууллагын ID шаардлагатай' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Гарчиг шаардлагатай' });
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Хамгийн багадаа 1 хэрэглэгч сонгоно уу' });
    }

    // Verify organization exists
    const org = await prisma.organization.findUnique({
      where: { id: BigInt(orgId) },
    });
    if (!org) {
      return res.status(404).json({ error: 'Байгууллага олдсонгүй' });
    }

    // Verify site exists if provided
    if (siteId) {
      const site = await prisma.site.findUnique({
        where: { id: BigInt(siteId) },
      });
      if (!site) {
        return res.status(404).json({ error: 'Байршил олдсонгүй' });
      }
      // Verify site belongs to organization
      if (site.orgId.toString() !== orgId) {
        return res.status(400).json({ error: 'Байршил энэ байгууллагт хамаарахгүй' });
      }
    }

    // Verify contract exists if provided
    if (contractId) {
      const contract = await prisma.contract.findUnique({
        where: { id: BigInt(contractId) },
      });
      if (!contract) {
        return res.status(404).json({ error: 'Гэрээ олдсонгүй' });
      }
      // Verify contract belongs to organization
      if (contract.orgId.toString() !== orgId) {
        return res.status(400).json({ error: 'Гэрээ энэ байгууллагт хамаарахгүй' });
      }
    }

    // Verify all users exist and are active
    const userIdsBigInt = userIds.map(id => BigInt(id));
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIdsBigInt },
        isActive: true,
        deletedAt: null,
      },
    });

    if (users.length !== userIds.length) {
      return res.status(400).json({ error: 'Зарим хэрэглэгч олдсонгүй эсвэл идэвхгүй байна' });
    }

    // Check for existing PENDING or IN_PROGRESS verifications with same org_id, site_id, and title
    const existingVerifications = await prisma.$queryRawUnsafe(`
      SELECT id FROM verifications
      WHERE org_id = ?
        AND (site_id = ? OR (site_id IS NULL AND ? IS NULL))
        AND title = ?
        AND status IN ('PENDING', 'IN_PROGRESS')
      LIMIT 1
    `, orgId, siteId || null, siteId || null, title.trim());

    if (existingVerifications && existingVerifications.length > 0) {
      return res.status(400).json({ 
        error: `Энэ гарчигтай баталгаажуулалт аль хэдийн үүсгэгдсэн байна (${title.trim()})` 
      });
    }

    // Create verification records for each user
    const createdVerifications = [];
    for (const userId of userIds) {
      const verification = await prisma.$executeRawUnsafe(`
        INSERT INTO verifications (
          org_id, site_id, contract_id, title, user_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())
      `, 
        BigInt(orgId),
        siteId ? BigInt(siteId) : null,
        contractId ? BigInt(contractId) : null,
        title.trim(),
        BigInt(userId)
      );

      // Get the created verification
      const [newVerification] = await prisma.$queryRawUnsafe(`
        SELECT * FROM verifications
        WHERE org_id = ?
          AND (site_id = ? OR (site_id IS NULL AND ? IS NULL))
          AND title = ?
          AND user_id = ?
          AND status = 'PENDING'
        ORDER BY created_at DESC
        LIMIT 1
      `, orgId, siteId || null, siteId || null, title.trim(), BigInt(userId));

      if (newVerification) {
        createdVerifications.push(newVerification);
      }
    }

    console.log(`[POST /api/verifications] ✅ Created ${createdVerifications.length} verification(s)`);

    res.status(201).json({
      message: 'Баталгаажуулалтын томилолт амжилттай үүслээ',
      count: createdVerifications.length,
      data: serializeBigInt(createdVerifications),
    });
  } catch (error) {
    console.error('[POST /api/verifications] ❌ Error:', error);
    handleError(res, error, 'Баталгаажуулалтын томилолт үүсгэхэд алдаа гарлаа');
  }
});

/**
 * GET /api/verifications
 * Get all verifications with optional filters
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { orgId, siteId, contractId, userId, status, page = 1, limit = 50 } = req.query;

    let query = 'SELECT * FROM verifications WHERE 1=1';
    const params = [];

    if (orgId) {
      query += ' AND org_id = ?';
      params.push(BigInt(orgId));
    }

    if (siteId) {
      query += ' AND site_id = ?';
      params.push(BigInt(siteId));
    }

    if (contractId) {
      query += ' AND contract_id = ?';
      params.push(BigInt(contractId));
    }

    if (userId) {
      query += ' AND user_id = ?';
      params.push(BigInt(userId));
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status.toUpperCase());
    }

    query += ' ORDER BY created_at DESC';

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const verifications = await prisma.$queryRawUnsafe(query, ...params);

    res.json({
      data: serializeBigInt(verifications),
      count: verifications.length,
    });
  } catch (error) {
    console.error('[GET /api/verifications] ❌ Error:', error);
    handleError(res, error, 'Баталгаажуулалтын томилолтуудыг авахад алдаа гарлаа');
  }
});

/**
 * GET /api/verifications/user/:userId
 * Get verifications for a specific user
 */
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verifications = await prisma.$queryRawUnsafe(`
      SELECT v.*, 
             o.name as org_name,
             s.name as site_name,
             c.contract_name, c.contract_number
      FROM verifications v
      LEFT JOIN organizations o ON v.org_id = o.id
      LEFT JOIN sites s ON v.site_id = s.id
      LEFT JOIN contracts c ON v.contract_id = c.id
      WHERE v.user_id = ?
      ORDER BY v.created_at DESC
    `, BigInt(userId));

    res.json({
      data: serializeBigInt(verifications),
      count: verifications.length,
    });
  } catch (error) {
    console.error('[GET /api/verifications/user/:userId] ❌ Error:', error);
    handleError(res, error, 'Хэрэглэгчийн баталгаажуулалтын томилолтуудыг авахад алдаа гарлаа');
  }
});

/**
 * GET /api/verifications/:id
 * Get verification by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const [verification] = await prisma.$queryRawUnsafe(`
      SELECT v.*, 
             o.name as org_name,
             s.name as site_name,
             c.contract_name, c.contract_number,
             u.full_name as user_name, u.email as user_email
      FROM verifications v
      LEFT JOIN organizations o ON v.org_id = o.id
      LEFT JOIN sites s ON v.site_id = s.id
      LEFT JOIN contracts c ON v.contract_id = c.id
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.id = ?
    `, BigInt(id));

    if (!verification) {
      return res.status(404).json({ error: 'Баталгаажуулалтын томилолт олдсонгүй' });
    }

    res.json({
      data: serializeBigInt(verification),
    });
  } catch (error) {
    console.error('[GET /api/verifications/:id] ❌ Error:', error);
    handleError(res, error, 'Баталгаажуулалтын томилолтыг авахад алдаа гарлаа');
  }
});

/**
 * POST /api/verifications/:id/upload-images
 * Upload images for verification (max 2 images)
 */
router.post('/:id/upload-images', authMiddleware, upload.array('images', 2), async (req, res) => {
  try {
    console.log('[POST /api/verifications/:id/upload-images] Request received');
    console.log('[Verification Upload] Verification ID:', req.params.id);
    console.log('[Verification Upload] Files received:', req.files?.length || 0);

    const verificationId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    // Verify verification exists and user has access
    const verification = await prisma.$queryRawUnsafe(`
      SELECT id, user_id
      FROM verifications
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `, verificationId, userId);

    if (!verification || verification.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Баталгаажуулалт олдсонгүй эсвэл хандах эрхгүй',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Зураг оруулаагүй байна',
      });
    }

    // Limit to 2 images
    const filesToProcess = req.files.slice(0, 2);
    console.log(`[Verification Upload] 📦 Processing ${filesToProcess.length} uploaded file(s)`);
    
    const FTP_PUBLIC_BASE_URL = process.env.FTP_PUBLIC_BASE_URL || 'http://192.168.1.54:4555/uploads';
    const timestamp = Date.now();
    
    const uploadedImages = [];
    
    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const oldFilePath = file.path;
      const ext = path.extname(file.originalname) || '.jpg';
      
      // Generate new filename: verification_{verificationId}_{timestamp}_{order}.jpg
      const newFileName = `verification_${verificationId}_${timestamp}_${i}${ext}`;
      const newFilePath = path.join(FTP_STORAGE_PATH, newFileName);
      
      // Rename file to correct format
      try {
        if (fs.existsSync(oldFilePath)) {
          fs.renameSync(oldFilePath, newFilePath);
          console.log(`[Verification Upload] ✅ Renamed file: ${file.filename} -> ${newFileName}`);
        } else {
          console.error(`[Verification Upload] ❌ Old file not found: ${oldFilePath}`);
          continue;
        }
      } catch (renameError) {
        console.error(`[Verification Upload] ❌ Error renaming file: ${renameError.message}`);
        continue;
      }
      
      // Build public URL
      const relativePath = newFileName;
      let publicUrl = buildPublicUrl(relativePath);
      
      // If buildPublicUrl returns null, construct URL manually
      if (!publicUrl) {
        publicUrl = `${FTP_PUBLIC_BASE_URL}/${newFileName}`;
      }

      console.log(`[Verification Upload] 📸 Image ${i + 1}:`);
      console.log(`     Filename: ${newFileName}`);
      console.log(`     Saved to: ${newFilePath}`);
      console.log(`     Size: ${file.size} bytes`);
      console.log(`     URL: ${publicUrl}`);

      uploadedImages.push({
        order: i + 1,
        fileName: newFileName,
        fileSize: file.size,
        imageUrl: publicUrl,
        mimeType: file.mimetype,
      });
    }

    // Update verification with image URLs and file info
    if (uploadedImages.length > 0) {
      const updateFields = [];
      const params = [];

      // Update image 1
      if (uploadedImages[0]) {
        updateFields.push('image1_url = ?');
        params.push(uploadedImages[0].imageUrl);
        updateFields.push('file_name_1 = ?');
        params.push(uploadedImages[0].fileName);
        updateFields.push('file_size_1 = ?');
        params.push(uploadedImages[0].fileSize);
      }

      // Update image 2
      if (uploadedImages[1]) {
        updateFields.push('image2_url = ?');
        params.push(uploadedImages[1].imageUrl);
        updateFields.push('file_name_2 = ?');
        params.push(uploadedImages[1].fileName);
        updateFields.push('file_size_2 = ?');
        params.push(uploadedImages[1].fileSize);
      }

      updateFields.push('updated_at = NOW()');
      params.push(verificationId);

      const updateQuery = `UPDATE verifications SET ${updateFields.join(', ')} WHERE id = ?`;
      await prisma.$executeRawUnsafe(updateQuery, ...params);
      
      console.log(`[Verification Upload] ✅ Updated verification with ${uploadedImages.length} image(s)`);
    }

    res.json({
      message: `${uploadedImages.length} зураг амжилттай upload хийгдлээ`,
      data: {
        uploadedImages: uploadedImages,
      },
    });
  } catch (error) {
    console.error('[POST /api/verifications/:id/upload-images] ❌ Error:', error);
    handleError(res, error, 'Зураг upload хийхэд алдаа гарлаа');
  }
});

/**
 * PUT /api/verifications/:id
 * Update verification
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      status, 
      comment, 
      image1Url, 
      image2Url,
      fileName1,
      fileName2,
      fileSize1,
      fileSize2,
    } = req.body;

    const updateFields = [];
    const params = [];

    if (status) {
      updateFields.push('status = ?');
      params.push(status.toUpperCase());
    }

    if (comment !== undefined) {
      updateFields.push('comment = ?');
      params.push(comment);
    }

    if (image1Url !== undefined) {
      updateFields.push('image1_url = ?');
      params.push(image1Url);
    }

    if (image2Url !== undefined) {
      updateFields.push('image2_url = ?');
      params.push(image2Url);
    }

    if (fileName1 !== undefined) {
      updateFields.push('file_name_1 = ?');
      params.push(fileName1);
    }

    if (fileName2 !== undefined) {
      updateFields.push('file_name_2 = ?');
      params.push(fileName2);
    }

    if (fileSize1 !== undefined) {
      updateFields.push('file_size_1 = ?');
      params.push(fileSize1);
    }

    if (fileSize2 !== undefined) {
      updateFields.push('file_size_2 = ?');
      params.push(fileSize2);
    }

    if (status === 'COMPLETED') {
      updateFields.push('answered_at = NOW()');
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Шинэчлэх мэдээлэл оруулаагүй байна' });
    }

    updateFields.push('updated_at = NOW()');
    params.push(BigInt(id));

    const query = `UPDATE verifications SET ${updateFields.join(', ')} WHERE id = ?`;
    await prisma.$executeRawUnsafe(query, ...params);

    // Get updated verification
    const [updated] = await prisma.$queryRawUnsafe(`
      SELECT * FROM verifications WHERE id = ?
    `, BigInt(id));

    res.json({
      message: 'Баталгаажуулалтын томилолт амжилттай шинэчлэгдлээ',
      data: serializeBigInt(updated),
    });
  } catch (error) {
    console.error('[PUT /api/verifications/:id] ❌ Error:', error);
    handleError(res, error, 'Баталгаажуулалтын томилолт шинэчлэхэд алдаа гарлаа');
  }
});

/**
 * DELETE /api/verifications/:id
 * Delete verification
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.$executeRawUnsafe(`
      DELETE FROM verifications WHERE id = ?
    `, BigInt(id));

    if (deleted === 0) {
      return res.status(404).json({ error: 'Баталгаажуулалтын томилолт олдсонгүй' });
    }

    res.json({
      message: 'Баталгаажуулалтын томилолт амжилттай устгалаа',
    });
  } catch (error) {
    console.error('[DELETE /api/verifications/:id] ❌ Error:', error);
    handleError(res, error, 'Баталгаажуулалтын томилолт устгахад алдаа гарлаа');
  }
});

module.exports = router;
