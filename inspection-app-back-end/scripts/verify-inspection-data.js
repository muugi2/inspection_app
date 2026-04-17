/**
 * Inspection Data Verification Script
 * 
 * Энэ скрипт нь дараах зүйлсийг шалгана:
 * 1. inspection_answers хүснэгтэд үзлэгийн мэдээлэл хадгалагдсан эсэх
 * 2. inspection_question_images хүснэгтэд зурагны URL-ууд хадгалагдсан эсэх
 * 3. FTP серверт (C:/ftp_data) зурагны файлууд байгаа эсэх
 * 4. URL болон файлуудын хооронд тохирох эсэх
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { buildPublicUrl, normalizeRelativePath } = require('../utils/imageStorage');

const prisma = new PrismaClient();

const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');

// ANSI colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'bright');
  console.log('='.repeat(80));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

/**
 * Extract filename from URL or path
 */
function extractFileName(urlOrPath) {
  if (!urlOrPath) return null;
  
  // If it's a URL, extract pathname
  try {
    const url = new URL(urlOrPath);
    let pathname = url.pathname;
    
    // Remove leading slashes and any prefix like /test/
    pathname = pathname.replace(/^\/+/, '');
    
    // Remove FTP_REMOTE_PREFIX if present (e.g., "test/")
    const FTP_REMOTE_PREFIX = process.env.FTP_REMOTE_PREFIX || 'test';
    if (pathname.startsWith(FTP_REMOTE_PREFIX + '/')) {
      pathname = pathname.substring(FTP_REMOTE_PREFIX.length + 1);
    }
    
    return path.basename(pathname);
  } catch (e) {
    // Not a URL, treat as path
    // Remove any prefix paths
    let cleanPath = urlOrPath.replace(/^\/+/, '');
    const FTP_REMOTE_PREFIX = process.env.FTP_REMOTE_PREFIX || 'test';
    if (cleanPath.startsWith(FTP_REMOTE_PREFIX + '/')) {
      cleanPath = cleanPath.substring(FTP_REMOTE_PREFIX.length + 1);
    }
    return path.basename(cleanPath);
  }
}

/**
 * Check if file exists in FTP storage
 */
function fileExists(fileName) {
  if (!fileName) return false;
  const filePath = path.join(FTP_STORAGE_PATH, fileName);
  return fs.existsSync(filePath);
}

/**
 * Get file size if exists
 */
function getFileSize(fileName) {
  if (!fileName) return null;
  const filePath = path.join(FTP_STORAGE_PATH, fileName);
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (e) {
    return null;
  }
}

/**
 * Main verification function
 */
