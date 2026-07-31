const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { serializeBigInt, handleError } = require('../utils/routeHelpers');
const {
  normalizeRelativePath,
  buildPublicUrl,
  loadImagePayload,
  inferMimeType,
} = require('../utils/imageStorage');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

const router = express.Router();
const prisma = new PrismaClient();

console.log('✅ Repairs route module loaded');
console.log('   Checking Prisma Repair model availability...');
try {
  // Test if Repair model is available in Prisma
  if (prisma.Repair) {
    console.log('   ✅ Prisma.Repair model is available');
  } else {
    console.error('   ❌ Prisma.Repair model is NOT available!');
    console.error('   ⚠️  Run: npx prisma generate');
  }
} catch (error) {
  console.error('   ❌ Error checking Prisma Repair model:', error.message);
  console.error('   ⚠️  Run: npx prisma generate');
}

console.log('✅ Repairs route module loaded');
console.log('   Checking Prisma Repair model availability...');
try {
  // Test if Repair model is available in Prisma
  if (prisma.Repair) {
    console.log('   ✅ Prisma.Repair model is available');
  } else {
    console.error('   ❌ Prisma.Repair model is NOT available!');
    console.error('   ⚠️  Run: npx prisma generate');
  }
} catch (error) {
  console.error('   ❌ Error checking Prisma Repair model:', error.message);
  console.error('   ⚠️  Run: npx prisma generate');
}

// =============================================================================
// MULTER CONFIGURATION FOR REPAIR IMAGE UPLOADS
// =============================================================================

