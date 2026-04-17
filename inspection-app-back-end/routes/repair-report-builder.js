/**
 * Засварын тайлангийн template data бэлтгэх функц
 * Easy-template-x ашиглан DOCX тайлан үүсгэхэд зориулагдсан
 */

const path = require('path');
const { TemplateHandler, MimeType } = require('easy-template-x');
const sharp = require('sharp');
const { normalizeRelativePath, loadImagePayload, buildPublicUrl, inferMimeType } = require('../utils/imageStorage');
const {
  mapExteriorSection,
  mapIndicatorSection,
  mapJboxSection,
  mapSensorSection,
  mapFoundationSection,
  mapCleanlinessSection,
} = require('../services/report-service');

// MIME type-ийг lowercase string format руу хөрвүүлэх (easy-template-x-ийн шаардлагын дагуу)
// CRITICAL: Must return exact strings that easy-template-x recognizes: 'png', 'jpg' (not 'jpeg'), 'gif', 'bmp'
// easy-template-x expects 'jpg' not 'jpeg' for JPEG images
function getImageFormat(mimeType) {
  const normalized = (mimeType || 'image/jpeg').toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'; // easy-template-x expects 'jpg' not 'jpeg'
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  return 'jpg'; // Default - must be 'jpg' not 'jpeg'
}

/**
 * Section нэрийг монгол хэл рүү хөрвүүлэх
 */
function getSectionName(section) {
  const sectionNames = {
    exterior: 'Гадаад хэсэг',
    indicator: 'Индикатор',
    jbox: 'J-Box',
    sensor: 'Мэдрэгч',
    foundation: 'Суурь',
    cleanliness: 'Цэвэрлэгээ',
  };
  return sectionNames[section] || section;
}

/**
 * Засварын тайлангийн template data бэлтгэх
 * @param {Object} prisma - Prisma client instance
 * @param {BigInt} inspectionId - Inspection ID
 * @param {BigInt|null} repairId - Зөвхөн тухайн засварыг шүүх (optional)
 * @returns {Promise<Object>} Template data object
 */
