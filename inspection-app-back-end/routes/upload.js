const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// =============================================================================
// MULTER CONFIGURATION
// =============================================================================

// Temporary upload directory
const TEMP_UPLOAD_DIR = path.resolve(__dirname, '..', 'temp_uploads');

// Ensure temp directory exists
if (!fsSync.existsSync(TEMP_UPLOAD_DIR)) {
  fsSync.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

// Configure multer for temporary storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'upload-' + uniqueSuffix + ext);
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

// Configure multer (max 6 files)
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 6 // Maximum 6 files
  }
});

// =============================================================================
// FTP/LOCAL STORAGE CONFIGURATION
// =============================================================================

// FTP storage path (local folder serving as FTP directory)
const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
const FTP_PUBLIC_BASE_URL = process.env.FTP_PUBLIC_BASE_URL || 'http://192.168.1.54:4555/uploads';

// Ensure FTP storage directory exists
if (!fsSync.existsSync(FTP_STORAGE_PATH)) {
  fsSync.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Upload file to FTP storage (actually just copy to local FTP directory)
 * @param {string} tempFilePath - Path to temporary file
 * @param {string} originalName - Original filename
 * @returns {Promise<{fileName: string, ftpUrl: string}>}
 */
async function uploadToFTP(tempFilePath, originalName) {
  try {
    // Generate unique filename for FTP storage
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(originalName);
    const fileName = 'img-' + uniqueSuffix + ext;
    
    // Destination path in FTP storage
    const ftpDestPath = path.join(FTP_STORAGE_PATH, fileName);
    
    // Copy file to FTP storage
    await fs.copyFile(tempFilePath, ftpDestPath);
    
    // Build public URL
    const ftpUrl = `${FTP_PUBLIC_BASE_URL}/${fileName}`;
    
    console.log(`✅ Uploaded to FTP: ${fileName} -> ${ftpUrl}`);
    
    return { fileName, ftpUrl };
  } catch (error) {
    console.error('❌ FTP upload error:', error);
    throw new Error(`Failed to upload to FTP: ${error.message}`);
  }
}

/**
 * Delete temporary file
 * @param {string} filePath - Path to file to delete
 */
async function deleteTempFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`🗑️ Deleted temp file: ${filePath}`);
  } catch (error) {
    console.warn(`⚠️ Failed to delete temp file: ${filePath}`, error.message);
  }
}

/**
 * Save image URL to MySQL database
 * @param {string} userId - User ID
 * @param {string} ftpUrl - FTP URL of the uploaded image
 * @returns {Promise<{id: string}>}
 */
async function saveImageToDatabase(userId, ftpUrl) {
  try {
    // Insert into inspection_question_images table using raw SQL
    const userIdBigInt = BigInt(userId);
    
    await prisma.$executeRaw`
      INSERT INTO inspection_question_images (
        inspection_id,
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
        NULL,
        NULL,
        'uploaded',
        'general',
        1,
        ${ftpUrl},
        ${userIdBigInt},
        NOW(),
        NOW(),
        NOW()
      )
    `;
    
    // Get the inserted ID
    const result = await prisma.$queryRaw`
      SELECT id 
      FROM inspection_question_images 
      WHERE image_url = ${ftpUrl}
      ORDER BY id DESC 
      LIMIT 1
    `;
    
    const imageId = result?.[0]?.id ? result[0].id.toString() : null;
    
    console.log(`✅ Saved to database: ID=${imageId}, URL=${ftpUrl}`);
    
    return { id: imageId };
  } catch (error) {
    console.error('❌ Database save error:', error);
    throw new Error(`Failed to save to database: ${error.message}`);
  }
}

// =============================================================================
// UPLOAD ENDPOINT
// =============================================================================

/**
 * POST /api/upload
 * Upload 0-6 images to FTP and save URLs to MySQL
 * 
 * Form-data fields:
 * - images: Array of image files (0-6 files)
 * - userId: User ID (required)
 */
router.post('/', upload.array('images', 6), async (req, res) => {
  const uploadedFiles = req.files || [];
  const tempFilePaths = [];
  
  try {
    console.log('📤 Upload request received');
    console.log(`  Files: ${uploadedFiles.length}`);
    console.log(`  UserId: ${req.body.userId}`);
    
    // Validate userId
    const { userId } = req.body;
    if (!userId) {
      // Clean up temp files
      for (const file of uploadedFiles) {
        await deleteTempFile(file.path);
      }
      
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    // Validate user exists
    try {
      const user = await prisma.user.findUnique({
        where: { id: BigInt(userId) }
      });
      
      if (!user) {
        // Clean up temp files
        for (const file of uploadedFiles) {
          await deleteTempFile(file.path);
        }
        
        return res.status(400).json({
          success: false,
          error: `User with ID ${userId} not found`
        });
      }
    } catch (error) {
      // Clean up temp files
      for (const file of uploadedFiles) {
        await deleteTempFile(file.path);
      }
      
      return res.status(400).json({
        success: false,
        error: 'Invalid userId format'
      });
    }
    
    // If no files uploaded, return success with empty array
    if (uploadedFiles.length === 0) {
      console.log('ℹ️ No files uploaded, returning empty array');
      return res.json({
        success: true,
        uploaded: []
      });
    }
    
    // Process each uploaded file
    const uploadedUrls = [];
    
    for (const file of uploadedFiles) {
      tempFilePaths.push(file.path);
      
      try {
        console.log(`📁 Processing file: ${file.originalname} (${file.size} bytes)`);
        
        // Upload to FTP
        const { fileName, ftpUrl } = await uploadToFTP(file.path, file.originalname);
        
        // Save to database
        const { id } = await saveImageToDatabase(userId, ftpUrl);
        
        // Add to response
        uploadedUrls.push(ftpUrl);
        
        console.log(`✅ File processed successfully: ${fileName}`);
        
      } catch (fileError) {
        console.error(`❌ Error processing file ${file.originalname}:`, fileError);
        // Continue processing other files
      }
    }
    
    // Clean up all temp files
    for (const tempPath of tempFilePaths) {
      await deleteTempFile(tempPath);
    }
    
    // Return response
    console.log(`✅ Upload completed: ${uploadedUrls.length}/${uploadedFiles.length} files processed`);
    
    return res.json({
      success: true,
      uploaded: uploadedUrls
    });
    
  } catch (error) {
    console.error('❌ Upload error:', error);
    
    // Clean up temp files on error
    for (const tempPath of tempFilePaths) {
      await deleteTempFile(tempPath);
    }
    
    // Clean up any uploaded files that weren't deleted
    for (const file of uploadedFiles) {
      if (file.path) {
        await deleteTempFile(file.path);
      }
    }
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

module.exports = router;