const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
if (!fs.existsSync(FTP_STORAGE_PATH)) {
  fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
    }
    cb(null, FTP_STORAGE_PATH);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `temp-repair-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10 // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function verifyInspectionAccess(inspectionId, userId, orgId) {
  // Check if user is admin
  const user = await prisma.User.findUnique({
    where: { id: BigInt(userId) },
    include: {
      role: {
        select: { name: true }
      }
    }
  });

  const isAdmin = user?.role?.name?.toLowerCase() === 'admin';

  // Admin users can access all inspections
  const whereClause = isAdmin 
    ? {
        id: inspectionId,
        deletedAt: null,
      }
    : {
        id: inspectionId,
        OR: [
          { orgId: BigInt(orgId) },
          { assignedTo: BigInt(userId) }
        ],
        deletedAt: null,
      };

  const inspection = await prisma.Inspection.findFirst({
    where: whereClause,
  });

  if (!inspection) {
    throw new Error('Inspection not found or access denied');
  }

  return inspection;
}

// =============================================================================
// ANALYZE INSPECTION AND CREATE REPAIRS
// =============================================================================

// POST /api/repairs/analyze/:inspectionId - Analyze inspection and create repairs
router.post('/analyze/:inspectionId', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.inspectionId);
    const userId = BigInt(req.user.id);

    // Verify access
    await verifyInspectionAccess(inspectionId, userId, req.user.orgId);

    // Get latest answer for this inspection (we'll link repairs to this answer)
    const latestAnswer = await prisma.InspectionAnswer.findFirst({
      where: { inspectionId },
      orderBy: { answeredAt: 'desc' },
    });

    if (!latestAnswer) {
      return res.json({
        message: 'No answers found for this inspection',
        data: {
          inspectionId: inspectionId.toString(),
          repairsCreated: 0,
          repairs: [],
        },
      });
    }

    const answerData = latestAnswer.answers || {};
    
    // Support multiple JSON structures:
    // 1. { data: { sectionName: { fieldId: {...} } } }
    // 2. { sectionName: { fieldId: {...} } }
    // 3. { section: sectionName, answers: { fieldId: {...} } }
    let sections = {};
    
    if (answerData.data && typeof answerData.data === 'object') {
      // Structure 1: { data: { sectionName: {...} } }
      sections = answerData.data;
    } else if (answerData.answers && typeof answerData.answers === 'object') {
      // Structure 3: { section: sectionName, answers: { fieldId: {...} } }
      // This happens when a single section is submitted
      const sectionName = answerData.section || answerData.sectionTitle || 'unknown';
      sections[sectionName] = answerData.answers;
    } else {
      // Structure 2: { sectionName: { fieldId: {...} } }
      sections = answerData;
    }

    console.log('🔍 Analyzing inspection for repairs:', {
      inspectionId: inspectionId.toString(),
      answerId: latestAnswer.id.toString(),
      sectionsCount: Object.keys(sections).length,
      sectionNames: Object.keys(sections),
    });

    const repairsCreated = [];
    const userIdBigInt = BigInt(userId);

    // Analyze each section
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

      console.log(`  📋 Analyzing section: ${sectionName}`);

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

        // Try to get status from various possible fields
        const status = fieldValue.status || 
                      fieldValue.answer || 
                      fieldValue.value || 
                      (Array.isArray(fieldValue.selectedOptions) && fieldValue.selectedOptions[0]) || 
                      '';
        const questionText = fieldValue.question || 
                           fieldValue.questionText || 
                           fieldId || 
                           '';

        console.log(`    🔍 Field ${fieldId}: status="${status}", question="${questionText}"`);

        // Check if repair is needed (status is not "Хэвийн" or "Цэвэр")
        const statusTrimmed = status ? status.toString().trim() : '';
        if (
          statusTrimmed !== '' &&
          statusTrimmed !== 'Хэвийн' &&
          statusTrimmed !== 'Цэвэр' &&
          statusTrimmed.toLowerCase() !== 'normal' &&
          statusTrimmed.toLowerCase() !== 'clean'
        ) {
          console.log(`    ⚠️ Repair needed for field ${fieldId}: status="${statusTrimmed}"`);

          // Check if repair already exists for this field
          const existingRepair = await prisma.Repair.findFirst({
            where: {
              inspectionId,
              fieldId,
              repairStatus: {
                in: ['PENDING', 'IN_PROGRESS']
              }
            },
          });

          if (!existingRepair) {
            console.log(`    ✅ Creating new repair for field ${fieldId}`);
            
            // Prepare repair data
            const repairData = {
              inspectionId,
              inspectionAnswerId: latestAnswer.id,
              fieldId,
              section: sectionName,
              questionText,
              originalStatus: statusTrimmed,
              repairDescription: fieldValue.comment || 
                               fieldValue.textAnswer || 
                               fieldValue.notes || 
                               null,
              repairStatus: 'PENDING',
            };
            
            console.log(`    📝 Repair data:`, {
              inspectionId: inspectionId.toString(),
              fieldId,
              section: sectionName,
              questionText: questionText.substring(0, 50),
              originalStatus: statusTrimmed,
              hasDescription: !!repairData.repairDescription,
            });
            
            try {
              // Create new repair
              const repair = await prisma.Repair.create({
                data: repairData,
              });

              repairsCreated.push(repair);
              console.log(`    ✅ Created repair ID: ${repair.id.toString()}`);
            } catch (createError) {
              console.error(`    ❌ Error creating repair:`, createError);
              console.error(`    Error message: ${createError.message}`);
              console.error(`    Error code: ${createError.code}`);
              if (createError.meta) {
                console.error(`    Error meta:`, createError.meta);
              }
              throw createError;
            }
          } else {
            console.log(`    ⏭️  Repair already exists for field ${fieldId}, skipping`);
          }
        }
      }
    }

    console.log(`✅ Analysis complete: ${repairsCreated.length} repair(s) created`);

    return res.json({
      message: `Analysis complete. ${repairsCreated.length} repair(s) created.`,
      data: {
        inspectionId: inspectionId.toString(),
        repairsCreated: repairsCreated.length,
        repairs: repairsCreated.map(r => ({
          id: r.id.toString(),
          inspectionId: r.inspectionId.toString(),
          inspectionAnswerId: r.inspectionAnswerId ? r.inspectionAnswerId.toString() : null,
          fieldId: r.fieldId,
          section: r.section,
          questionText: r.questionText,
          originalStatus: r.originalStatus,
          repairStatus: r.repairStatus,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    handleError(res, error, 'analyze inspection for repairs');
  }
});

// =============================================================================
// REPAIR CRUD OPERATIONS
// =============================================================================

// IMPORTANT: More specific routes must be registered before parameterized routes
// GET /api/repairs/inspection/:inspectionId - Get repairs for an inspection (before /:id)
router.get('/inspection/:inspectionId', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.inspectionId);
    const userId = BigInt(req.user.id);

    // Verify access
    await verifyInspectionAccess(inspectionId, userId, req.user.orgId);

    const repairs = await prisma.Repair.findMany({
      where: { inspectionId },
      orderBy: { createdAt: 'desc' },
      include: {
        repairer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return res.json({
      message: 'Repairs retrieved successfully',
      data: serializeBigInt(repairs),
      count: repairs.length,
    });
  } catch (error) {
    handleError(res, error, 'get repairs for inspection');
  }
});

// GET /api/repairs - Get all repairs (with filters)
router.get('/', authMiddleware, async (req, res) => {
  try {
    console.log('🔍 [GET /api/repairs] Request received');
    console.log('   Query params:', req.query);
    console.log('   User ID:', req.user?.id);
    console.log('   User orgId:', req.user?.orgId);
    
    const { inspectionId, status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('   Parsed params:', { inspectionId, status, page, limit, skip });

    const where = {};

    if (inspectionId) {
      where.inspectionId = BigInt(inspectionId);
    }

    if (status) {
      where.repairStatus = status.toUpperCase();
    }

    // Filter by organization access (skip for admin users)
    const userId = BigInt(req.user.id);
    const user = await prisma.User.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: { name: true }
        }
      },
    });

    const isAdmin = user?.role?.name?.toLowerCase() === 'admin';
    
    if (user && !isAdmin) {
      // Get inspections accessible by user (non-admin users only)
      const inspections = await prisma.Inspection.findMany({
        where: {
          OR: [
            { orgId: user.orgId },
            { assignedTo: userId }
          ],
          deletedAt: null,
        },
        select: { id: true },
      });

      const inspectionIds = inspections.map(i => i.id);
      
      // Debug: Check if there are any repairs for these inspections
      if (inspectionIds.length === 0) {
        console.log('⚠️  [GET /api/repairs] No accessible inspections found for user');
        console.log('   User orgId:', user.orgId.toString());
        console.log('   User ID:', userId.toString());
      } else {
        console.log('   Filtered by inspections:', inspectionIds.map(id => id.toString()));
        
        // Debug: Check total repairs for these inspections
        const totalRepairsForInspections = await prisma.Repair.count({
          where: {
            inspectionId: { in: inspectionIds }
          }
        });
        console.log('   Total repairs for accessible inspections:', totalRepairsForInspections);
      }
      
      where.inspectionId = { in: inspectionIds };
    } else if (isAdmin) {
      console.log('✅ [GET /api/repairs] Admin user - showing all repairs');
    }

    console.log('   Final where clause:', JSON.stringify(where, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    ));

    const [repairs, total] = await Promise.all([
      prisma.Repair.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          inspection: {
            select: {
              id: true,
              title: true,
              status: true,
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
          },
          repairer: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          images: {
            orderBy: { uploadedAt: 'asc' },
          },
        },
      }),
      prisma.Repair.count({ where }),
    ]);

    console.log(`✅ [GET /api/repairs] Found ${repairs.length} repair(s), total: ${total}`);

    return res.json({
      message: 'Repairs retrieved successfully',
      data: serializeBigInt(repairs),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('❌ [GET /api/repairs] Error:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    handleError(res, error, 'get repairs');
  }
});

// GET /api/repairs/:id - Get repair by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const repairId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const repair = await prisma.Repair.findUnique({
      where: { id: repairId },
      include: {
        inspection: {
          include: {
            device: {
              include: {
                model: true,
                site: true,
                contract: true,
              },
            },
          },
        },
        repairer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        verifier: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        images: {
          orderBy: { uploadedAt: 'asc' },
        },
      },
    });

    if (!repair) {
      return res.status(404).json({
        error: 'Repair not found',
        message: 'The requested repair does not exist',
      });
    }

    // Verify access
    await verifyInspectionAccess(repair.inspectionId, userId, req.user.orgId);

    return res.json({
      message: 'Repair retrieved successfully',
      data: serializeBigInt(repair),
    });
  } catch (error) {
    handleError(res, error, 'get repair by ID');
  }
});

// PUT /api/repairs/:id - Update repair
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const repairId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);
    const { description, repairDescription, repairedStatus, repairStatus, repairedAt, verifiedAt } = req.body;

    const repair = await prisma.Repair.findUnique({
      where: { id: repairId },
    });

    if (!repair) {
      return res.status(404).json({
        error: 'Repair not found',
        message: 'The requested repair does not exist',
      });
    }

    // Verify access
    await verifyInspectionAccess(repair.inspectionId, userId, req.user.orgId);

    const updateData = {};

    // Support both 'description' and 'repairDescription' field names
    if (repairDescription !== undefined) {
      updateData.repairDescription = repairDescription;
    } else if (description !== undefined) {
      updateData.repairDescription = description; // Use correct field name from schema
    }

    if (repairedStatus !== undefined) {
      updateData.repairedStatus = repairedStatus;
    }

    if (repairStatus) {
      updateData.repairStatus = repairStatus.toUpperCase();

      // Update timestamps based on status
      if (repairStatus.toUpperCase() === 'COMPLETED' && !repair.repairedAt) {
        updateData.repairedAt = new Date();
        updateData.repairedBy = userId;
      } else if (repairStatus.toUpperCase() === 'VERIFIED' && !repair.verifiedAt) {
        updateData.verifiedAt = new Date();
        updateData.verifiedBy = userId;
      }
    }

    if (repairedAt) {
      updateData.repairedAt = new Date(repairedAt);
      updateData.repairedBy = userId;
    }

    if (verifiedAt) {
      updateData.verifiedAt = new Date(verifiedAt);
      updateData.verifiedBy = userId;
    }

    const updatedRepair = await prisma.Repair.update({
      where: { id: repairId },
      data: updateData,
      include: {
        repairer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        verifier: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return res.json({
      message: 'Repair updated successfully',
      data: serializeBigInt(updatedRepair),
    });
  } catch (error) {
    handleError(res, error, 'update repair');
  }
});

// =============================================================================
// REPAIR IMAGE UPLOAD
// =============================================================================

// POST /api/repairs/:id/upload-images - Upload images for a repair
router.post('/:id/upload-images', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const repairId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const repair = await prisma.Repair.findUnique({
      where: { id: repairId },
    });

    if (!repair) {
      return res.status(404).json({
        error: 'Repair not found',
        message: 'The requested repair does not exist',
      });
    }

    // Verify access
    await verifyInspectionAccess(repair.inspectionId, userId, req.user.orgId);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded',
        message: 'Please upload at least one image',
      });
    }

    const FTP_REMOTE_PREFIX = process.env.FTP_REMOTE_PREFIX || 'test';
    const timestamp = Date.now();

    // Get existing images count to determine order
    const existingImagesCount = await prisma.RepairImage.count({
      where: { repairId },
    });

    const uploadedImages = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const oldFilePath = file.path;
      const ext = path.extname(file.originalname) || '.jpg';

      // Generate filename: repair_{repairId}_field_{fieldId}_{timestamp}_{order}.jpg
      const newFileName = `repair_${repairId}_field_${repair.fieldId}_${timestamp}_${i}${ext}`;
      
      // Save file directly to FTP storage (no subfolder)
      // Ensure FTP_STORAGE_PATH exists
      if (!fs.existsSync(FTP_STORAGE_PATH)) {
        fs.mkdirSync(FTP_STORAGE_PATH, { recursive: true });
      }
      
      const newFilePath = path.join(FTP_STORAGE_PATH, newFileName);

      try {
        if (fs.existsSync(oldFilePath)) {
          // Ensure destination directory exists
          const destDir = path.dirname(newFilePath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
            console.log(`📁 Created directory: ${destDir}`);
          }
          
          // Copy file to storage (instead of rename to avoid issues)
          fs.copyFileSync(oldFilePath, newFilePath);
          
          // Verify file was copied successfully
          if (!fs.existsSync(newFilePath)) {
            console.error(`❌ File copy failed: ${newFilePath} does not exist after copy`);
            continue;
          }
          
          // Delete temp file
          fs.unlinkSync(oldFilePath);
          console.log(`✅ Saved image to: ${newFilePath} (${fs.statSync(newFilePath).size} bytes)`);
        } else {
          console.error(`❌ Temp file not found: ${oldFilePath}`);
          continue;
        }
      } catch (fileError) {
        console.error(`❌ Error saving file:`, {
          message: fileError.message,
          code: fileError.code,
          oldPath: oldFilePath,
          newPath: newFilePath,
          stack: fileError.stack,
        });
        continue;
      }

      // Build image URL (use filename only, no subfolder prefix)
      // For repair images, use direct public URL without prefix
      const relativePath = newFileName;
      let publicUrl = buildPublicUrl(relativePath);
      
      // If buildPublicUrl returns null, construct URL manually
      if (!publicUrl) {
        const FTP_PUBLIC_BASE_URL = process.env.FTP_PUBLIC_BASE_URL || 'http://192.168.1.54:4555/uploads';
        publicUrl = `${FTP_PUBLIC_BASE_URL}/${newFileName}`;
      }
      
      const imageUrl = publicUrl;

      // Save to repair_images table
      try {
        console.log(`💾 Saving repair image to database:`, {
          repairId: repairId.toString(),
          imageUrl,
          fileName: newFileName,
          filePath: newFilePath,
        });
        
        const repairImage = await prisma.RepairImage.create({
          data: {
            repairId,
            imageUrl: imageUrl,
            fileName: newFileName,
            uploadedAt: new Date(),
          },
        });

        uploadedImages.push({
          id: repairImage.id.toString(),
          repairId: repairId.toString(),
          imageUrl: imageUrl,
          fileName: newFileName,
          uploadedAt: repairImage.uploadedAt.toISOString(),
        });

        console.log(`✅ Saved repair image to database: ${repairImage.id.toString()}`);
      } catch (dbError) {
        console.error(`❌ Error saving to database:`, {
          message: dbError.message,
          code: dbError.code,
          meta: dbError.meta,
          stack: dbError.stack,
          repairId: repairId.toString(),
          imageUrl,
          fileName: newFileName,
        });
        // Clean up file if database save fails
        try {
          if (fs.existsSync(newFilePath)) {
            fs.unlinkSync(newFilePath);
            console.log(`🗑️ Cleaned up file after database error: ${newFilePath}`);
          }
        } catch (cleanupError) {
          console.error(`❌ Error cleaning up file: ${cleanupError.message}`);
        }
        continue;
      }
    }

    if (uploadedImages.length === 0) {
      return res.status(400).json({
        error: 'No images saved',
        message: 'Failed to save any images. Please try again.',
      });
    }

    // Get total images count
    const totalImages = await prisma.RepairImage.count({
      where: { repairId },
    });

    return res.status(201).json({
      message: 'Images uploaded successfully',
      data: {
        repairId: repairId.toString(),
        uploadedImages: uploadedImages,
        totalImages: totalImages,
      },
    });
  } catch (error) {
    console.error('Error uploading repair images:', error);
    handleError(res, error, 'upload repair images');
  }
});

module.exports = router;