async function buildRepairReportData(prisma, inspectionId, repairId = null) {
  const inspectionIdBigInt = typeof inspectionId === 'bigint' ? inspectionId : BigInt(inspectionId);
  const repairIdBigInt = repairId ? (typeof repairId === 'bigint' ? repairId : BigInt(repairId)) : null;

  // 1. Inspection мэдээлэл авах
  const inspection = await prisma.Inspection.findUnique({
    where: { id: inspectionIdBigInt },
    include: {
      device: {
        include: {
          model: true,
          contract: {
            include: {
              organization: true,
            },
          },
        },
      },
      site: {
        include: {
          organization: true,
        },
      },
      contract: {
        include: {
          organization: true,
        },
      },
    },
  });

  if (!inspection) {
    throw new Error('Inspection not found');
  }

  // 2. Засваруудыг авах
  // repairId байвал зөвхөн тухайн засварыг шүүх
  const repairWhere = {
    inspectionId: inspectionIdBigInt,
    repairStatus: {
      in: ['COMPLETED', 'VERIFIED'], // Зөвхөн дууссан болон баталгаажсан засварууд
    },
  };
  
  // Зөвхөн тухайн засварыг шүүх
  if (repairIdBigInt) {
    repairWhere.id = repairIdBigInt;
  }

  const repairs = await prisma.Repair.findMany({
    where: repairWhere,
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
      images: {
        orderBy: { uploadedAt: 'asc' },
      },
    },
    orderBy: [
      { section: 'asc' },
      { fieldId: 'asc' },
    ],
  });

  // 3. Inspection answers-аас өмнөх мэдээлэл авах
  const answers = await prisma.InspectionAnswer.findMany({
    where: { inspectionId: inspectionIdBigInt },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
    orderBy: { answeredAt: 'asc' },
  });

  const latestAnswer = answers.length > 0 ? answers[answers.length - 1] : null;
  
  // Parse inspection answer data (InspectionAnswer-ийн зарчмаар)
  let parsedAnswers = {};
  if (latestAnswer?.answers) {
    try {
      parsedAnswers =
        typeof latestAnswer.answers === 'string'
          ? JSON.parse(latestAnswer.answers)
          : latestAnswer.answers;
    } catch (error) {
      console.warn(
        '[Repair Report] Failed to parse answers JSON:',
        error.message
      );
    }
  }

  // Extract data root (report-service.js-ийн адил)
  const dataRoot = parsedAnswers.data || parsedAnswers;
  const metadata = dataRoot.metadata || parsedAnswers.metadata || {};
  
  // Гарын үсэг авах (inspection_answers-аас)
  // extractSignatureImage функц report-service.js-ээс export хийгдээгүй тул энд тодорхойлно
  function extractSignatureImage(signatureValue) {
    if (!signatureValue || typeof signatureValue !== 'string') {
      return null;
    }
    const match = signatureValue.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      return null;
    }
    return {
      data: match[2],
      mimeType: match[1],
    };
  }
  const signatureInspector = extractSignatureImage(
    parsedAnswers.signatures?.inspector
  );
  
  // Support multiple JSON structures (backward compatibility)
  let sections = {};
  if (dataRoot && typeof dataRoot === 'object' && !Array.isArray(dataRoot)) {
    sections = dataRoot;
  } else {
    sections = parsedAnswers;
  }
  
  // Map sections using InspectionAnswer mapping functions (InspectionAnswer-ийн зарчмаар)
  const mappedSections = {
    exterior: mapExteriorSection(sections.exterior || {}),
    indicator: mapIndicatorSection(sections.indicator || {}),
    jbox: mapJboxSection(sections.jbox || {}),
    sensor: mapSensorSection(sections.sensor || {}),
    foundation: mapFoundationSection(sections.foundation || {}),
    cleanliness: mapCleanlinessSection(sections.cleanliness || {}),
  };

  // 4. Inspection answer images авах (өмнөх зураг)
  // InspectionQuestionImage хүснэгтээс зурагнуудыг авах (answer_id-аар JOIN хийж)
  let answerImages = [];
  try {
    answerImages = await prisma.$queryRaw`
      SELECT 
        qi.id,
        qi.answer_id,
        ia.inspection_id,
        qi.field_id,
        qi.section,
        qi.image_url,
        qi.image_order,
        qi.uploaded_at
      FROM inspection_question_images qi
      INNER JOIN inspection_answers ia ON ia.id = qi.answer_id
      WHERE ia.inspection_id = ${inspectionIdBigInt}
      ORDER BY qi.section ASC, qi.field_id ASC, qi.image_order ASC
    `;
  } catch (error) {
    console.error('[Repair Report] Error fetching answer images:', error.message);
    console.error('[Repair Report] Stack:', error.stack);
    // Continue with empty array if images can't be fetched
    answerImages = [];
  }

  // 5. Template data бэлтгэх - d.repair single object
  // repairId байвал тухайн repair-ийг, эсвэл эхний repair-ийг ашиглана
  const selectedRepair = repairs.length > 0 ? repairs[0] : null;
  
  // Repair object бэлтгэх (selectedRepair байвал)
  let repairData = null;
  if (selectedRepair) {
    const sectionName = getSectionName(selectedRepair.section);
    const fieldName = selectedRepair.questionText || selectedRepair.fieldId;
    
    // Өмнөх мэдээлэл (inspection_answers-аас) - InspectionAnswer-ийн зарчмаар structured бүтэц
    const mappedSection = mappedSections[selectedRepair.section] || {};
    const beforeFieldData = mappedSection[selectedRepair.fieldId] || {};
    
    // Structured field data (status, comment, question)
    const beforeStatus = selectedRepair.originalStatus || beforeFieldData.status || '';
    const beforeComment = beforeFieldData.comment || '';
    
    // Өмнөх зураг (inspection_question_images хүснэгтээс - үзлэгийн үеийн зураг)
    const beforeImages = answerImages.filter(
      img => img.section === selectedRepair.section && img.field_id === selectedRepair.fieldId
    );
    
    console.log('[Repair Report] Before images found:', {
      section: selectedRepair.section,
      fieldId: selectedRepair.fieldId,
      count: beforeImages.length,
      images: beforeImages.map(img => ({
        id: img.id,
        image_url: img.image_url,
        section: img.section,
        field_id: img.field_id,
      })),
    });
    
    // Дараах мэдээлэл (repair_images хүснэгтээс - засварын дараах зураг)
    const afterDescription = selectedRepair.repairDescription || '';
    const afterImages = selectedRepair.images || [];
    
    console.log('[Repair Report] After images found:', {
      count: afterImages.length,
      images: afterImages.map(img => ({
        id: img.id,
        imageUrl: img.imageUrl, // Prisma camelCase
        fileName: img.fileName, // Prisma camelCase
      })),
    });
    
    // Template placeholder-уудтай тохирох мэдээлэл
    const before_text = beforeComment || beforeStatus || '-';
    const after_text = afterDescription || '-';
    
    // Өмнөх зураг бэлтгэх (DOCX-д ашиглах)
    let before_image = null;
    // Preview-д зориулж өмнөх зургийн мэдээлэл (base64 + imageUrl)
    let beforeImagePreview = null;
    if (beforeImages.length > 0) {
      const firstBeforeImage = beforeImages[0];
      // Prisma $queryRaw нь snake_case талбаруудыг буцаадаг, тиймээс image_url ашиглах
      const imageUrl = firstBeforeImage.image_url || firstBeforeImage.imageUrl;
      console.log('[Repair Report] Before image raw data:', {
        image_url: firstBeforeImage.image_url,
        imageUrl: firstBeforeImage.imageUrl,
        selectedImageUrl: imageUrl,
      });
      let relativePath = normalizeRelativePath(imageUrl);
      console.log('[Repair Report] Loading before image:', { imageUrl, relativePath });
      
      // Хэрэв relativePath null байвал эсвэл зөв биш байвал, imageUrl-ийг шууд ашиглах
      if (!relativePath && imageUrl) {
        // URL-ээс path-ийг шууд авах
        try {
          const url = new URL(imageUrl);
          relativePath = url.pathname.replace(/^\/+/, ''); // Эхний /-ийг арилгах
          console.log('[Repair Report] Extracted path from URL:', { imageUrl, relativePath });
        } catch (e) {
          // URL биш бол шууд path гэж үзэх
          relativePath = imageUrl.replace(/^\/+/, '');
          console.log('[Repair Report] Using imageUrl as path:', { imageUrl, relativePath });
        }
      }
      
      if (relativePath) {
        try {
          console.log('[Repair Report] Calling loadImagePayload with:', relativePath);
          const payload = await loadImagePayload(relativePath);
          console.log('[Repair Report] loadImagePayload result:', {
            hasPayload: !!payload,
            hasBuffer: !!payload?.buffer,
            hasBase64: !!payload?.base64,
            error: payload?.error,
            localPath: payload?.localPath,
          });
          
          if (payload && (payload.buffer || payload.base64)) {
            const mimeType = inferMimeType(relativePath);
            const format = getImageFormat(mimeType);
            console.log('[Repair Report] Before image payload:', { 
              hasBuffer: !!payload.buffer, 
              isBuffer: Buffer.isBuffer(payload.buffer),
              bufferLength: payload.buffer?.length,
              mimeType,
              format
            });
            if (payload.buffer && Buffer.isBuffer(payload.buffer)) {
              // Зургийн анхны хэмжээг унших (харьцааг хадгалахын тулд)
              const sharpImage = sharp(payload.buffer);
              const metadata = await sharpImage.metadata();
              const originalWidth = metadata.width || 2448;
              const originalHeight = metadata.height || 3264;
              const aspectRatio = originalWidth / originalHeight;
              
              console.log('[Repair Report] Before image original size:', {
                width: originalWidth,
                height: originalHeight,
                aspectRatio: aspectRatio.toFixed(4)
              });
              
              // Хоёр зураг ижил хэмжээтэй харагдахын тулд тогтмол хэмжээ ашиглах
              // Target хэмжээ: Word-ийн хэмжээгээр (2.32" x 3.09") = 223x297 пиксел (96 DPI)
              // Width: 2.32" * 96 = 222.72 ≈ 223 pixels
              // Height: 3.09" * 96 = 296.64 ≈ 297 pixels
              const targetWidth = 223;  // 2.32 inches in pixels (96 DPI)
              const targetHeight = 297; // 3.09 inches in pixels (96 DPI)
              
              // Харьцааг хадгалахын зэрэгцээ resize хийх, гэхдээ хоёр зураг ижил хэмжээтэй байх
              // fit: 'contain' ашиглаж, зурагийг контейнер дотор байрлуулна (зах тайрахгүй)
              let finalWidth = targetWidth;
              let finalHeight = targetHeight;
              
              console.log('[Repair Report] Before image resized:', {
                original: `${originalWidth}x${originalHeight}`,
                aspectRatio: aspectRatio.toFixed(4),
                target: `${targetWidth}x${targetHeight}`,
                final: `${finalWidth}x${finalHeight}`,
                note: 'Fixed size container - aspect ratio preserved within bounds'
              });
              
              // CRITICAL: Convert JPEG to PNG and resize with aspect ratio preserved
              // fit: 'contain' ашиглаж, зурагийг контейнер дотор байрлуулна (зах тайрахгүй)
              let imageBuffer;
              if (format === 'jpg' || format === 'jpeg') {
                console.log('[Repair Report] Converting before_image JPEG to PNG and resizing with contain fit');
                imageBuffer = await sharp(payload.buffer)
                  .autoOrient()
                  .resize(targetWidth, targetHeight, {
                    fit: 'contain', // Fit within bounds, preserve aspect ratio, no cropping
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
                  })
                  .png()
                  .toBuffer();
              } else {
                // PNG эсвэл бусад формат
                imageBuffer = await sharp(payload.buffer)
                  .autoOrient()
                  .resize(targetWidth, targetHeight, {
                    fit: 'contain', // Fit within bounds, preserve aspect ratio, no cropping
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
                  })
                  .png()
                  .toBuffer();
              }
              
              // Хоёр зураг ижил хэмжээтэй харагдахын тулд ижил width/height ашиглах
              before_image = {
                _type: 'image',
                source: imageBuffer,
                format: MimeType.Png, // CRITICAL: Use MimeType enum, not string
                width: targetWidth,  // Fixed width - both images same size
                height: targetHeight, // Fixed height - both images same size
              };
              console.log('[Repair Report] ✅ Created before_image object:', {
                _type: before_image._type,
                format: before_image.format,
                sourceLength: before_image.source.length,
                width: before_image.width,
                height: before_image.height
              });
            } else {
              console.error('[Repair Report] ❌ Invalid buffer for before image');
            }
            // Preview-д ашиглах
            if (payload.base64) {
              beforeImagePreview = {
                base64: payload.base64,
                mimeType: mimeType,
                imageUrl: buildPublicUrl(relativePath) || imageUrl,
              };
            }
          } else {
            console.error('[Repair Report] ❌ No payload buffer or base64 for before image:', {
              hasPayload: !!payload,
              hasBuffer: !!payload?.buffer,
              hasBase64: !!payload?.base64,
              error: payload?.error,
              localPath: payload?.localPath,
            });
          }
        } catch (error) {
          console.error(`[Repair Report] ❌ Error loading before image: ${error.message}`);
          console.error('[Repair Report] Error stack:', error.stack);
          console.error('[Repair Report] Error details:', {
            imageUrl,
            relativePath,
            errorName: error.name,
            errorCode: error.code,
          });
        }
      } else {
        console.error('[Repair Report] ❌ No relative path for before image:', {
          imageUrl,
          image_url: firstBeforeImage.image_url,
          imageUrl_field: firstBeforeImage.imageUrl,
        });
      }
    } else {
      console.log('[Repair Report] ⚠️ No before images found');
    }
    
    // Дараах зураг бэлтгэх (DOCX-д ашиглах)
    let after_image = null;
    // Preview-д зориулж дараах зургийн мэдээлэл (base64 + imageUrl)
    let afterImagePreview = null;
    if (afterImages.length > 0) {
      const firstAfterImage = afterImages[0];
      console.log('[Repair Report] After image raw data:', {
        imageUrl: firstAfterImage.imageUrl, // Prisma camelCase
        fileName: firstAfterImage.fileName, // Prisma camelCase
      });
      
      // RepairImage model-ийн талбаруудыг шалгах (Prisma camelCase)
      const imageUrl = firstAfterImage.imageUrl; // Prisma-ийн include-аас авсан тул camelCase
      const fileName = firstAfterImage.fileName;
      let relativePath = null;
      
      if (fileName) {
        relativePath = fileName;
        console.log('[Repair Report] Using fileName for after image:', relativePath);
      } else if (imageUrl) {
        relativePath = normalizeRelativePath(imageUrl);
        if (relativePath && relativePath.startsWith('uploads/')) {
          relativePath = relativePath.replace(/^uploads\//, '');
        }
        console.log('[Repair Report] Using imageUrl for after image:', { imageUrl, relativePath });
      } else {
        console.error('[Repair Report] ❌ No fileName or imageUrl found for after image');
      }
      
      console.log('[Repair Report] Loading after image:', { imageUrl, fileName, relativePath });
      if (relativePath) {
        try {
          console.log('[Repair Report] Calling loadImagePayload for after image with:', relativePath);
          const payload = await loadImagePayload(relativePath);
          console.log('[Repair Report] loadImagePayload result for after image:', {
            hasPayload: !!payload,
            hasBuffer: !!payload?.buffer,
            hasBase64: !!payload?.base64,
            error: payload?.error,
            localPath: payload?.localPath,
          });
          
          if (payload && (payload.buffer || payload.base64)) {
            const mimeType = inferMimeType(relativePath);
            const format = getImageFormat(mimeType);
            console.log('[Repair Report] After image payload:', { 
              hasBuffer: !!payload.buffer, 
              isBuffer: Buffer.isBuffer(payload.buffer),
              bufferLength: payload.buffer?.length,
              mimeType,
              format
            });
            if (payload.buffer && Buffer.isBuffer(payload.buffer)) {
              // Зургийн анхны хэмжээг унших (харьцааг хадгалахын тулд)
              const sharpImage = sharp(payload.buffer);
              const metadata = await sharpImage.metadata();
              const originalWidth = metadata.width || 2448;
              const originalHeight = metadata.height || 3264;
              const aspectRatio = originalWidth / originalHeight;
              
              console.log('[Repair Report] After image original size:', {
                width: originalWidth,
                height: originalHeight,
                aspectRatio: aspectRatio.toFixed(4)
              });
              
              // Хоёр зураг ижил хэмжээтэй харагдахын тулд тогтмол хэмжээ ашиглах
              // Target хэмжээ: Word-ийн хэмжээгээр (2.32" x 3.09") = 223x297 пиксел (96 DPI)
              // Width: 2.32" * 96 = 222.72 ≈ 223 pixels
              // Height: 3.09" * 96 = 296.64 ≈ 297 pixels
              const targetWidth = 223;  // 2.32 inches in pixels (96 DPI)
              const targetHeight = 297; // 3.09 inches in pixels (96 DPI)
              
              // Харьцааг хадгалахын зэрэгцээ resize хийх, гэхдээ хоёр зураг ижил хэмжээтэй байх
              // fit: 'contain' ашиглаж, зурагийг контейнер дотор байрлуулна (зах тайрахгүй)
              let finalWidth = targetWidth;
              let finalHeight = targetHeight;
              
              console.log('[Repair Report] After image resized:', {
                original: `${originalWidth}x${originalHeight}`,
                aspectRatio: aspectRatio.toFixed(4),
                target: `${targetWidth}x${targetHeight}`,
                final: `${finalWidth}x${finalHeight}`,
                note: 'Fixed size container - aspect ratio preserved within bounds'
              });
              
              // CRITICAL: Convert JPEG to PNG and resize with aspect ratio preserved
              // fit: 'contain' ашиглаж, зурагийг контейнер дотор байрлуулна (зах тайрахгүй)
              let imageBuffer;
              if (format === 'jpg' || format === 'jpeg') {
                console.log('[Repair Report] Converting after_image JPEG to PNG and resizing with contain fit');
                imageBuffer = await sharp(payload.buffer)
                  .autoOrient()
                  .resize(targetWidth, targetHeight, {
                    fit: 'contain', // Fit within bounds, preserve aspect ratio, no cropping
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
                  })
                  .png()
                  .toBuffer();
              } else {
                // PNG эсвэл бусад формат
                imageBuffer = await sharp(payload.buffer)
                  .autoOrient()
                  .resize(targetWidth, targetHeight, {
                    fit: 'contain', // Fit within bounds, preserve aspect ratio, no cropping
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
                  })
                  .png()
                  .toBuffer();
              }
              
              // Хоёр зураг ижил хэмжээтэй харагдахын тулд ижил width/height ашиглах
              after_image = {
                _type: 'image',
                source: imageBuffer,
                format: MimeType.Png, // CRITICAL: Use MimeType enum, not string
                width: targetWidth,  // Fixed width - both images same size
                height: targetHeight, // Fixed height - both images same size
              };
              console.log('[Repair Report] ✅ Created after_image object:', {
                _type: after_image._type,
                format: after_image.format,
                sourceLength: after_image.source.length,
                width: after_image.width,
                height: after_image.height
              });
            } else {
              console.error('[Repair Report] ❌ Invalid buffer for after image');
            }
            // Preview-д ашиглах
            if (payload.base64) {
              afterImagePreview = {
                base64: payload.base64,
                mimeType: mimeType,
                imageUrl: buildPublicUrl(relativePath) || imageUrl,
              };
            }
          } else {
            console.error('[Repair Report] ❌ No payload buffer or base64 for after image:', {
              hasPayload: !!payload,
              hasBuffer: !!payload?.buffer,
              hasBase64: !!payload?.base64,
              error: payload?.error,
              localPath: payload?.localPath,
            });
          }
        } catch (error) {
          console.error(`[Repair Report] ❌ Error loading after image: ${error.message}`);
          console.error('[Repair Report] Error stack:', error.stack);
          console.error('[Repair Report] Error details:', {
            imageUrl,
            fileName,
            relativePath,
            errorName: error.name,
            errorCode: error.code,
          });
        }
      } else {
        console.error('[Repair Report] ❌ No relative path for after image:', {
          imageUrl,
          fileName,
          firstAfterImage: firstAfterImage,
        });
      }
    } else {
      console.log('[Repair Report] ⚠️ No after images found');
    }
    
    // Template-ийн JSON бүтцэд тохируулан repair object бэлтгэх
    // Зургийн alt text бэлтгэх (template дээр ашиглах)
    const beforeImageAltText = before_image ? `${sectionName}-${fieldName} (Өмнөх)` : '';
    const afterImageAltText = after_image ? `${sectionName}-${fieldName} (Дараах)` : '';
    
    repairData = {
      section: sectionName,
      field: fieldName,
      section_field: `${sectionName} - ${fieldName}`, // Section-field нэрийг нэгтгэх
      before_text: before_text,
      after_text: after_text,
      before_image: before_image, // DOCX-д ашиглах (зураг object)
      after_image: after_image,   // DOCX-д ашиглах (зураг object)
      beforeImageAltText: beforeImageAltText, // Template дээр alt text-д ашиглах
      afterImageAltText: afterImageAltText,   // Template дээр alt text-д ашиглах
      beforeImagePreview: beforeImagePreview, // Preview-д ашиглах
      afterImagePreview: afterImagePreview,   // Preview-д ашиглах
    };
  }

  // 6. Template data бүтэц
  // Template-д {{d.repairRows}} ашиглана
  const reportData = {
    // Ерөнхий мэдээлэл
    inspection: {
      id: inspection.id.toString(),
      title: inspection.title,
      type: inspection.type,
      status: inspection.status,
    },
    device: inspection.device ? {
      id: inspection.device.id.toString(),
      serialNumber: inspection.device.serialNumber,
      assetTag: inspection.device.assetTag,
      model: inspection.device.model ? {
        manufacturer: inspection.device.model.manufacturer,
        model: inspection.device.model.model,
      } : null,
    } : null,
    site: inspection.site ? {
      id: inspection.site.id.toString(),
      name: inspection.site.name,
      organization: inspection.site.organization ? {
        name: inspection.site.organization.name,
      } : null,
    } : null,
    contract: inspection.contract ? {
      id: inspection.contract.id.toString(),
      contractName: inspection.contract.contractName,
      contractNumber: inspection.contract.contractNumber,
      organization: inspection.contract.organization ? {
        name: inspection.contract.organization.name,
      } : null,
    } : null,
    
    // Засварын статистик
    summary: {
      totalRepairs: repairs.length,
      completedRepairs: repairs.filter(r => r.repairStatus === 'COMPLETED').length,
      verifiedRepairs: repairs.filter(r => r.repairStatus === 'VERIFIED').length,
      pendingRepairs: repairs.filter(r => r.repairStatus === 'PENDING').length,
    },
    
    // Template data (d object)
    // Template-ийн JSON бүтцэд тохируулан placeholder-ууд бэлтгэх
    d: {
      contractor: {
        company: inspection.contract?.organization?.name || inspection.site?.organization?.name || '',
        contract_no: inspection.contract?.contractNumber || '',
        contact: inspection.contract?.organization?.contactPhone || inspection.contract?.organization?.contactEmail || '',
      },
      metadata: {
        // Date формат: YYYY-MM-DD
        date: new Date().toISOString().split('T')[0],
        inspector: metadata.inspector || latestAnswer?.user?.fullName || '',
        location: metadata.location || inspection.site?.name || '',
        scale_id_serial_no: metadata.scale_id_serial_no || inspection.device?.serialNumber || '',
        model: metadata.model || (inspection.device?.model ? `${inspection.device.model.manufacturer} ${inspection.device.model.model}` : ''),
      },
      repair: repairData, // Single repair object (array биш)
      signatures: {
        inspector: signatureInspector, // Гарын үсэг (preview-д ашиглах)
      },
    },
    
    // JSON мэдээлэл (template-д JSON байдлаар харуулах)
    jsonData: JSON.stringify({
      inspection: {
        id: inspection.id.toString(),
        title: inspection.title,
        type: inspection.type,
        status: inspection.status,
      },
      device: inspection.device ? {
        serialNumber: inspection.device.serialNumber,
        assetTag: inspection.device.assetTag,
        model: inspection.device.model ? {
          manufacturer: inspection.device.model.manufacturer,
          model: inspection.device.model.model,
        } : null,
      } : null,
      repairs: repairs.map(r => ({
        id: r.id.toString(),
        section: r.section,
        fieldId: r.fieldId,
        questionText: r.questionText,
        originalStatus: r.originalStatus,
        repairStatus: r.repairStatus,
        repairDescription: r.repairDescription,
        repairedAt: r.repairedAt,
        verifiedAt: r.verifiedAt,
      })),
      summary: {
        totalRepairs: repairs.length,
        completedRepairs: repairs.filter(r => r.repairStatus === 'COMPLETED').length,
        verifiedRepairs: repairs.filter(r => r.repairStatus === 'VERIFIED').length,
        pendingRepairs: repairs.filter(r => r.repairStatus === 'PENDING').length,
      },
    }, null, 2),
    
    // Тайлангийн огноо
    reportDate: new Date().toLocaleDateString('mn-MN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  };

  return reportData;
}

module.exports = {
  buildRepairReportData,
  getSectionName,
};