async function verifyInspectionData() {
  try {
    logSection('INSPECTION DATA VERIFICATION');
    logInfo(`FTP Storage Path: ${FTP_STORAGE_PATH}`);
    logInfo(`Checking if FTP directory exists...`);
    
    // Check FTP directory exists
    if (!fs.existsSync(FTP_STORAGE_PATH)) {
      logError(`FTP storage directory does not exist: ${FTP_STORAGE_PATH}`);
      return;
    }
    logSuccess(`FTP storage directory exists`);

    // Get all inspection answers
    logSection('1. CHECKING INSPECTION_ANSWERS TABLE');
    const answers = await prisma.$queryRaw`
      SELECT 
        id,
        inspection_id,
        status,
        answered_by,
        answered_at,
        created_at,
        updated_at,
        JSON_LENGTH(answers) as answers_count
      FROM inspection_answers
      ORDER BY created_at DESC
      LIMIT 100
    `;

    logInfo(`Found ${answers.length} inspection answer(s)`);

    if (answers.length === 0) {
      logWarning('No inspection answers found in database');
      return;
    }

    // Display summary
    const summary = {
      total: answers.length,
      inProgress: 0,
      completed: 0,
      withAnswers: 0,
    };

    for (const answer of answers) {
      if (answer.status === 'IN_PROGRESS') summary.inProgress++;
      if (answer.status === 'COMPLETED') summary.completed++;
      if (answer.answers_count > 0) summary.withAnswers++;
    }

    logInfo(`Summary:`);
    logInfo(`  Total: ${summary.total}`);
    logInfo(`  IN_PROGRESS: ${summary.inProgress}`);
    logInfo(`  COMPLETED: ${summary.completed}`);
    logInfo(`  With answers data: ${summary.withAnswers}`);

    // Check inspection_question_images with inspection info
    logSection('2. CHECKING INSPECTION_QUESTION_IMAGES TABLE');
    
    const images = await prisma.$queryRaw`
      SELECT 
        iqi.id,
        iqi.answer_id,
        iqi.field_id,
        iqi.section,
        iqi.image_order,
        iqi.image_url,
        iqi.uploaded_by,
        iqi.uploaded_at,
        iqi.created_at,
        ia.inspection_id,
        i.title as inspection_title
      FROM inspection_question_images iqi
      INNER JOIN inspection_answers ia ON ia.id = iqi.answer_id
      INNER JOIN inspections i ON i.id = ia.inspection_id
      ORDER BY iqi.created_at DESC
      LIMIT 500
    `;

    logInfo(`Found ${images.length} image record(s) in database`);

    if (images.length === 0) {
      logWarning('No images found in inspection_question_images table');
    }

    // Group images by answer_id
    const imagesByAnswer = {};
    for (const img of images) {
      const answerId = img.answer_id.toString();
      if (!imagesByAnswer[answerId]) {
        imagesByAnswer[answerId] = [];
      }
      imagesByAnswer[answerId].push(img);
    }

    logInfo(`Images grouped by ${Object.keys(imagesByAnswer).length} answer(s)`);

    // Verify each image
    logSection('3. VERIFYING IMAGE FILES ON FTP SERVER');
    
    let totalImages = 0;
    let foundImages = 0;
    let missingImages = 0;
    let invalidUrls = 0;
    const missingFiles = [];
    const invalidUrlRecords = [];

    for (const img of images) {
      totalImages++;
      const imageUrl = img.image_url;
      
      if (!imageUrl || imageUrl.trim() === '') {
        invalidUrls++;
        invalidUrlRecords.push({
          id: img.id.toString(),
          answerId: img.answer_id.toString(),
          fieldId: img.field_id,
          order: img.image_order,
          issue: 'Empty URL',
        });
        continue;
      }

      // Extract filename from URL
      const fileName = extractFileName(imageUrl);
      
      if (!fileName) {
        invalidUrls++;
        invalidUrlRecords.push({
          id: img.id.toString(),
          answerId: img.answer_id.toString(),
          fieldId: img.field_id,
          order: img.image_order,
          url: imageUrl,
          issue: 'Cannot extract filename from URL',
        });
        continue;
      }

      // Check if file exists
      if (fileExists(fileName)) {
        foundImages++;
        const fileSize = getFileSize(fileName);
        if (fileSize === 0) {
          logWarning(`File exists but is empty: ${fileName} (ID: ${img.id})`);
        }
      } else {
        missingImages++;
        missingFiles.push({
          id: img.id.toString(),
          answerId: img.answer_id.toString(),
          inspectionId: img.inspection_id ? img.inspection_id.toString() : null,
          inspectionTitle: img.inspection_title || null,
          fieldId: img.field_id,
          section: img.section,
          order: img.image_order,
          url: imageUrl,
          expectedFileName: fileName,
          uploadedAt: img.uploaded_at,
        });
      }
    }

    // Display results
    logSection('4. VERIFICATION RESULTS');
    
    logInfo(`Total images in database: ${totalImages}`);
    logSuccess(`Images found on FTP server: ${foundImages}`);
    
    if (missingImages > 0) {
      logError(`Missing images on FTP server: ${missingImages}`);
    } else {
      logSuccess('All images found on FTP server!');
    }

    if (invalidUrls > 0) {
      logError(`Invalid URLs in database: ${invalidUrls}`);
    }

    // Show missing files details
    if (missingFiles.length > 0) {
      logSection('5. MISSING FILES DETAILS');
      logError(`Found ${missingFiles.length} missing file(s):\n`);
      
      // Group by answer_id
      const missingByAnswer = {};
      for (const missing of missingFiles) {
        const answerId = missing.answerId;
        if (!missingByAnswer[answerId]) {
          missingByAnswer[answerId] = [];
        }
        missingByAnswer[answerId].push(missing);
      }

      for (const [answerId, files] of Object.entries(missingByAnswer)) {
        const firstFile = files[0];
        const inspectionInfo = firstFile.inspectionId 
          ? `Inspection ID: ${firstFile.inspectionId}${firstFile.inspectionTitle ? ` (${firstFile.inspectionTitle})` : ''}`
          : 'Inspection ID: Unknown';
        
        logWarning(`Answer ID: ${answerId} - ${files.length} missing file(s)`);
        logInfo(`  ${inspectionInfo}`);
        
        for (const file of files.slice(0, 5)) { // Show first 5
          logError(`  - Field: ${file.fieldId}, Section: ${file.section}, Order: ${file.order}`);
          logError(`    File: ${file.expectedFileName}`);
          logInfo(`    URL: ${file.url}`);
          if (file.uploadedAt) {
            logInfo(`    Uploaded: ${file.uploadedAt}`);
          }
        }
        if (files.length > 5) {
          logInfo(`    ... and ${files.length - 5} more`);
        }
      }
    }

    // Show invalid URL details
    if (invalidUrlRecords.length > 0) {
      logSection('6. INVALID URL DETAILS');
      logError(`Found ${invalidUrlRecords.length} invalid URL(s):\n`);
      
      for (const record of invalidUrlRecords.slice(0, 10)) {
        logError(`  - ID: ${record.id}, Answer: ${record.answerId}, Field: ${record.fieldId}, Order: ${record.order}`);
        logInfo(`    Issue: ${record.issue}`);
        if (record.url) {
          logInfo(`    URL: ${record.url}`);
        }
      }
      if (invalidUrlRecords.length > 10) {
        logInfo(`    ... and ${invalidUrlRecords.length - 10} more`);
      }
    }

    // Check answers without images
    logSection('7. ANSWERS WITHOUT IMAGES');
    const answersWithImages = new Set(Object.keys(imagesByAnswer));
    const answersWithoutImages = answers.filter(
      (a) => !answersWithImages.has(a.id.toString())
    );

    if (answersWithoutImages.length > 0) {
      logWarning(`Found ${answersWithoutImages.length} answer(s) without images:`);
      for (const answer of answersWithoutImages.slice(0, 10)) {
        logInfo(`  - Answer ID: ${answer.id.toString()}, Inspection ID: ${answer.inspection_id.toString()}, Status: ${answer.status}`);
      }
      if (answersWithoutImages.length > 10) {
        logInfo(`    ... and ${answersWithoutImages.length - 10} more`);
      }
    } else {
      logSuccess('All answers have at least one image');
    }

    // Summary report
    logSection('8. FINAL SUMMARY');
    
    const hasIssues = missingImages > 0 || invalidUrls > 0;
    
    if (!hasIssues) {
      logSuccess('✅ All data verified successfully!');
      logSuccess(`  - ${answers.length} inspection answer(s)`);
      logSuccess(`  - ${totalImages} image record(s)`);
      logSuccess(`  - All ${foundImages} image file(s) found on FTP server`);
    } else {
      logError('❌ Issues found during verification:');
      if (missingImages > 0) {
        logError(`  - ${missingImages} image file(s) missing from FTP server`);
      }
      if (invalidUrls > 0) {
        logError(`  - ${invalidUrls} invalid URL(s) in database`);
      }
      logWarning('\nRecommendation: Check the missing files list above and verify:');
      logWarning('  1. Images were uploaded correctly from Flutter app');
      logWarning('  2. FTP server directory permissions are correct');
      logWarning('  3. Files were not accidentally deleted');
      logWarning('  4. Image URLs in database are correct');
    }

  } catch (error) {
    logError('Error during verification:');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
if (require.main === module) {
  verifyInspectionData()
    .then(() => {
      log('\nVerification completed.', 'bright');
      process.exit(0);
    })
    .catch((error) => {
      logError('Verification failed:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { verifyInspectionData };
