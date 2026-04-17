const express = require('express');
const path = require('path');
const fs = require('fs');
const { TemplateHandler, MimeType } = require('easy-template-x');
const sharp = require('sharp');
const mammoth = require('mammoth');
// Puppeteer is only needed for PDF generation - load it lazily
// const puppeteer = require('puppeteer');

// CRITICAL: Convert MIME types to lowercase format strings that easy-template-x expects
// Format must be: 'png', 'jpg' (not 'jpeg'), 'gif', 'bmp' - lowercase strings, not enums
// easy-template-x expects 'jpg' not 'jpeg' for JPEG images
function getImageFormatString(mimeType) {
  const normalized = (mimeType || 'image/jpeg').toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'; // easy-template-x expects 'jpg' not 'jpeg'
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  return 'jpg'; // Default - must be 'jpg' not 'jpeg'
}

const MIME_TYPE_MAP = {
  'image/png': MimeType.Png,
  'image/jpeg': MimeType.Jpeg,
  'image/jpg': MimeType.Jpeg,
  'image/gif': MimeType.Gif,
  'image/bmp': MimeType.Bmp,
  'image/svg+xml': MimeType.Svg,
};
const SUPPORTED_IMAGE_MIME_TYPES = new Set(Object.keys(MIME_TYPE_MAP));

// Зурагийн хэмжээ тохиргоо (environment variable эсвэл default утга)
const IMAGE_WIDTH = parseInt(process.env.IMAGE_WIDTH) || 300; // Default: 300px (чанартай хэмжээ)
const IMAGE_HEIGHT = parseInt(process.env.IMAGE_HEIGHT) || 400; // Default: 400px (чанартай хэмжээ)
// DOCX/PDF-д суулгах зургийн урт талын дээд пиксел (олон зурагтай үед mail/PDF 500/timeout-г зайлсхийх)
// 0 эсвэл сөрөг = downscale хийхгүй (хуучин зан төлөв)
const DOCX_EMBED_MAX_EDGE = parseInt(process.env.INSPECTION_DOCX_IMAGE_MAX_EDGE || '1280', 10);

// 1×1 цагаан PNG – хавсралтын "өмнө/дараа" зураг байхгүй үед template placeholder-ийг орлуулах
const BLANK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' + 'AABjkB6QAAAABJRU5ErkJggg==';
function getBlankImageDocx() {
  return {
    _type: 'image',
    source: Buffer.from(BLANK_PNG_B64, 'base64'),
    format: MimeType.Png,
    width: 1,
    height: 1,
  };
}

// Section нэр монгол хэл дээр (хавсралтын хүснэгт дээр {{d.repair.section}}-д)
const SECTION_NAMES_MN = {
  exterior: 'Гадаад',
  indicator: 'Индикатор',
  jbox: 'J-Box',
  sensor: 'Мэдрэгч',
  foundation: 'Суурь',
  cleanliness: 'Цэвэрлэгээ',
};

// Зурагийн чанарын тохиргоо
const JPEG_QUALITY = parseInt(process.env.JPEG_QUALITY) || 95; // JPEG чанар (0-100, default: 95 - илүү өндөр чанар)
const PNG_COMPRESSION = parseInt(process.env.PNG_COMPRESSION) || 6; // PNG compression (0-9, default: 6 - чанартай compression)

async function convertUnsupportedImage(buffer, originalMimeType) {
  try {
    console.log(
      '[documents] Converting unsupported image type:',
      originalMimeType
    );
    // EXIF orientation-ийг засах, PNG руу хөрвүүлэх
    const convertedBuffer = await sharp(buffer)
      .autoOrient() // EXIF orientation-ийг автоматаар засах
      .png()
      .toBuffer();
    return {
      buffer: convertedBuffer,
      mimeType: 'image/png',
      format: 'png', // CRITICAL: lowercase string, not enum
    };
  } catch (error) {
    console.error(
      '[documents] ❌ Failed to convert image to PNG:',
      originalMimeType,
      error.message
    );
    return null;
  }
}

async function createImageContent(imageData) {
  const hasBuffer =
    imageData && imageData.buffer && Buffer.isBuffer(imageData.buffer);
  const hasBase64 =
    imageData &&
    typeof imageData.base64 === 'string' &&
    imageData.base64.length > 0;

  if (!imageData || typeof imageData !== 'object' || !imageData.mimeType) {
    console.warn('[documents] ❌ Invalid imageData:', {
      imageData: imageData ? 'exists' : 'null',
      hasBuffer,
      hasBase64,
      hasMimeType: !!(imageData && imageData.mimeType),
    });
    return null;
  }

  let normalizedType = imageData.mimeType.toLowerCase();
  // CRITICAL: Use lowercase format string, not enum value
  let format = getImageFormatString(imageData.mimeType);

  // Validate format is a lowercase string
  if (!format || typeof format !== 'string' || !['png', 'jpg', 'gif', 'bmp'].includes(format)) {
    console.error('[documents] ❌ FORMAT ERROR:', {
      format,
      formatType: typeof format,
      expectedType: 'lowercase string (png, jpeg, gif, bmp)',
      actualType: typeof format,
      normalizedType,
    });
  }

  try {
    let source;

    if (hasBuffer) {
      // Prefer binary buffer for highest quality, no extra encoding/decoding.
      source = imageData.buffer;
      console.log('[documents] Using binary buffer as image source', {
        bufferLength: source.length,
      });
    } else if (hasBase64) {
      // Validate base64 string
      if (typeof imageData.base64 !== 'string') {
        console.error(
          '[documents] ❌ Base64 is not a string:',
          typeof imageData.base64
        );
        return null;
      }

      if (imageData.base64.length === 0) {
        console.error('[documents] ❌ Base64 string is empty');
        return null;
      }

      // Check if base64 string looks valid (simple character set validation)
      const base64Pattern = /^[A-Za-z0-9+/=]+$/;
      if (!base64Pattern.test(imageData.base64)) {
        console.error(
          '[documents] ❌ Base64 string contains invalid characters'
        );
        console.error(
          '[documents] First 100 chars:',
          imageData.base64.substring(0, 100)
        );
        return null;
      }

      console.log('[documents] Converting base64 to Buffer...', {
        base64Length: imageData.base64.length,
        estimatedBufferSize: Math.ceil((imageData.base64.length * 3) / 4),
      });

      source = Buffer.from(imageData.base64, 'base64');
    } else {
      console.error(
        '[documents] ❌ No valid image data provided (neither buffer nor base64)'
      );
      return null;
    }

    // CRITICAL: Convert JPEG to PNG because easy-template-x doesn't support 'jpg' or 'jpeg' format
    if (format === 'jpg' || format === 'jpeg') {
      console.log('[documents] Converting JPEG to PNG for easy-template-x compatibility');
      source = await sharp(source)
        .autoOrient()
        .png()
        .toBuffer();
      format = 'png';
    } else if (!format || !['png', 'gif', 'bmp'].includes(format)) {
      // Convert unsupported format to PNG
      const converted = await convertUnsupportedImage(
        source,
        normalizedType || 'unknown'
      );
      if (!converted) {
        return null;
      }
      source = converted.buffer;
      // Ensure format is lowercase string
      format = getImageFormatString(converted.mimeType);
      normalizedType = converted.mimeType;
    }
    
    if (!source || source.length === 0) {
      console.error('[documents] ❌ Buffer is empty after conversion');
      return null;
    }

    // Зургийн харагдах хэмжээ: imageData.displayWidth/displayHeight өгөгдсөн бол тэр, үгүй бол IMAGE_WIDTH/HEIGHT + харьцаа
    const customWidth = imageData.displayWidth != null && Number.isFinite(imageData.displayWidth) ? Number(imageData.displayWidth) : null;
    const customHeight = imageData.displayHeight != null && Number.isFinite(imageData.displayHeight) ? Number(imageData.displayHeight) : null;
    let finalWidth = customWidth != null ? customWidth : IMAGE_WIDTH;
    let finalHeight = customHeight != null ? customHeight : IMAGE_HEIGHT;

    try {
      const sharpImage = sharp(source);
      const metadata = await sharpImage.metadata();

      console.log('[documents] Image metadata:', {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        format: metadata.format,
      });

      const originalWidth = metadata.width || IMAGE_WIDTH;
      const originalHeight = metadata.height || IMAGE_HEIGHT;
      const aspectRatio = originalWidth / originalHeight;

      if (customWidth == null && customHeight == null) {
        if (aspectRatio > IMAGE_WIDTH / IMAGE_HEIGHT) {
          finalWidth = IMAGE_WIDTH;
          finalHeight = Math.round(IMAGE_WIDTH / aspectRatio);
        } else {
          finalHeight = IMAGE_HEIGHT;
          finalWidth = Math.round(IMAGE_HEIGHT * aspectRatio);
        }
      }

      console.log('[documents] Image resize calculation (logical size only, buffer not downscaled):', {
        original: `${originalWidth}x${originalHeight}`,
        aspectRatio: aspectRatio.toFixed(4),
        target: customWidth != null ? `${customWidth}x${customHeight}` : `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
        final: `${finalWidth}x${finalHeight}`,
        aspectRatioPreserved: (finalWidth / finalHeight).toFixed(4)
      });
      
      // EXIF orientation байвал засах (buffer-ийн хэмжээг өөрчлөхгүй, зөвхөн чиглэлийг засна)
      if (metadata.orientation && metadata.orientation !== 1) {
        console.log('[documents] Fixing image orientation (no downscale):', {
          originalOrientation: metadata.orientation,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
        });
        
        // autoOrient() нь EXIF orientation-ийг уншиж, зурагийг зөв байрлуулна.
        // Downscale хийхгүй, анхны resolution-ийг хадгална
        source = await sharpImage
          .autoOrient()
          .toBuffer();
        
        console.log('[documents] ✅ Image orientation fixed (no resize)');
      } else {
        // Orientation зөв бол buffer-ийг өөрчлөх шаардлагагүй (анхны resolution-ийг хадгална)
        console.log('[documents] Keeping original image resolution (no resize)');
        // Хэрэв шаардлагатай бол энд нэмэлт боловсруулалт хийж болно, одоогоор source хэвээр үлээнэ
      }
    } catch (orientationError) {
      console.warn('[documents] ⚠️ Could not process image with sharp:', orientationError.message);
      // Алдаа гарвал анхны buffer-ийг ашиглах
    }

    // Том зургийг бодитоор жижигрүүлэх (логик 300×400 хэмжээ хэвээр; embedded buffer л багасна)
    if (DOCX_EMBED_MAX_EDGE > 0 && Buffer.isBuffer(source) && source.length > 0) {
      try {
        const sm = await sharp(source).metadata();
        const sw = sm.width || 0;
        const sh = sm.height || 0;
        if (sw > DOCX_EMBED_MAX_EDGE || sh > DOCX_EMBED_MAX_EDGE) {
          const beforeBytes = source.length;
          console.log('[documents] Downscaling embedded image for DOCX/PDF (multi-image safety):', {
            pixels: `${sw}x${sh}`,
            maxEdge: DOCX_EMBED_MAX_EDGE,
            beforeBytes,
          });
          source = await sharp(source)
            .autoOrient()
            .resize(DOCX_EMBED_MAX_EDGE, DOCX_EMBED_MAX_EDGE, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .png({ compressionLevel: Math.min(9, Math.max(1, PNG_COMPRESSION + 2)) })
            .toBuffer();
          format = 'png';
          console.log('[documents] ✅ Downscaled:', {
            afterBytes: source.length,
            ratio: `${Math.round((100 * source.length) / Math.max(1, beforeBytes))}%`,
          });
        }
      } catch (dsErr) {
        console.warn('[documents] ⚠️ Image downscale skipped:', dsErr.message);
      }
    }

    console.log('[documents] ✅ Buffer created successfully:', {
      bufferLength: source.length,
      format,
      formatType: typeof format,
      formatValue: format,
      isValidFormat: ['png', 'jpg', 'gif', 'bmp'].includes(format),
      width: finalWidth,
      height: finalHeight,
      isBuffer: Buffer.isBuffer(source),
      sourceType: typeof source,
    });

    // CRITICAL: easy-template-x expects MimeType enum, not string format
    // Convert format string to MimeType enum
    let mimeTypeEnum;
    if (format === 'png') {
      mimeTypeEnum = MimeType.Png;
    } else if (format === 'jpg' || format === 'jpeg') {
      mimeTypeEnum = MimeType.Jpeg;
    } else if (format === 'gif') {
      mimeTypeEnum = MimeType.Gif;
    } else if (format === 'bmp') {
      mimeTypeEnum = MimeType.Bmp;
    } else {
      mimeTypeEnum = MimeType.Png; // Default to PNG
    }

    return {
      _type: 'image',
      source, // Buffer object - easy-template-x will use this directly
      format: mimeTypeEnum, // CRITICAL: Use MimeType enum, not string
      width: finalWidth, // Section зурагуудын өргөн (configurable, orientation зассны дараа)
      height: finalHeight, // Section зурагуудын өндөр (configurable, orientation зассны дараа)
    };
  } catch (error) {
    console.error(
      '[documents] ❌ Failed to build image:',
      error.message,
      error.stack
    );
    return null;
  }
}

async function createSignatureImageContent(signature) {
  if (
    !signature ||
    typeof signature !== 'object' ||
    !signature.data ||
    !signature.mimeType
  ) {
    return null;
  }

  try {
    let source = Buffer.from(signature.data, 'base64');
    if (!source.length) {
      return null;
    }

    // Зургийн анхны хэмжээг уншиж, харьцааг хадгалахын зэрэгцээ resize хийх
    const sharpImage = sharp(source);
    const metadata = await sharpImage.metadata();
    const originalWidth = metadata.width || 180;
    const originalHeight = metadata.height || 80;
    const aspectRatio = originalWidth / originalHeight;
    
    // Гарын үсгийн target хэмжээ: 180x80
    const targetWidth = 180;
    const targetHeight = 80;
    
    // Харьцааг хадгалахын зэрэгцээ resize хийх
    let finalWidth, finalHeight;
    if (aspectRatio > targetWidth / targetHeight) {
      // Зураг илүү өргөн байвал, өргөнийг targetWidth-д тохируулна
      finalWidth = targetWidth;
      finalHeight = Math.round(targetWidth / aspectRatio);
    } else {
      // Зураг илүү өндөр байвал, өндрийг targetHeight-д тохируулна
      finalHeight = targetHeight;
      finalWidth = Math.round(targetHeight * aspectRatio);
    }
    
    console.log('[documents] Signature image resize calculation:', {
      original: `${originalWidth}x${originalHeight}`,
      aspectRatio: aspectRatio.toFixed(4),
      target: `${targetWidth}x${targetHeight}`,
      final: `${finalWidth}x${finalHeight}`,
      aspectRatioPreserved: (finalWidth / finalHeight).toFixed(4)
    });

    // CRITICAL: Convert JPEG to PNG and resize with aspect ratio preserved
    const mimeType = signature.mimeType.toLowerCase();
    let format = 'png';
    
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      // Convert JPEG to PNG and resize
      source = await sharpImage
        .autoOrient()
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png()
        .toBuffer();
      format = 'png';
    } else if (mimeType === 'image/png') {
      // Resize PNG
      source = await sharpImage
        .autoOrient()
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png()
        .toBuffer();
      format = 'png';
    } else if (mimeType === 'image/gif') {
      // Resize GIF
      source = await sharpImage
        .autoOrient()
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .gif()
        .toBuffer();
      format = 'gif';
    } else if (mimeType === 'image/bmp') {
      // Resize BMP
      source = await sharpImage
        .autoOrient()
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png() // Convert BMP to PNG for better compatibility
        .toBuffer();
      format = 'png';
    } else {
      // Convert unsupported format to PNG and resize
      source = await sharpImage
        .autoOrient()
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png()
        .toBuffer();
      format = 'png';
    }

    // CRITICAL: easy-template-x expects MimeType enum, not string format
    let mimeTypeEnum = MimeType.Png;
    if (format === 'png') {
      mimeTypeEnum = MimeType.Png;
    } else if (format === 'gif') {
      mimeTypeEnum = MimeType.Gif;
    } else if (format === 'bmp') {
      mimeTypeEnum = MimeType.Bmp;
    }

    console.log('[documents] Created signature image:', {
      originalMimeType: signature.mimeType,
      format: mimeTypeEnum,
      sourceLength: source.length,
      width: finalWidth,
      height: finalHeight,
    });

    return {
      _type: 'image',
      source, // Buffer object - easy-template-x will use this directly
      format: mimeTypeEnum, // CRITICAL: Use MimeType enum, not string
      width: finalWidth, // Гарын үсгийн өргөн (харьцааг хадгалах)
      height: finalHeight, // Гарын үсгийн өндөр (харьцааг хадгалах)
    };
  } catch (error) {
    console.warn(
      '[documents] Failed to build signature image:',
      error.message
    );
    return null;
  }
}

/**
 * Merge document.xml.rels files - хадгалсан logo холбоосууд болон шинэ хавсралтын зургийн холбоосуудыг нэгтгэх
 * @param {string} originalRels - Шаблон дахь анхны document.xml.rels агуулга
 * @param {string} processedRels - Боловсруулсан document.xml.rels агуулга
 * @returns {string} Нэгтгэсэн document.xml.rels агуулга
 */
function mergeDocumentRels(originalRels, processedRels) {
  try {
    // Extract all Relationship elements from original (logo холбоосууд)
    // Support both self-closing tags (<Relationship ... />) and closing tags (<Relationship>...</Relationship>)
    const originalRelationships = [];
    // Match self-closing tags
    const selfClosingRegex = /<Relationship[^>]*\/>/g;
    let match;
    
    while ((match = selfClosingRegex.exec(originalRels)) !== null) {
      originalRelationships.push(match[0]);
    }
    
    // Match closing tags (if any)
    const closingTagRegex = /<Relationship[^>]*>[\s\S]*?<\/Relationship>/g;
    selfClosingRegex.lastIndex = 0; // Reset
    while ((match = closingTagRegex.exec(originalRels)) !== null) {
      // Only add if not already captured as self-closing
      if (!originalRelationships.some(rel => rel.includes(match[0].substring(0, 50)))) {
        originalRelationships.push(match[0]);
      }
    }
    
    // Extract all Relationship elements from processed (шинэ хавсралтын зургийн холбоосууд)
    const processedRelationships = [];
    selfClosingRegex.lastIndex = 0; // Reset regex
    while ((match = selfClosingRegex.exec(processedRels)) !== null) {
      processedRelationships.push(match[0]);
    }
    
    // Also match closing tags in processed
    closingTagRegex.lastIndex = 0;
    while ((match = closingTagRegex.exec(processedRels)) !== null) {
      if (!processedRelationships.some(rel => rel.includes(match[0].substring(0, 50)))) {
        processedRelationships.push(match[0]);
      }
    }
    
    // Extract Id attributes to check for duplicates
    const getIdFromRelationship = (rel) => {
      const idMatch = rel.match(/Id="([^"]+)"/);
      return idMatch ? idMatch[1] : null;
    };
    
    // Extract Target to identify media files (logo images)
    const getTargetFromRelationship = (rel) => {
      const targetMatch = rel.match(/Target="([^"]+)"/);
      return targetMatch ? targetMatch[1] : null;
    };
    // OOXML-д Target нь part-тай харьцуулахад relative path; эхний "/" байвал замыг буруу болгоно
    const normalizeRelTarget = (rel) => {
      return rel.replace(/Target="\/+([^"]+)"/, (_, p1) => `Target="${p1.replace(/^\/+/, '')}"`);
    };

    const processedIds = new Set(processedRelationships.map(getIdFromRelationship).filter(Boolean));
    const processedTargets = new Set(processedRelationships.map(getTargetFromRelationship).filter(Boolean));
    
    // Combine: processed relationships + original relationships that don't exist in processed
    const mergedRelationships = [...processedRelationships];
    
    // CRITICAL: Add ALL original media/image relationships to ensure logo displays
    // Strategy: Add ALL media relationships from template, even if they might exist in processed
    // This ensures logo relationships are never lost
    let addedCount = 0;
    let skippedCount = 0;
    
    for (const origRel of originalRelationships) {
      const origId = getIdFromRelationship(origRel);
      const origTarget = getTargetFromRelationship(origRel);
      
      // Check if it's a media/image relationship
      const isMediaFile = origTarget && origTarget.includes('media/');
      const isImageType = origRel.includes('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image') ||
                         origRel.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
      
      if (isMediaFile || isImageType) {
        // Check if this exact Target already exists in merged relationships
        const targetExists = mergedRelationships.some(rel => {
          const relTarget = getTargetFromRelationship(rel);
          return relTarget === origTarget && origTarget !== null;
        });
        
        // Check if this Id already exists
        const idExists = origId && processedIds.has(origId);
        
        if (!targetExists && !idExists) {
          mergedRelationships.push(normalizeRelTarget(origRel));
          addedCount++;
          console.log(`[documents] ✅ Merged logo/media relationship: ${origId} -> ${origTarget || 'unknown'}`);
        } else if (!targetExists && idExists) {
          mergedRelationships.push(normalizeRelTarget(origRel));
          addedCount++;
          console.log(`[documents] ⚠️ Merged logo/media relationship (Id conflict, but Target unique): ${origId} -> ${origTarget || 'unknown'}`);
        } else {
          skippedCount++;
          console.log(`[documents] ⏭️ Skipped duplicate relationship: ${origId} -> ${origTarget || 'unknown'}`);
        }
      } else {
        // Log other relationships for debugging
        if (origId && !processedIds.has(origId)) {
          console.log(`[documents] ⏭️ Skipped non-media relationship: ${origId} -> ${origTarget || 'unknown'}`);
        }
      }
    }
    
    console.log(`[documents] 🔍 Added ${addedCount} logo/media relationships from template (skipped ${skippedCount} duplicates)`);
    
    // Reconstruct the XML structure - preserve original formatting
    // Find the opening tag with all attributes (including xmlns)
    const openingMatch = processedRels.match(/<Relationships[^>]*>/);
    const closingTag = '</Relationships>';
    
    if (!openingMatch) {
      console.warn('[documents] ⚠️ Could not find Relationships opening tag, using original');
      return originalRels;
    }
    
    // Preserve original indentation style from processedRels
    const indentMatch = processedRels.match(/(\s*)<Relationship/);
    const indent = indentMatch ? indentMatch[1] : '  ';
    
    const mergedXml = openingMatch[0] + '\n' + 
                      mergedRelationships.map(rel => indent + rel).join('\n') + '\n' + 
                      closingTag;
    
    console.log(`[documents] ✅ Merged document.xml.rels: ${processedRelationships.length} processed + ${mergedRelationships.length - processedRelationships.length} original = ${mergedRelationships.length} total`);
    
    return mergedXml;
  } catch (error) {
    console.warn('[documents] ⚠️ Failed to merge document.xml.rels:', error.message);
    console.warn('[documents] Error stack:', error.stack);
    // Fallback: try to preserve logo by merging original into processed
    try {
      // Last resort: append ALL original media/image relationships to processed
      // Match both self-closing and closing tags
      const originalMediaRels = [];
      const mediaSelfClosing = originalRels.match(/<Relationship[^>]*media\/[^>]*\/>/g) || [];
      const mediaClosing = originalRels.match(/<Relationship[^>]*media\/[^>]*>[\s\S]*?<\/Relationship>/g) || [];
      const imageSelfClosing = originalRels.match(/<Relationship[^>]*image[^>]*\/>/g) || [];
      const imageClosing = originalRels.match(/<Relationship[^>]*image[^>]*>[\s\S]*?<\/Relationship>/g) || [];
      
      originalMediaRels.push(...mediaSelfClosing);
      originalMediaRels.push(...mediaClosing);
      originalMediaRels.push(...imageSelfClosing);
      originalMediaRels.push(...imageClosing);
      
      // Remove duplicates
      const uniqueMediaRels = [...new Set(originalMediaRels)];
      
      const processedOpening = processedRels.match(/<Relationships[^>]*>/);
      const processedClosing = '</Relationships>';
      const processedRelsContent = processedRels.replace(/<\/Relationships>[\s\S]*$/, '');
      
      if (uniqueMediaRels.length > 0 && processedOpening) {
        const indent = processedRels.match(/(\s*)<Relationship/) ? processedRels.match(/(\s*)<Relationship/)[1] : '  ';
        const fallbackMerged = processedRelsContent + 
                              uniqueMediaRels.map(rel => indent + rel).join('\n') + '\n' + 
                              processedClosing;
        console.log(`[documents] ⚠️ Using fallback merge strategy - added ${uniqueMediaRels.length} media/image relationships`);
        return fallbackMerged;
      }
    } catch (fallbackError) {
      console.warn('[documents] ⚠️ Fallback merge also failed:', fallbackError.message);
    }
    
    // Final fallback: return processed version (new attachments) instead of original (logo)
    return processedRels;
  }
}

/**
 * Хоосон placeholder зураг үүсгэх (grid layout-д хоосон байрлуулахын тулд)
 * 1x1 transparent PNG ашиглаж, хэмжээг бодит зурагуудтай ижил болгоно
 */
function createEmptyPlaceholderImage(width = IMAGE_WIDTH, height = IMAGE_HEIGHT) {
  // 1x1 transparent PNG (base64)
  // Энэ нь хамгийн жижиг transparent PNG байна
  const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  
  try {
    const source = Buffer.from(transparentPngBase64, 'base64');
    
    return {
      _type: 'image',
      source,
      format: 'png', // CRITICAL: lowercase string, not enum
      width,
      height,
      isEmpty: true, // Хоосон placeholder гэдгийг тэмдэглэх
    };
  } catch (error) {
    console.warn('[documents] Failed to create empty placeholder image:', error.message);
    return null;
  }
}

/**
 * Post-processing: Easy-template-x боловсруулсны дараа зурагуудыг grid layout-д байрлуулах
 * Зурагууд зөвхөн зүүн талын баганад доошоо цувран байгаа тул, тэдгээрийг 3 баганатай grid layout-д байрлуулах
 */
async function rearrangeImagesInGridLayout(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    const xml = await zip.file('word/document.xml').async('string');
    
    console.log('[documents] Post-processing: Rearranging images in grid layout...');
    
    // Хүснэгт олох (3 баганатай хүснэгт)
    // Loop placeholder-ийн дотор байрлах хүснэгтийг олох
    // Зурагууд зөвхөн эхний нүд дотор байрлаж байгаа тул, тэдгээрийг grid layout-д байрлуулах
    
    // Энэ нь маш төвөгтэй байж магадгүй, учир нь:
    // 1. Хүснэгтийн бүтцийг ойлгох хэрэгтэй
    // 2. Зурагуудыг олох хэрэгтэй
    // 3. Зурагуудыг хүснэгтийн нүд бүрт байрлуулах хэрэгтэй
    
    // Одоогоор энэ функц нь placeholder байна
    // Ирээдүйд хэрэгжүүлэх боломжтой
    
    console.log('[documents] Post-processing: Grid layout rearrangement is not yet implemented');
    console.log('[documents] Images are currently placed in the first column only');
    
    return docxBuffer; // Одоогоор өөрчлөлтгүй буцаана
  } catch (error) {
    console.warn('[documents] Post-processing error:', error.message);
    return docxBuffer; // Алдаа гарвал анхны buffer-ийг буцаана
  }
}

/**
 * Paragraph XML дотроос харагдах текст агуулсан эсэхийг шалгах туслах функц
 * - Table, drawing, field, page-break гэх мэт чухал элемент агуулсан paragraph-уудыг үлдээдэг
 * - Зөвхөн whitespace/formatting (style) л агуулсан paragraph-уудыг "хоосон" гэж үзнэ
 *
 * @param {string} paragraphXml
 * @returns {boolean} true бол paragraph нь хоосон, устгаж болно
 */
function isEmptyWordParagraph(paragraphXml) {
  if (!paragraphXml || typeof paragraphXml !== 'string') {
    return false;
  }

  // 1. Хүснэгт, зураг, field, structured document гэх мэт чухал элементүүд байвал устгахгүй
  if (/<w:tbl\b|<w:drawing\b|<w:pict\b|<w:sdt\b|<w:fldSimple\b|<w:hyperlink\b/i.test(paragraphXml)) {
    return false;
  }

  // 2. Page/line break, section break агуулсан paragraph-уудыг бас хадгална
  if (/<w:br\b|<w:cr\b|<w:sectPr\b|<w:pageBreak\b/i.test(paragraphXml)) {
    return false;
  }

  // 3. Loop tag-ууд агуулсан paragraph-уудыг шалгах (эхлээд шалгах)
  // {{#d.inspectionItems}} болон {{/d.inspectionItems}} tag-ууд зөвхөн эдгээр tag-ууд л байвал устгах
  if (/\{\{#d\.inspectionItems\}\}|\{\{\/d\.inspectionItems\}\}/i.test(paragraphXml)) {
    // Paragraph-ийн бүх текст агуулгыг авна
    const textMatches = paragraphXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
    if (textMatches) {
      let allText = '';
      textMatches.forEach(match => {
        // <w:t>...</w:t> tag-аас текст авах
        const textContent = match.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
        allText += textContent;
      });
      
      // Whitespace-ийг цэвэрлэх
      allText = allText
        .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
        .replace(/\s+/g, '')
        .trim();
      
      // Зөвхөн loop tag-ууд л байвал хоосон гэж үзнэ
      // Эсвэл loop tag-ууд + whitespace л байвал хоосон гэж үзнэ
      if (/^\{\{#d\.inspectionItems\}\}$|^\{\{\/d\.inspectionItems\}\}$/i.test(allText) || 
          /^\{\{#d\.inspectionItems\}\s*\}$|^\{\{\/d\.inspectionItems\}\s*\}$/i.test(allText)) {
        console.log(`[documents] isEmptyWordParagraph: Found loop tag only paragraph, removing: "${allText}"`);
        return true;
      }
    }
  }

  // 4. Paragraph properties хэсгийг авч хаях
  let content = paragraphXml.replace(/<w:pPr[\s\S]*?<\/w:pPr>/gi, '');

  // 5. Бүх XML tag-уудыг устгах
  content = content.replace(/<[^>]+>/g, '');

  // 6. NBSP болон түүнтэй төстэй whitespace entity-үүдийг энгийн space болгож, дараа нь цэвэрлэх
  content = content
    .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();

  // Ямар нэг харагдах текст байхгүй бол paragraph-ийг хоосон гэж үзнэ
  return content.length === 0;
}

/**
 * DOCX файлд зэрэгцээ байгаа хүснэгтүүдийг merge хийх
 * Хоёр хүснэгтийн хоорондох контент зөвхөн whitespace/empty paragraph байвал merge хийх
 * @param {Buffer} docxBuffer - DOCX файлын buffer
 * @returns {Promise<Buffer>} Хүснэгтүүд merge хийгдсэн DOCX buffer
 */
async function mergeAdjacentTables(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    
    // word/document.xml файлыг унших
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) {
      console.warn('[documents] mergeAdjacentTables: word/document.xml not found');
      return docxBuffer;
    }
    
    let xml = await xmlFile.async('string');
    
    console.log('[documents] mergeAdjacentTables: Merging adjacent tables...');

    // Find all tables: <w:tbl>...</w:tbl>
    const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi;
    const tables = [];
    let match;
    
    while ((match = tableRegex.exec(xml)) !== null) {
      tables.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0]
      });
    }

    if (tables.length < 2) {
      return docxBuffer;
    }

    // Process tables: find all consecutive tables that can be merged
    // Use a while loop to keep merging until no more merges are possible
    let mergedCount = 0;
    let newXml = xml;
    let hasMoreMerges = true;
    let iteration = 0;
    const maxIterations = 100; // Safety limit (increased from 10 to handle many fields)
    
    while (hasMoreMerges && iteration < maxIterations) {
      iteration++;
      hasMoreMerges = false;
      
      // Find all tables in current XML
      const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi;
      const currentTables = [];
      let match;
      
      while ((match = tableRegex.exec(newXml)) !== null) {
        currentTables.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0]
        });
      }
      
      if (currentTables.length < 2) {
        break; // No more tables to merge
      }
      
      // Process from end to start to avoid index shifting
      // CRITICAL: Process ALL consecutive tables, not just pairs
      // Find all consecutive tables that can be merged together
      for (let i = currentTables.length - 1; i > 0; i--) {
        const currentTable = currentTables[i];
        const previousTable = currentTables[i - 1];
        
        // Check content between tables
        const betweenStart = previousTable.end;
        const betweenEnd = currentTable.start;
        const betweenContent = newXml.substring(betweenStart, betweenEnd);
        
        // Remove loop tags (template tags) before checking content
        // These tags should be ignored when determining if tables can be merged
        const loopTagPatterns = [
          /\{\{#inspections\}\}/gi,
          /\{\{\/inspections\}\}/gi,
          /\{\{#d\.inspectionItems\}\}/gi,
          /\{\{\/d\.inspectionItems\}\}/gi,
          /\{\{#d\.attachments\}\}/gi,
          /\{\{\/d\.attachments\}\}/gi,
        ];

        // Must be before isInspectionItemsTable — avoids TDZ (const is not hoisted)
        const isHeaderTable = (tableContent) => {
          const rows = tableContent.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
          if (rows.length === 0) return false;
          for (let rowIdx = 0; rowIdx < Math.min(rows.length, 2); rowIdx++) {
            const rowText = rows[rowIdx].match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
            if (!rowText) continue;
            let textContent = '';
            rowText.forEach(t => {
              textContent += t.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
            });
            textContent = textContent.replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ').replace(/\s+/g, ' ').trim();
            const columnHeaders = ['үзлэгийн эд анги', 'төлөв', 'хавсралт'];
            const matchCount = columnHeaders.filter(keyword =>
              textContent.toLowerCase().includes(keyword.toLowerCase())
            ).length;
            if (matchCount >= 2) return true;
          }
          return false;
        };
        
        // Helper: identify inspection items tables (header or data)
        const isInspectionItemsTable = (tableContent) => {
          const hasInspectionPlaceholders =
            /\{\{#d\.inspectionItems\}\}|\{\{\/d\.inspectionItems\}\}|\{\{fieldName\}\}|\{\{isNormal\}\}|\{\{needsImprovement\}\}|\{\{needsReplacement\}\}|\{\{attachmentText\}\}/i.test(
              tableContent
            );
          const rows = tableContent.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
          if (rows.length === 0) return false;
          return hasInspectionPlaceholders || isHeaderTable(tableContent);
        };

        const prevIsInspectionItems = isInspectionItemsTable(previousTable.content);
        const currIsInspectionItems = isInspectionItemsTable(currentTable.content);

        // Heading paragraphs indicate different sections and should prevent merging
        const headingParagraphRegex = /<w:p\b[^>]*>[\s\S]*?<w:pStyle\s+w:val="Heading\d+"[\s\S]*?<\/w:p>/gi;
        const hasHeadingParagraphs = headingParagraphRegex.test(betweenContent);
        
        // If there are heading paragraphs with actual text, don't merge
        if (hasHeadingParagraphs) {
          // Check if heading paragraphs have actual text (not just loop tags)
          const headingMatches = betweenContent.match(headingParagraphRegex);
          if (headingMatches) {
            let hasRealHeadingText = false;
            for (const headingPara of headingMatches) {
              let headingText = headingPara
                .replace(/<[^>]+>/g, '')  // Remove XML tags
                .replace(/&nbsp;|&#160;|&amp;#160;|&lt;|&gt;|&amp;/gi, ' ')  // Remove XML entities
                .replace(/\s+/g, '')  // Remove whitespace
                .trim();
              
              // Remove loop tags
              loopTagPatterns.forEach(pattern => {
                headingText = headingText.replace(pattern, '');
              });
              
              // САРЫН ТАЙЛАНГИЙН ХУВЬД: "Үзлэгийн тайлан" heading-ийн дараах хүснэгтүүдийг merge хийхийг зөвшөөрөх
              // Энэ нь header хүснэгт болон data хүснэгтийг нэгтгэнэ
              const isInspectionReportHeading = /үзлэг|тайлан|inspection|report/i.test(headingText);
              
              // If heading has real text AND is not an inspection report heading, don't merge
              // BUT: allow merge for inspection report header+data tables
              if (headingText.length > 0 && !isInspectionReportHeading && !(prevIsInspectionItems && currIsInspectionItems)) {
                hasRealHeadingText = true;
                break;
              }
            }
            
            // If heading paragraphs have real text, skip this merge
            if (hasRealHeadingText) {
              console.log(`[documents] mergeAdjacentTables: ❌ Cannot merge tables ${i - 1} and ${i} - heading paragraph between them:`, {
                betweenContentLength: betweenContent.length,
                betweenContentPreview: betweenContent.substring(0, 100),
              });
              continue; // Skip to next table pair
            }
          }
        }
        
        let contentWithoutLoopTags = betweenContent;
        loopTagPatterns.forEach(pattern => {
          contentWithoutLoopTags = contentWithoutLoopTags.replace(pattern, '');
        });
        
        // More aggressive check: remove all XML tags and whitespace
        let betweenContentClean = contentWithoutLoopTags
          // Remove all XML tags
          .replace(/<[^>]+>/g, '')
          // Remove XML entities
          .replace(/&nbsp;|&#160;|&amp;#160;|&lt;|&gt;|&amp;/gi, ' ')
          // Remove all whitespace
          .replace(/\s+/g, '')
          .trim();
        
        // Also check if it's just empty paragraphs or paragraphs with only loop tags
        const paragraphMatches = betweenContent.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi);
        if (paragraphMatches) {
          let allParagraphsEmpty = true;
          for (const para of paragraphMatches) {
            // First, remove loop tags from the entire paragraph (including inside <w:t> tags)
            let paraWithoutLoopTags = para;
            loopTagPatterns.forEach(pattern => {
              paraWithoutLoopTags = paraWithoutLoopTags.replace(pattern, '');
            });
            
            // Extract text from paragraph (including from <w:t> tags)
            // Remove all XML tags first, then check if any text remains
            let paraText = paraWithoutLoopTags
              .replace(/<[^>]+>/g, '')  // Remove all XML tags
              .replace(/&nbsp;|&#160;|&amp;#160;|&lt;|&gt;|&amp;/gi, ' ')  // Remove XML entities
              .replace(/\s+/g, '')  // Remove all whitespace
              .trim();
            
            // If paragraph still has content after removing loop tags and XML tags, it's not empty
            if (paraText.length > 0) {
              allParagraphsEmpty = false;
              break;
            }
          }
          if (allParagraphsEmpty) {
            betweenContentClean = '';
          }
        }
        
        // Also check for common Word formatting elements that should be ignored
        // These are often inserted between tables but don't contain actual content
        const formattingOnlyPatterns = [
          /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/gi,  // Section properties
          /<w:bookmarkStart\b[^>]*\/>/gi,  // Bookmark start
          /<w:bookmarkEnd\b[^>]*\/>/gi,  // Bookmark end
        ];
        
        let formattingOnlyContent = betweenContent;
        formattingOnlyPatterns.forEach(pattern => {
          formattingOnlyContent = formattingOnlyContent.replace(pattern, '');
        });
        
        // Remove loop tags from formatting check as well
        loopTagPatterns.forEach(pattern => {
          formattingOnlyContent = formattingOnlyContent.replace(pattern, '');
        });
        
        // Check if remaining content is just formatting
        const formattingOnlyClean = formattingOnlyContent
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;|&#160;|&amp;#160;|&lt;|&gt;|&amp;/gi, ' ')
          .replace(/\s+/g, '')
          .trim();
        
        // Check if previous table is a header table and current table is a data table
        const prevIsHeaderTable = isHeaderTable(previousTable.content);
        const currIsHeaderTable = isHeaderTable(currentTable.content);
        
        // If previous is header and current is data (or vice versa), be more aggressive about merging
        // Allow merge even if there's some content between them (like loop tags or empty paragraphs)
        const isHeaderDataPair = prevIsHeaderTable && !currIsHeaderTable;
        // NOTE: Do NOT use "data then header" (isDataHeaderPair) to merge — that joins
        // ерөнхий мэдээллийн хүснэгт (not an inspection header) with Үзлэгийн тайлан header.
        const inspectionAdjacent = prevIsInspectionItems && currIsInspectionItems;
        const emptyOrFormattingOnly =
          betweenContentClean.length === 0 || formattingOnlyClean.length === 0;
        // Зөвхөн хоёр хүснэгт аль аль нь үзлэгийн тайлантай холбоотой бол нийлүүлнэ
        const canMerge =
          inspectionAdjacent &&
          (emptyOrFormattingOnly ||
            (isHeaderDataPair && betweenContentClean.length < 500));
        
        // Debug: Log merge decision
        // Check if loop tags exist in content (including inside XML tags)
        const contentText = betweenContent.replace(/<[^>]+>/g, ''); // Remove XML tags to check text content
        const hasLoopTags = loopTagPatterns.some(pattern => pattern.test(contentText));
        console.log(`[documents] mergeAdjacentTables: Checking tables ${i - 1} and ${i}:`, {
          betweenContentLength: betweenContent.length,
          betweenContentCleanLength: betweenContentClean.length,
          formattingOnlyCleanLength: formattingOnlyClean.length,
          hasLoopTags: hasLoopTags,
          canMerge: canMerge,
          inspectionAdjacent,
          prevIsInspectionItems,
          currIsInspectionItems,
          prevIsHeaderTable: prevIsHeaderTable,
          currIsHeaderTable: currIsHeaderTable,
          isHeaderDataPair: isHeaderDataPair,
          betweenContentPreview: betweenContent.substring(0, 200),
        });
        
        // If between content is empty or only whitespace/formatting, merge tables
        // OR if it's a header-data pair, merge them
        if (canMerge) {
          // Extract rows from both tables
          const prevTableRows = previousTable.content.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
          const currTableRows = currentTable.content.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
          
          // Helper function to check if a row is a header row
          const isHeaderRow = (rowContent) => {
            const rowText = rowContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
            if (!rowText) return false;
            
            let textContent = '';
            rowText.forEach(t => {
              textContent += t.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
            });
            textContent = textContent.replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ').replace(/\s+/g, ' ').trim();
            
            // Check if row contains multiple column headers
            const columnHeaders = ['үзлэгийн эд анги', 'төлөв', 'хавсралт'];
            const matchCount = columnHeaders.filter(keyword => 
              textContent.toLowerCase().includes(keyword.toLowerCase())
            ).length;
            
            // Only consider it a header if it has at least 2 column headers
            return matchCount >= 2;
          };
          
          // Check if first table has a header row
          let prevRowsToMerge = [...prevTableRows];
          const prevHasHeader = prevTableRows.length > 0 && isHeaderRow(prevTableRows[0]);
          if (prevHasHeader) {
            // First table has header - keep it, merge data rows only
            prevRowsToMerge = prevTableRows; // Keep all rows including header
          }
          
          // Check if second table has a header row
          let rowsToMerge = [...currTableRows];
          const currHasHeader = currTableRows.length > 0 && isHeaderRow(currTableRows[0]);
          if (currHasHeader) {
            // Second table has header - skip it, merge only data rows
            rowsToMerge = currTableRows.slice(1); // Skip first row (header)
          }
          
          // Special handling: If previous table is header-only (1-2 rows) and current table is data,
          // merge them together keeping the header from previous table
          if (prevIsHeaderTable && !currIsHeaderTable && prevTableRows.length <= 2) {
            // Previous table is header-only, current is data - merge header + data
            prevRowsToMerge = prevTableRows; // Keep header rows
            rowsToMerge = currTableRows; // Keep all data rows
          }
          
          // Special handling: If previous table has header and data, and current table also has header,
          // skip the duplicate header from current table
          if (prevHasHeader && currHasHeader) {
            rowsToMerge = currTableRows.slice(1); // Skip duplicate header
          }
          
          // Get table properties from first table (usually contains column widths, etc.)
          const prevTableProps = previousTable.content.match(/<w:tblPr\b[^>]*>[\s\S]*?<\/w:tblPr>/gi)?.[0] || '';
          const prevTableGrid = previousTable.content.match(/<w:tblGrid\b[^>]*>[\s\S]*?<\/w:tblGrid>/gi)?.[0] || '';
          
          // Combine rows
          // If first table has header, keep it; if second table has header, skip it
          const allRows = [...prevRowsToMerge, ...rowsToMerge];
          
          console.log(`[documents] mergeAdjacentTables: ✅ Merging tables ${i - 1} and ${i}:`, {
            prevTableRows: prevTableRows.length,
            prevRowsToMerge: prevRowsToMerge.length,
            currTableRows: currTableRows.length,
            rowsToMerge: rowsToMerge.length,
            mergedRows: allRows.length,
            prevHasHeader: prevTableRows.length > 0 && isHeaderRow(prevTableRows[0]),
            currHasHeader: currTableRows.length > 0 && isHeaderRow(currTableRows[0]),
          });
          
          // Build merged table
          const mergedTable = `<w:tbl>${prevTableProps}${prevTableGrid}${allRows.join('')}</w:tbl>`;
          
          // Replace both tables and content between them with merged table
          const beforeFirstTable = newXml.substring(0, previousTable.start);
          const afterSecondTable = newXml.substring(currentTable.end);
          newXml = beforeFirstTable + mergedTable + afterSecondTable;
          
          mergedCount++;
          hasMoreMerges = true; // Continue merging
          break; // Break inner loop and restart from beginning to re-scan all tables
        } else {
          console.log(`[documents] mergeAdjacentTables: ❌ Cannot merge tables ${i - 1} and ${i} - content between them:`, {
            betweenContentLength: betweenContent.length,
            betweenContentCleanLength: betweenContentClean.length,
            betweenContentPreview: betweenContent.substring(0, 100),
          });
        }
      }
    }

    if (mergedCount > 0) {
      // Шинэчлэгдсэн XML-ийг ZIP-д буцааж оруулах
      zip.file('word/document.xml', newXml);
      
      // ZIP-ийг buffer болгон хөрвүүлэх
      const newBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      
      return newBuffer;
    } else {
      return docxBuffer;
    }
  } catch (error) {
    console.error('[documents] mergeAdjacentTables: ⚠️ Error merging tables:', error.message);
    console.error('[documents] mergeAdjacentTables: Stack:', error.stack);
    // Алдаа гарвал анхны buffer-ийг буцаана
    return docxBuffer;
  }
}

/**
 * Header хүснэгтүүдийг арилгах функц - зөвхөн эхний header хүснэгтийг үлдээнэ
 * Header хүснэгт нь "Үзлэгийн эд анги", "Төлөв", "Хавсралт" текст агуулдаг
 * @param {Buffer} docxBuffer - DOCX файлын buffer
 * @returns {Promise<Buffer>} Header хүснэгтүүд арилгасан DOCX buffer
 */
async function removeDuplicateHeaderTables(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) {
      console.warn('[documents] removeDuplicateHeaderTables: word/document.xml not found');
      return docxBuffer;
    }
    
    let xml = await xmlFile.async('string');
    
    console.log('[documents] removeDuplicateHeaderTables: Removing duplicate header tables...');
    
    // Header хүснэгтүүдийг олох
    // Header хүснэгт нь "Үзлэгийн эд анги", "Төлөв", "Хавсралт" текст агуулдаг
    const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi;
    const tables = [];
    let match;
    
    while ((match = tableRegex.exec(xml)) !== null) {
      const tableContent = match[0];
      
      // Table-ийн текст агуулгыг авна
      const textMatches = tableContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
      let tableText = '';
      if (textMatches) {
        textMatches.forEach(textMatch => {
          const textContent = textMatch.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
          tableText += textContent + ' ';
        });
      }
      
      tableText = tableText
        .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Header хүснэгт эсэхийг шалгах
      // Header хүснэгт нь "Үзлэгийн эд анги", "Төлөв", "Хавсралт" текст агуулдаг
      const hasHeaderText = 
        tableText.includes('Үзлэгийн эд анги') &&
        tableText.includes('Төлөв') &&
        tableText.includes('Хавсралт');
      
      // Header хүснэгт нь ихэвчлэн 2-3 мөртэй (header + sub-header)
      const rowCount = (tableContent.match(/<w:tr\b[^>]*>/gi) || []).length;
      const isHeaderTable = hasHeaderText && rowCount <= 3; // 2-3 мөртэй header хүснэгт
      
      if (isHeaderTable) {
        tables.push({
          match: match[0],
          index: match.index,
          isHeader: true,
        });
      }
    }
    
    console.log(`[documents] removeDuplicateHeaderTables: Found ${tables.length} header tables`);
    
    if (tables.length <= 1) {
      console.log('[documents] removeDuplicateHeaderTables: Only one or no header tables found, nothing to remove');
      return docxBuffer;
    }
    
    // Эхний header хүснэгтийг үлдээж, бусад header хүснэгтүүдийг арилгах
    // Буцааж эхлэх (сүүлийн header-ээс эхлэх) - индексийг зөв хадгалахын тулд
    let removedCount = 0;
    for (let i = tables.length - 1; i >= 1; i--) {
      const headerTable = tables[i];
      const beforeLength = xml.length;
      xml = xml.substring(0, headerTable.index) + xml.substring(headerTable.index + headerTable.match.length);
      const afterLength = xml.length;
      
      if (beforeLength !== afterLength) {
        removedCount++;
        console.log(`[documents] removeDuplicateHeaderTables: ✅ Removed header table ${i + 1}/${tables.length}`);
      }
      
      // Дараагийн header-ийн индексийг шинэчлэх
      for (let j = i - 1; j >= 0; j--) {
        if (tables[j].index > headerTable.index) {
          tables[j].index -= headerTable.match.length;
        }
      }
    }
    
    if (removedCount > 0) {
      console.log(`[documents] removeDuplicateHeaderTables: ✅ Removed ${removedCount} duplicate header tables, kept first one`);
      zip.file('word/document.xml', xml);
      
      const newBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      return newBuffer;
    }
    
    return docxBuffer;
  } catch (error) {
    console.error('[documents] removeDuplicateHeaderTables: ⚠️ Error removing duplicate header tables:', error.message);
    console.error('[documents] removeDuplicateHeaderTables: Stack:', error.stack);
    return docxBuffer;
  }
}

/**
 * Normalize template placeholders by removing whitespace inside {{ }} tags.
 * This fixes tags like {{# d.inspectionItems }} or {{ fieldName }}.
 * @param {Buffer} docxBuffer - DOCX template buffer
 * @param {string} context - Log context
 * @returns {Promise<Buffer>} Normalized DOCX buffer
 */
async function normalizeDocxTemplatePlaceholders(docxBuffer, context = 'template') {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    const targetFiles = Object.keys(zip.files).filter((relativePath) => {
      return (
        !zip.files[relativePath].dir &&
        /word\/(document|header\d+|footer\d+)\.xml$/i.test(relativePath)
      );
    });

    let updatedCount = 0;

    const fixBrokenTemplateTags = (xml) => {
      const replacements = [
        { tag: '#inspections', name: 'inspections' },
        { tag: '/inspections', name: 'inspections' },
        { tag: '#d.inspectionItems', name: 'd\\.inspectionItems' },
        { tag: '/d.inspectionItems', name: 'd\\.inspectionItems' },
        { tag: '#d.attachments', name: 'd\\.attachments' },
        { tag: '/d.attachments', name: 'd\\.attachments' },
        { tag: 'fieldName', name: 'fieldName' },
        { tag: 'isNormal', name: 'isNormal' },
        { tag: 'needsImprovement', name: 'needsImprovement' },
        { tag: 'needsReplacement', name: 'needsReplacement' },
        { tag: 'attachmentText', name: 'attachmentText' },
        // Installation report loop tags
        { tag: '#installationItems', name: 'installationItems' },
        { tag: '/installationItems', name: 'installationItems' },
        { tag: '#acts', name: 'acts' },
        { tag: '/acts', name: 'acts' },
        { tag: '#sections', name: 'sections' },
        { tag: '/sections', name: 'sections' },
        { tag: '#titles', name: 'titles' },
        { tag: '/titles', name: 'titles' },
        { tag: '#images', name: 'images' },
        { tag: '/images', name: 'images' },
      ];

      let result = xml;
      replacements.forEach(({ tag, name }) => {
        if (tag.startsWith('#')) {
          const pattern = new RegExp(
            `(<w:t[^>]*>)\\s*\\{\\{\\s*#\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*${name}\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*\\}\\}\\s*<\\/w:t>`,
            'gi'
          );
          result = result.replace(pattern, `$1{{#${name.replace('\\\\', '')}}}</w:t>`);
        } else if (tag.startsWith('/')) {
          const pattern = new RegExp(
            `(<w:t[^>]*>)\\s*\\{\\{\\s*\\/\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*${name}\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*\\}\\}\\s*<\\/w:t>`,
            'gi'
          );
          result = result.replace(pattern, `$1{{/${name.replace('\\\\', '')}}}</w:t>`);
        } else {
          const pattern = new RegExp(
            `(<w:t[^>]*>)\\s*\\{\\{\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*${name}\\s*<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\s*\\}\\}\\s*<\\/w:t>`,
            'gi'
          );
          result = result.replace(pattern, `$1{{${name.replace('\\\\', '')}}}</w:t>`);
        }
      });

      return result;
    };

    // Word often splits {{placeholder}} across multiple w:t XML nodes.
    // This function merges them back into a single w:t so easy-template-x can find them.
    // Only merges when the combined result is a valid placeholder to avoid creating {{}} empty tags.
    const mergeSplitPlaceholders = (xml) => {
      const validPlaceholder = /^\{\{[#\/]?[A-Za-z0-9_][A-Za-z0-9_.-]*\}\}$/;
      let result = xml;
      let prev = '';
      let iterations = 0;
      while (prev !== result && iterations < 20) {
        prev = result;
        iterations++;
        result = result.replace(
          /(\{\{[#\/]?[^<{}>]*?)(<\/w:t>)((?:(?!<\/w:p[ >]|<\/w:p>)[\s\S])*?)(<w:t[^>]*>)([^<{}>]*?\}\})/g,
          (match, part1, closeT, middle, openT, part2) => {
            const combined = part1 + part2;
            // Only merge if the combined result is a valid placeholder like {{name}}, {{#loop}}, {{/loop}}, {{a.b.c}}
            if (validPlaceholder.test(combined)) {
              return combined;
            }
            return match;
          }
        );
      }
      if (iterations > 1) {
        console.log(`[documents] mergeSplitPlaceholders: merged split tags in ${iterations} passes (${context})`);
      }
      return result;
    };

    for (const filePath of targetFiles) {
      const file = zip.file(filePath);
      if (!file) continue;
      const originalXml = await file.async('string');
      let xml = fixBrokenTemplateTags(originalXml);
      xml = mergeSplitPlaceholders(xml);

      const normalized = xml
        .replace(/\{\{\s*#\s*([A-Za-z0-9_.-]+)\s*\}\}/g, '{{#$1}}')
        .replace(/\{\{\s*\/\s*([A-Za-z0-9_.-]+)\s*\}\}/g, '{{/$1}}')
        .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, '{{$1}}');

      // Compare against originalXml so that mergeSplitPlaceholders changes are also saved
      if (normalized !== originalXml) {
        zip.file(filePath, normalized);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[documents] normalizeDocxTemplatePlaceholders: ✅ Updated ${updatedCount} XML parts (${context})`);
      return await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
    }

    console.log(`[documents] normalizeDocxTemplatePlaceholders: No changes needed (${context})`);
    return docxBuffer;
  } catch (error) {
    console.error('[documents] normalizeDocxTemplatePlaceholders: ⚠️ Error:', error.message);
    console.error('[documents] normalizeDocxTemplatePlaceholders: Stack:', error.stack);
    return docxBuffer;
  }
}

/**
 * DOCX файлаас зөвхөн loop tag-ууд агуулсан хүснэгтийн мөрүүдийг устгах
 * Энэ функц нь DOCX файлын бүтцийг алдаатай болгохгүй байхын тулд зөвхөн хүснэгтийн мөрүүдийг устгана
 * @param {Buffer} docxBuffer - DOCX файлын buffer
 * @returns {Promise<Buffer>} Loop tag-ууд агуулсан мөрүүд арилгасан DOCX buffer
 */
async function removeLoopTagTableRows(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    
    // word/document.xml файлыг унших
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) {
      console.warn('[documents] removeLoopTagTableRows: word/document.xml not found');
      return docxBuffer;
    }
    
    let xml = await xmlFile.async('string');
    
    console.log('[documents] removeLoopTagTableRows: Removing loop tag table rows only...');

    // Remove table rows that contain only loop tags ({{#d.inspectionItems}} or {{/d.inspectionItems}})
    let removedLoopRows = 0;
    const tableRowRegex = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi;
    xml = xml.replace(tableRowRegex, (match) => {
      // Check if this row contains only loop tags
      const textMatches = match.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
      if (textMatches) {
        let allText = '';
        textMatches.forEach(textMatch => {
          const textContent = textMatch.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
          allText += textContent;
        });
        
        allText = allText
          .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // If row contains ONLY loop tags (with or without whitespace), remove it
        if (/^\s*\{\{#d\.inspectionItems\}\}\s*$|^\s*\{\{\/d\.inspectionItems\}\}\s*$/i.test(allText)) {
          removedLoopRows++;
          return ''; // Remove this row
        }
      }
      return match; // Keep this row
    });

    // Шинэчлэгдсэн XML-ийг ZIP-д буцааж оруулах
    zip.file('word/document.xml', xml);
    
    // ZIP-ийг buffer болгон хөрвүүлэх
    const newBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
    return newBuffer;
  } catch (error) {
    console.error('[documents] removeLoopTagTableRows: ⚠️ Error removing loop tag table rows:', error.message);
    console.error('[documents] removeLoopTagTableRows: Stack:', error.stack);
    // Алдаа гарвал анхны buffer-ийг буцаана
    return docxBuffer;
  }
}

/**
 * Remove leftover loop tags like {{/inspections}} from rendered DOCX output.
 * This is a safety net when Word splits runs and the templating engine
 * fails to remove closing tags.
 * @param {Buffer} docxBuffer - DOCX buffer
 * @param {string} [context] - Log context
 * @returns {Promise<Buffer>}
 */
async function removeRemainingLoopTags(docxBuffer, context = 'documents') {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    const targetFiles = Object.keys(zip.files).filter((relativePath) => {
      return (
        !zip.files[relativePath].dir &&
        /word\/(document|header\d+|footer\d+)\.xml$/i.test(relativePath)
      );
    });

    let updatedCount = 0;
    const loopTagPattern = /\{\{[#/](?:inspections|d\.inspectionItems|d\.attachments)\}\}/g;

    for (const filePath of targetFiles) {
      const file = zip.file(filePath);
      if (!file) continue;
      let xml = await file.async('string');
      const cleaned = xml.replace(loopTagPattern, '');

      if (cleaned !== xml) {
        zip.file(filePath, cleaned);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[${context}] ✅ Removed leftover loop tags in ${updatedCount} XML part(s)`);
      return await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
    }

    return docxBuffer;
  } catch (error) {
    console.warn(`[${context}] ⚠️ Failed to remove leftover loop tags:`, error.message);
    return docxBuffer;
  }
}

/**
 * Merge consecutive tables that share the same column grid when they are
 * separated only by empty paragraphs. This helps when header rows and data
 * rows are rendered into two adjacent tables.
 * @param {Buffer} docxBuffer - DOCX buffer
 * @param {string} [context] - Log context
 * @returns {Promise<Buffer>}
 */
async function mergeConsecutiveTables(docxBuffer, context = 'documents') {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) {
      console.warn(`[${context}] mergeConsecutiveTables: word/document.xml not found`);
      return docxBuffer;
    }

    let xml = await xmlFile.async('string');
    const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi;

    let lastIndex = 0;
    let result = '';
    let prevTable = null;
    let prevGrid = null;
    let mergeCount = 0;

    const extractGrid = (tableXml) => {
      const gridMatch = tableXml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/i);
      return gridMatch ? gridMatch[0].replace(/\s+/g, '') : null;
    };

    const extractRows = (tableXml) => {
      return tableXml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
    };

    const stripEmptyParagraphs = (segment) => {
      return segment.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi, (paragraph) => {
        const textOnly = paragraph.replace(/<[^>]+>/g, '').trim();
        return textOnly === '' ? '' : paragraph;
      });
    };

    let match;
    while ((match = tableRegex.exec(xml)) !== null) {
      const tableXml = match[0];
      const tableGrid = extractGrid(tableXml);
      const between = xml.slice(lastIndex, match.index);

      if (prevTable) {
        const betweenClean = stripEmptyParagraphs(between).trim();
        const canMerge = betweenClean === '' && tableGrid && tableGrid === prevGrid;

        if (canMerge) {
          const rows = extractRows(tableXml);
          prevTable = prevTable.replace(/<\/w:tbl>\s*$/, `${rows.join('')}</w:tbl>`);
          mergeCount += 1;
        } else {
          result += prevTable + between;
          prevTable = tableXml;
          prevGrid = tableGrid;
        }
      } else {
        result += between;
        prevTable = tableXml;
        prevGrid = tableGrid;
      }

      lastIndex = match.index + match[0].length;
    }

    if (prevTable) {
      result += prevTable;
    }
    result += xml.slice(lastIndex);

    if (mergeCount > 0) {
      zip.file('word/document.xml', result);
      console.log(`[${context}] ✅ Merged ${mergeCount} consecutive table(s)`);
      return await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
    }

    return docxBuffer;
  } catch (error) {
    console.warn(`[${context}] ⚠️ Failed to merge consecutive tables:`, error.message);
    return docxBuffer;
  }
}

function isTrulyEmptyParagraph(p) {
  // Paragraph-д ямар нэг харагдах контент (текст, зураг, break, bookmark гэх мэт) байвал хоосон биш
  // МАШ НАРИЙВЧЛАН шалгах: зөвхөн formatting агуулсан paragraph-уудыг л хоосон гэж үзнэ
  
  // 1. Текст агуулсан эсэхийг шалгах
  if (/<w:t\b[^>]*>[\s\S]*?<\/w:t>/i.test(p)) {
    // Текст tag олдсон, гэхдээ хоосон эсэхийг шалгах хэрэгтэй
    const textMatches = p.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi);
    if (textMatches) {
      let hasContent = false;
      for (const textMatch of textMatches) {
        const textContent = textMatch.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
        const cleanedText = textContent
          .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
          .replace(/\s+/g, '')
          .trim();
        if (cleanedText.length > 0) {
          hasContent = true;
          break;
        }
      }
      if (hasContent) {
        return false; // Текст агуулсан байна, хоосон биш
      }
    }
  }
  
  // 2. Бусад чухал элементүүд агуулсан эсэхийг шалгах
  if (/<w:br\b|<w:drawing\b|<w:tbl\b|<w:bookmarkStart\b|<w:hyperlink\b|<w:pict\b/i.test(p)) {
    return false; // Чухал элемент агуулсан, хоосон биш
  }
  
  // 3. Зөвхөн formatting/style агуулсан paragraph
  return true; // Хоосон
}

async function removeConsecutiveEmptyParagraphs(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);

    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) return docxBuffer;

    let xml = await xmlFile.async('string');

    // хүснэгтийг хамгаалж салгах
    const tables = [];
    xml = xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/gi, m => {
      tables.push(m);
      return `__TABLE_${tables.length - 1}__`;
    });

    // paragraph-уудыг нэг нэгээр нь задлах (index-тэй хамт)
    const paraMatches = [];
    const paraRegex = /<w:p\b[\s\S]*?<\/w:p>/gi;
    let match;
    while ((match = paraRegex.exec(xml)) !== null) {
      paraMatches.push({
        content: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    // Дараалсан хоосон paragraph-уудыг олох
    const cleaned = [];
    let lastIndex = 0;
    let emptyCount = 0;

    for (let i = 0; i < paraMatches.length; i++) {
      const para = paraMatches[i];
      
      // Paragraph-оос өмнөх текст-ийг хадгалах
      cleaned.push(xml.substring(lastIndex, para.start));
      
      if (isTrulyEmptyParagraph(para.content)) {
        emptyCount++;
        if (emptyCount === 1) {
          cleaned.push(para.content); // зөвхөн 1-ийг үлдээнэ
        }
        // 2+ дараалсан хоосон paragraph-ийг алгасах
      } else {
        emptyCount = 0;
        cleaned.push(para.content);
      }
      
      lastIndex = para.end;
    }

    // Сүүлийн paragraph-ийн дараах текст-ийг хадгалах
    cleaned.push(xml.substring(lastIndex));

    xml = cleaned.join('');

    // хүснэгтийг буцааж тавих
    xml = xml.replace(/__TABLE_(\d+)__/g, (_, i) => tables[i]);

    zip.file('word/document.xml', xml);

    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
  } catch (e) {
    console.error(e);
    return docxBuffer;
  }
}


/**
 * DOCX файлаас хоосон paragraph-уудыг (enter/whitespace агуулсан мөр) арилгах
 * Жишээ: "text1\n\n\ntext2" -> "text1\ntext2"
 * @param {Buffer} docxBuffer - DOCX файлын buffer
 * @returns {Promise<Buffer>} Хоосон paragraph-ууд арилгасан DOCX buffer
 */
async function removeEmptyParagraphs(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    
    // word/document.xml файлыг унших
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) {
      console.warn('[documents] removeEmptyParagraphs: word/document.xml not found');
      return docxBuffer;
    }
    
    let xml = await xmlFile.async('string');
    const originalLength = xml.length;
    
    console.log('[documents] removeEmptyParagraphs: Processing XML with aggressive cleanup...');
    
    // STEP 0: Remove consecutive empty paragraphs (more aggressive)
    // This removes multiple empty paragraphs in a row
    let consecutiveRemoved = 0;
    // Match 2 or more consecutive paragraphs (improved pattern)
    const consecutiveEmptyPattern = /(<w:p\b[^>]*>[\s\S]*?<\/w:p>)(\s*<w:p\b[^>]*>[\s\S]*?<\/w:p>)+/gi;
    xml = xml.replace(consecutiveEmptyPattern, (match) => {
      const paragraphs = match.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi) || [];
      if (paragraphs.length < 2) {
        return match;
      }
      
      const emptyParagraphs = paragraphs.filter(p => isEmptyWordParagraph(p));
      const nonEmpty = paragraphs.filter(p => !isEmptyWordParagraph(p));
      
      if (emptyParagraphs.length >= 2) {
        // Keep only non-empty paragraphs, or if all empty, keep just one
        const toKeep = nonEmpty.length > 0 ? nonEmpty : [paragraphs[0]];
        consecutiveRemoved += emptyParagraphs.length - (nonEmpty.length === 0 ? 1 : 0);
        return toKeep.join('');
      }
      return match;
    });
    if (consecutiveRemoved > 0) {
      console.log(`[documents] removeEmptyParagraphs: Removed ${consecutiveRemoved} consecutive empty paragraphs`);
    }

    // STEP 1: Remove table rows that contain only loop tags ({{#d.inspectionItems}} or {{/d.inspectionItems}})
    // Table row format: <w:tr>...</w:tr>
    let removedLoopRows = 0;
    const tableRowRegex = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi;
    xml = xml.replace(tableRowRegex, (match) => {
      // Check if this row contains only loop tags
      const textMatches = match.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
      if (textMatches) {
        let allText = '';
        textMatches.forEach(textMatch => {
          const textContent = textMatch.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
          allText += textContent;
        });
        
        allText = allText
          .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // If row contains ONLY loop tags (with or without whitespace), remove it
        if (/^\{\{#d\.inspectionItems\}\s*\}$|^\{\{\/d\.inspectionItems\}\s*\}$/i.test(allText)) {
          removedLoopRows++;
          console.log(`[documents] removeEmptyParagraphs: Removing loop tag only table row: "${allText}"`);
          return ''; // Remove this row
        }
      }
      return match; // Keep this row
    });

    console.log(`[documents] removeEmptyParagraphs: Removed ${removedLoopRows} loop tag table rows`);

    // STEP 2: Skip aggressive cell paragraph removal to avoid corrupting DOCX structure
    // Instead, we'll rely on STEP 3 to remove empty paragraphs globally

    // STEP 3: Remove empty paragraphs (including those with only loop tags)
    // BUT: Be careful not to remove paragraphs inside table cells that are needed for structure
    const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi;

    let newXml = '';
    let lastIndex = 0;
    let removedParagraphs = 0;
    let keptParagraphs = 0;

    xml.replace(paragraphRegex, (match, offset) => {
      // Paragraph-оос өмнөх хэсгийг хадгална
      newXml += xml.slice(lastIndex, offset);

      // Check if this paragraph is inside a table cell
      // If it is, be more conservative about removing it
      const beforeMatch = xml.substring(Math.max(0, offset - 500), offset);
      const isInsideTableCell = /<w:tc\b[^>]*>[\s\S]*<w:p\b[^>]*>[\s\S]*$/i.test(beforeMatch);
      
      if (isEmptyWordParagraph(match)) {
        // If paragraph is inside a table cell and contains only whitespace/loop tags,
        // we might want to keep it to maintain cell structure
        // But if it's ONLY a loop tag, remove it
        const textMatches = match.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi);
        if (textMatches) {
          let allText = '';
          textMatches.forEach(tm => {
            allText += tm.replace(/<w:t[^>]*>|<\/w:t>/gi, '');
          });
          allText = allText.replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ').replace(/\s+/g, '').trim();
          
          // If it's a loop tag, remove it even if inside table cell
          if (/^\{\{#d\.inspectionItems\}\s*\}$|^\{\{\/d\.inspectionItems\}\s*\}$/i.test(allText)) {
            removedParagraphs += 1;
            console.log(`[documents] removeEmptyParagraphs: Removing loop tag paragraph at offset ${offset}`);
            // Don't add to newXml - effectively removes it
          } else if (isInsideTableCell) {
            // Inside table cell - be more aggressive: remove empty paragraphs even in cells
            // Only keep if it's the last paragraph in the cell (to maintain cell structure)
            const afterMatch = xml.substring(offset + match.length, Math.min(xml.length, offset + match.length + 500));
            const isLastInCell = /<\/w:tc\b/i.test(afterMatch.split('<w:p')[0]);
            if (isLastInCell) {
              // Last paragraph in cell - keep minimal structure
              keptParagraphs += 1;
              newXml += match;
            } else {
              // Not last paragraph in cell - remove it
              removedParagraphs += 1;
              console.log(`[documents] removeEmptyParagraphs: Removing empty paragraph in table cell at offset ${offset}`);
            }
          } else {
            // Not in table cell and empty - remove it
            removedParagraphs += 1;
            console.log(`[documents] removeEmptyParagraphs: Removing empty paragraph at offset ${offset}`);
          }
        } else {
          // No text matches - be more aggressive: remove even in table cells if not last
          if (isInsideTableCell) {
            const afterMatch = xml.substring(offset + match.length, Math.min(xml.length, offset + match.length + 500));
            const isLastInCell = /<\/w:tc\b/i.test(afterMatch.split('<w:p')[0]);
            if (isLastInCell) {
              keptParagraphs += 1;
              newXml += match;
            } else {
              removedParagraphs += 1;
              console.log(`[documents] removeEmptyParagraphs: Removing empty paragraph (no text) in table cell at offset ${offset}`);
            }
          } else {
            removedParagraphs += 1;
            console.log(`[documents] removeEmptyParagraphs: Removing empty paragraph (no text) at offset ${offset}`);
          }
        }
      } else {
        keptParagraphs += 1;
        newXml += match;
      }

      lastIndex = offset + match.length;
      return match;
    });

    // Сүүлийн paragraph-аас хойших үлдэгдэл XML-ийг нэмнэ
    newXml += xml.slice(lastIndex);

    // STEP 4: Remove empty table rows (rows with only empty cells)
    let removedEmptyRows = 0;
    const tableRowPattern = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
    newXml = newXml.replace(tableRowPattern, (match, rowContent) => {
      // Check if row contains only empty cells
      const cellPattern = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
        cells.push(cellMatch[1]);
      }
      
      // If all cells are empty (no text, no images, no meaningful content)
      const allCellsEmpty = cells.every(cell => {
        const cellText = cell.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ').replace(/\s+/g, '').trim();
        const hasContent = /<w:drawing\b|<w:pict\b|<w:tbl\b/i.test(cell);
        return !hasContent && cellText.length === 0;
      });
      
      if (allCellsEmpty && cells.length > 0) {
        removedEmptyRows++;
        return ''; // Remove empty row
      }
      
      return match;
    });
    
    if (removedEmptyRows > 0) {
      console.log(`[documents] removeEmptyParagraphs: Removed ${removedEmptyRows} empty table rows`);
    }

    const newLength = newXml.length;
    const removedChars = originalLength - newLength;

    console.log(
      `[documents] removeEmptyParagraphs: Removed ${removedParagraphs} empty paragraphs, ${removedEmptyRows} empty table rows, kept ${keptParagraphs} paragraphs (Δ${removedChars} chars)`
    );
    
    // Шинэчлэгдсэн XML-ийг ZIP-д буцааж оруулах
    zip.file('word/document.xml', newXml);
    
    // ZIP-ийг buffer болгон хөрвүүлэх
    const newBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
    
    console.log('[documents] removeEmptyParagraphs: ✅ Successfully removed empty paragraphs');
    return newBuffer;
  } catch (error) {
    console.error('[documents] removeEmptyParagraphs: ⚠️ Error removing empty paragraphs:', error.message);
    console.error('[documents] removeEmptyParagraphs: Stack:', error.stack);
    // Алдаа гарвал анхны buffer-ийг буцаана
    return docxBuffer;
  }
}

/**
 * Center align cells containing "+" signs in tables
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<Buffer>} Modified DOCX buffer with centered "+" cells
 */
async function centerAlignPlusSignCells(docxBuffer) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(docxBuffer);
    const xml = await zip.file('word/document.xml').async('string');
    
    // Match table cells (tc) that contain "+" signs
    // Pattern: <w:tc>...<w:t>+</w:t>...</w:tc>
    const cellPattern = /(<w:tc[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
    let modifiedXml = xml;
    let matchCount = 0;
    
    modifiedXml = modifiedXml.replace(cellPattern, (match, openingTag, cellContent, closingTag) => {
      // Check if cell contains "+" sign (with optional whitespace)
      const hasPlusSign = /<w:t[^>]*>[\s]*\+[\s]*<\/w:t>/.test(cellContent);
      
      if (hasPlusSign) {
        // Check if paragraph already has alignment
        const hasAlignment = /<w:jc[^>]*>/.test(cellContent);
        
        if (!hasAlignment) {
          // Find paragraph (w:p) and add center alignment
          const paraPattern = /(<w:p[^>]*>)/;
          const paraMatch = cellContent.match(paraPattern);
          
          if (paraMatch) {
            // Check if paragraph properties (pPr) exist
            const paraPropsPattern = /(<w:pPr[^>]*>)([\s\S]*?)(<\/w:pPr>)/;
            const paraPropsMatch = cellContent.match(paraPropsPattern);
            
            if (paraPropsMatch) {
              // Add w:jc center to existing pPr (before closing tag)
              const modifiedParaProps = paraPropsMatch[0].replace(
                /<\/w:pPr>/,
                '<w:jc w:val="center"/></w:pPr>'
              );
              matchCount++;
              return openingTag + cellContent.replace(paraPropsPattern, modifiedParaProps) + closingTag;
            } else {
              // Add pPr with center alignment after opening p tag
              const modifiedContent = cellContent.replace(
                paraMatch[0],
                paraMatch[0] + '<w:pPr><w:jc w:val="center"/></w:pPr>'
              );
              matchCount++;
              return openingTag + modifiedContent + closingTag;
            }
          }
        }
      }
      
      return match;
    });
    
    if (matchCount > 0) {
      console.log(`[documents] ✅ Centered ${matchCount} cells containing "+" signs`);
      zip.file('word/document.xml', modifiedXml);
      return await zip.generateAsync({ type: 'nodebuffer' });
    }
    
    return docxBuffer;
  } catch (error) {
    console.warn('[documents] ⚠️ Failed to center align "+" cells:', error.message);
    return docxBuffer;
  }
}

/**
 * DOCX файл дээр хийх бүх post-processing алхмуудыг нэг газар төвлөрүүлэх туслах функц
 * Одоогоор:
 *  - Хоосон paragraph-уудыг арилгах
 *  - "+" тэмдэгтэй cell-үүдийг голлуулан байрлуулах
 *
 * @param {Buffer} docxBuffer
 * @param {Object} [options]
 * @param {string} [options.context] - Log-д харагдах контекст (жишээ: 'inspection-docx', 'monthly-report')
 * @returns {Promise<Buffer>}
 */
async function postProcessDocxBuffer(docxBuffer, options = {}) {
  const { context = 'documents' } = options || {};

  let buffer = docxBuffer;

  try {
    buffer = await removeEmptyParagraphs(buffer);
  } catch (error) {
    console.error(
      `[${context}] postProcessDocxBuffer: ⚠️ Failed to remove empty paragraphs:`,
      error.message
    );
  }

  try {
    buffer = await centerAlignPlusSignCells(buffer);
  } catch (error) {
    console.error(
      `[${context}] postProcessDocxBuffer: ⚠️ Failed to center align "+" cells:`,
      error.message
    );
  }

  return buffer;
}

async function groupImagesBySectionAndField(images) {
  // Section + field бүрийн зурагуудыг бүлэглэх
  const grouped = {};

  if (!Array.isArray(images)) {
    return grouped;
  }

  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const section = image.section;
    const fieldId = image.fieldId;
    
    console.log(`[documents] Processing image ${index + 1}/${images.length}:`, {
      section,
      fieldId,
      hasBase64: !!image.base64,
      base64Length: image.base64?.length,
      mimeType: image.mimeType,
    });
    
    if (section && fieldId) {
      const key = `${section}.${fieldId}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      
      const imageContent = await createImageContent(image);
      if (imageContent) {
        console.log(`[documents] ✅ Image content created for ${key}`);
        grouped[key].push(imageContent);
      } else {
        console.warn(`[documents] ❌ Failed to create image content for ${key}`, {
          section,
          fieldId,
          hasBase64: !!image.base64,
          mimeType: image.mimeType,
        });
      }
    } else {
      console.warn(`[documents] ❌ Image missing section or fieldId:`, {
        section,
        fieldId,
        imageId: image.id,
      });
    }
  }

  return grouped;
}
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { buildInspectionReportData, formatStatusForTemplate } = require('../services/report-service');
const { buildInstallationReportData } = require('../services/installation-report-service');
const { serializeBigInt } = require('../utils/routeHelpers');
const { loadImagePayload, inferMimeType, normalizeRelativePath } = require('../utils/imageStorage');
const { sendInspectionCompletionEmail, sendMonthlyReportEmail } = require('../services/email-service');

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Buffer)
  );
}

function flattenTemplateFields(value, prefix = '', result = {}) {
  if (!isPlainObject(value)) {
    return result;
  }

  Object.entries(value).forEach(([key, entry]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean'
    ) {
      result[nextKey] = entry ?? '';
      return;
    }

    // CRITICAL: Skip image objects entirely - DO NOT flatten or copy them
    // This prevents Buffer duplication and corruption in easy-template-x
    if (entry && typeof entry === 'object' && entry._type === 'image') {
      // DO NOT add to result - let image objects remain only in nested structure
      return;
    }

    if (isPlainObject(entry)) {
      flattenTemplateFields(entry, nextKey, result);
    }
    
    // Skip arrays - they will be handled separately for images
    if (Array.isArray(entry)) {
      // Don't flatten arrays, keep them as is
      result[nextKey] = entry;
    }
  });

  return result;
}

const router = express.Router();
const prisma = new PrismaClient();

// Template handler configuration
const TEMPLATE_HANDLER_OPTIONS = {
  delimiters: {
    tagStart: '{{',
    tagEnd: '}}',
    containerTagOpen: '#',
    containerTagClose: '/',
  },
  // Fix Word's XML formatting that can split placeholders across text nodes
  fixRawXml: true,
  // Increase max XML depth to handle complex documents
  maxXmlDepth: 25,
};

// Create template handler instance
const templateHandler = new TemplateHandler(TEMPLATE_HANDLER_OPTIONS);

// Basic placeholder route to confirm the documents router is mounted
router.get('/', (req, res) => {
  res.json({ message: 'Documents API is available' });
});

const REPORT_TEMPLATE_FILE =
  process.env.REPORT_TEMPLATE_FILE || 'inspection_analog_template.docx';

// Preview data for inspection report based on answer ID
router.get('/answers/:answerId/preview', authMiddleware, async (req, res) => {
  try {
    const answerId = BigInt(req.params.answerId);
    const data = await buildInspectionReportData(prisma, { answerId });
    return res.json({ data });
  } catch (error) {
    console.error('Error building inspection preview data:', error);
    return res.status(500).json({
      error: 'Failed to build preview data',
      message: error.message,
    });
  }
});

/**
 * Generate DOCX buffer for an inspection answer
 * @param {BigInt} answerId - The inspection answer ID
 * @returns {Promise<Buffer>} The generated DOCX file buffer
 */
async function generateInspectionDocx(answerId) {
  const answerIdBigInt = typeof answerId === 'bigint' ? answerId : BigInt(answerId);
  const reportData = await buildInspectionReportData(prisma, { answerId: answerIdBigInt });

  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    REPORT_TEMPLATE_FILE
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file ${REPORT_TEMPLATE_FILE} is missing.`);
  }

  const templateFile = fs.readFileSync(templatePath);
  const normalizedTemplateFile = await normalizeDocxTemplatePlaceholders(
    templateFile,
    'inspection-template'
  );
  
  // Flatten the d object specifically with 'd' prefix
  const flattenedFields = flattenTemplateFields(reportData.d || {}, 'd');
  
  // Create templateData with both nested structure and flattened keys
  const templateData = {
    ...reportData,  // Keep original nested structure
    ...flattenedFields,  // Add flattened keys for dot-separated placeholders
  };
  
  // Also ensure nested structure exists for images (easy-template-x might need both)
  if (!templateData.d) {
    templateData.d = {};
  }
  // Ensure d.remarks is properly set in nested structure
  if (reportData.d?.remarks !== undefined) {
    templateData.d.remarks = reportData.d.remarks;
  }
  // Ensure indicator section exists and is properly set
  if (!templateData.d.indicator) {
    templateData.d.indicator = reportData.d?.indicator || {};
  } else {
    // Merge to ensure all fields are present
    templateData.d.indicator = {
      ...reportData.d?.indicator,
      ...templateData.d.indicator,
    };
  }
  if (!templateData.d.images) {
    templateData.d.images = {};
  }
  if (!templateData.d.hasImages) {
    templateData.d.hasImages = {};
  }

  // Signature image
  // CRITICAL: Add signature in both nested and flattened structure for template compatibility
  const inspectorSignature = reportData.d?.signatures?.inspector;
  const inspectorImage = await createSignatureImageContent(inspectorSignature);
  if (inspectorImage) {
    // Ensure signatures object exists in nested structure
    if (!templateData.d.signatures) {
      templateData.d.signatures = {};
    }
    // Add to nested structure (for nested placeholders like {{d.signatures.inspector}})
    templateData.d.signatures.inspector = inspectorImage;
    // Add flattened key (for dot-separated placeholders like {{d.signatures.inspector}})
    templateData['d.signatures.inspector'] = inspectorImage;
    } else {
    // No inspector signature found
  }

  // FTP image
  const ftpImage = reportData.d?.ftp_image;
  const ftpImageContent = await createSignatureImageContent(ftpImage);
  if (ftpImageContent) {
    ftpImageContent.width = 300;
    ftpImageContent.height = 200;
    templateData['d.ftp_image'] = ftpImageContent;
  }

  // Group images by section + field_id and add to template data
  const imagesBySectionField = await groupImagesBySectionAndField(
    reportData.d?.images || []
  );

  // Засварын мэдээлэл (хавсралтын хүснэгт: өмнө/дараа тайлбар болон зураг) – map-ийг fieldMappings-ийн дараа үүсгэнэ
  const inspectionAnswerIdForRepairs = BigInt(reportData.answer.id);
  const repairsForDocx = await prisma.Repair.findMany({
    where: {
      inspectionAnswerId: inspectionAnswerIdForRepairs,
      repairStatus: { in: ['COMPLETED', 'VERIFIED'] },
    },
    include: { images: { orderBy: { uploadedAt: 'asc' } } },
    orderBy: [{ section: 'asc' }, { fieldId: 'asc' }],
  });

  // Field mapping (section -> field_id -> field_key)
  const fieldMappings = {
    exterior: {
      sensor_base: 'sensor_base',
      beam: 'beam',
      platform_plate: 'platform_plate',
      beam_joint_plate: 'beam_joint_plate',
      stop_bolt: 'stop_bolt',
      interplatform_bolts: 'interplatform_bolts',
    },
    indicator: {
      led_display: 'led_display',
      power_plug: 'power_plug',
      seal_bolt: 'seal_bolt',
      buttons: 'buttons',
      junction_wiring: 'junction_wiring',
      serial_converter: 'serial_converter_plug',
    },
    jbox: {
      box_integrity: 'box_integrity',
      collector_board: 'collector_board',
      wire_tightener: 'wire_tightener',
      resistor_element: 'resistor_element',
      protective_box: 'protective_box',
    },
    sensor: {
      signal_wire: 'signal_wire',
      ball: 'ball',
      base: 'base',
      ball_cup_thin: 'ball_cup_thin',
      plate: 'plate',
    },
    foundation: {
      cross_base: 'cross_base',
      anchor_plate: 'anchor_plate',
      ramp_angle: 'ramp_angle',
      ramp_stopper: 'ramp_stopper',
      ramp: 'ramp',
      slab_base: 'slab_base',
    },
    cleanliness: {
      under_platform: 'under_platform',
      top_platform: 'top_platform',
      gap_platform_ramp: 'gap_platform_ramp',
      both_sides_area: 'both_sides_area',
    },
  };

  // section.fieldId болон section.fieldKey-аар засвар хайх (fieldMappings-ийн дараа байрлах ёстой)
  const repairMapByField = new Map();
  for (const r of repairsForDocx) {
    repairMapByField.set(`${r.section}.${r.fieldId}`, r);
    const sectionMap = fieldMappings[r.section];
    if (sectionMap) {
      const entry = Object.entries(sectionMap).find(([id, key]) => id === r.fieldId || key === r.fieldId);
      if (entry) repairMapByField.set(`${r.section}.${entry[1]}`, r);
    }
  }

  // Initialize all field mappings with empty arrays and false hasImages
  Object.keys(fieldMappings).forEach((section) => {
    Object.keys(fieldMappings[section]).forEach((fieldId) => {
      const fieldKey = fieldMappings[section][fieldId];
      const templateKey = `d.images.${section}.${fieldKey}`;
      const hasImagesKey = `d.hasImages.${section}.${fieldKey}`;
      
      if (!templateData[templateKey]) {
        templateData[templateKey] = [];
      }
      if (templateData[hasImagesKey] === undefined) {
        templateData[hasImagesKey] = false;
      }
      
      if (!templateData.d.images[section]) {
        templateData.d.images[section] = {};
      }
      if (!templateData.d.hasImages[section]) {
        templateData.d.hasImages[section] = {};
      }
      if (!templateData.d.images[section][fieldKey]) {
        templateData.d.images[section][fieldKey] = [];
      }
      if (templateData.d.hasImages[section][fieldKey] === undefined) {
        templateData.d.hasImages[section][fieldKey] = false;
      }
    });
  });
  
  // Now add actual images
  Object.keys(imagesBySectionField).forEach((key) => {
    const [section, fieldId] = key.split('.');
    const images = imagesBySectionField[key];
    
    console.log(`[documents] Processing image group: ${key}`, {
      section,
      fieldId,
      imageCount: Array.isArray(images) ? images.length : 0,
      hasFieldMapping: !!(fieldMappings[section] && fieldMappings[section][fieldId]),
      fieldMappingValue: fieldMappings[section]?.[fieldId],
    });
    
    if (fieldMappings[section] && fieldMappings[section][fieldId]) {
      const fieldKey = fieldMappings[section][fieldId];
      const templateKey = `d.images.${section}.${fieldKey}`;
      const hasImagesKey = `d.hasImages.${section}.${fieldKey}`;
      
      const imageArray = Array.isArray(images) ? images : [];
      const imageCount = imageArray.length;
      
      console.log(`[documents] ✅ Found mapping for ${key} -> ${fieldKey}, creating loopItems...`, {
        imageCount,
        firstImageType: imageArray[0]?._type,
        firstImageFormat: imageArray[0]?.format,
        firstImageHasSource: !!imageArray[0]?.source,
      });
      
      const loopItems = imageArray.map((image, index) => ({
        image,
        index,
        total: imageCount,
        isFirst: index === 0,
        isLast: index === imageCount - 1,
      }));
      
      templateData[templateKey] = loopItems;
      templateData[hasImagesKey] = loopItems.length > 0;
      
      if (!templateData.d.images[section]) {
        templateData.d.images[section] = {};
      }
      if (!templateData.d.hasImages[section]) {
        templateData.d.hasImages[section] = {};
      }
      templateData.d.images[section][fieldKey] = loopItems;
      templateData.d.hasImages[section][fieldKey] = loopItems.length > 0;
    } else {
      console.warn(`[documents] ⚠️ No field mapping found for ${key} (section: ${section}, fieldId: ${fieldId})`);
    }
  });
  
  console.log('[documents] 📊 Final template data images summary:', {
    sections: Object.keys(templateData.d.images || {}),
    totalImageGroups: Object.keys(templateData.d.images || {}).reduce((sum, section) => {
      return sum + Object.keys(templateData.d.images[section] || {}).length;
    }, 0),
  });

  // Add general images array if needed
  templateData['d.images'] = reportData.d?.images || [];

  // Ensure serial_converter data is properly set in template
  // Template uses {{d.indicator.serial_converter.status}} and {{d.indicator.serial_converter.comment}}
  // Check both serial_converter (original) and serial_converter_plug (mapped for frontend)
  let serialConverter = reportData.d?.indicator?.serial_converter;
  
  if (!serialConverter && reportData.d?.indicator?.serial_converter_plug) {
    // If serial_converter doesn't exist, get from serial_converter_plug
    serialConverter = reportData.d.indicator.serial_converter_plug;
    console.log('[documents] ⚠️ serial_converter not found, using serial_converter_plug:', serialConverter);
  }
  
  if (serialConverter) {
    // Ensure indicator section exists
    if (!templateData.d.indicator) {
      templateData.d.indicator = reportData.d?.indicator || {};
    }
    
    // Template uses d.indicator.serial_converter.status, so set serial_converter
    templateData.d.indicator.serial_converter = serialConverter;
    
    // Set in flattened structure (for dot-separated placeholders like d.indicator.serial_converter.status)
    templateData['d.indicator.serial_converter'] = serialConverter;
    templateData['d.indicator.serial_converter.status'] = serialConverter.status || '';
    templateData['d.indicator.serial_converter.comment'] = serialConverter.comment || '';
    templateData['d.indicator.serial_converter.question'] = serialConverter.question || '';
    
    // Remove serial_converter_plug from template data to avoid duplication in DOCX
    // Template only uses serial_converter, not serial_converter_plug
    if (templateData.d.indicator.serial_converter_plug) {
      delete templateData.d.indicator.serial_converter_plug;
    }
    if (templateData['d.indicator.serial_converter_plug']) {
      delete templateData['d.indicator.serial_converter_plug'];
    }
    if (templateData['d.indicator.serial_converter_plug.status']) {
      delete templateData['d.indicator.serial_converter_plug.status'];
    }
    if (templateData['d.indicator.serial_converter_plug.comment']) {
      delete templateData['d.indicator.serial_converter_plug.comment'];
    }
    if (templateData['d.indicator.serial_converter_plug.question']) {
      delete templateData['d.indicator.serial_converter_plug.question'];
    }
    
    console.log('[documents] ✅ Explicitly set serial_converter data:', {
      status: serialConverter.status,
      comment: serialConverter.comment,
      question: serialConverter.question,
      hasNested: !!templateData.d.indicator.serial_converter,
      hasFlattenedStatus: !!templateData['d.indicator.serial_converter.status'],
      hasFlattenedComment: !!templateData['d.indicator.serial_converter.comment'],
    });
  } else {
    console.warn('[documents] ⚠️ serial_converter data not found in reportData.d.indicator');
  }

  // Build inspectionItems array for unified table template
  // Бүх section-уудын бүх field-уудыг нэгтгэж, нэг хүснэгтэд харуулах
  const inspectionItems = [];
  
  // Хавсралтуудыг цуглуулах (тайлбар болон зураг)
  // Хавсралтын дугаарыг давхардахгүйгээр өгөх
  const allAttachments = []; // { number: 1, fieldName: '...', comment: '...', image: {...} }
  let attachmentCounter = 1;
  const attachmentNumberMap = new Map(); // fieldKey -> attachmentNumber mapping
  
  try {
    // Section дараалал (template-д харагдах дараалал)
    const sectionOrder = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
    
    for (const sectionName of sectionOrder) {
      const sectionData = reportData.d?.[sectionName] || {};
    
    // Бүх field-уудыг авна (fieldMappings болон sectionData-аас)
    const processedFields = new Set();
    
    // Эхлээд fieldMappings-аас field-уудыг авна
    if (fieldMappings[sectionName]) {
      for (const fieldId of Object.keys(fieldMappings[sectionName])) {
        const fieldKey = fieldMappings[sectionName][fieldId];
        processedFields.add(fieldKey);
        
        const fieldData = sectionData[fieldKey] || {};
        
        // Field мэдээлэл - БҮХ field-уудыг нэмнэ (status байхгүй ч)
        const status = (fieldData.status || '').toString().trim();
        const question = (fieldData.question || '').toString().trim();
        const fieldName = question || fieldKey; // Question текст байвал ашиглах, эсвэл fieldKey
        
        // Status-аас хамаарч төлөвийн бичвэр (тэмдгийн оронд бүтэн бичвэр)
        let isNormal = '';
        let needsImprovement = '';
        let needsReplacement = '';
        
        // Normalize status: handle "цэвэр" and "цэвэрлэх шаардлагатай"
        // БҮХ status-уудыг шалгах (хоосон биш байвал)
        if (status) {
          const normalizedStatus = status.toLowerCase().trim();
          console.log(`[documents] 🔍 Status check for ${sectionName}.${fieldKey}: "${status}" (normalized: "${normalizedStatus}")`);
          
          if (status === '+' || status === 'Хэвийн' || normalizedStatus === 'normal' || normalizedStatus === 'хэвийн' || normalizedStatus === 'цэвэр') {
            isNormal = 'Хэвийн';
          } else if (status === 'Сайжруулах шаардлагатай' || normalizedStatus.includes('сайжруулах') || normalizedStatus.includes('цэвэрлэх шаардлагатай') || normalizedStatus.includes('improve')) {
            needsImprovement = 'Сайжруулах шаардлагатай';
          } else if (status === 'Солих шаардлагатай' || normalizedStatus.includes('солих') || normalizedStatus.includes('replace')) {
            needsReplacement = 'Солих шаардлагатай';
          } else {
            console.log(`[documents] ⚠️ Unknown status for ${sectionName}.${fieldKey}: "${status}"`);
          }
        } else {
          console.log(`[documents] ⚠️ Empty status for ${sectionName}.${fieldKey} - will add item without status markers`);
        }
        
        // Зураг эсвэл тайлбар байвал хавсралт үүсгэх
        let attachmentText = '';
        let attachmentNumber = null;
        const imageKey = `${sectionName}.${fieldId}`;
        const fieldImages = imagesBySectionField[imageKey] || [];
        const comment = (fieldData.comment || '').toString().trim();
        const hasImages = fieldImages.length > 0;
        const hasComment = comment.length > 0;
        
        
        // Хэрвээ зураг эсвэл тайлбар байвал хавсралт үүсгэх
        if (hasImages || hasComment) {
          // Хавсралтын дугаарыг давхардахгүйгээр өгөх
          const fieldKeyForAttachment = `${sectionName}.${fieldKey}`;
          if (!attachmentNumberMap.has(fieldKeyForAttachment)) {
            attachmentNumber = attachmentCounter++;
            attachmentNumberMap.set(fieldKeyForAttachment, attachmentNumber);
            
            // Хавсралтын мэдээллийг цуглуулах
            // 1 field-д 1 л зураг байгаа тул зөвхөн эхний зургийг авна
            const firstImage = hasImages ? fieldImages[0] : null;
            
            // Attachment object үүсгэх (section/fieldId/fieldKey нь d.repair холбоход хэрэгтэй)
            const attachmentObj = {
              number: attachmentNumber,
              fieldName: fieldName,
              section: sectionName,
              fieldId: fieldId,
              fieldKey: fieldKey,
            };
            
            // Тайлбар байвал нэмэх (байхгүй ч хоосон string үлдээж before_text зөв ажиллана)
            attachmentObj.comment = (comment && comment.trim().length > 0) ? comment.trim() : '';
            
            // Зураг байвал нэмэх
            // CRITICAL: Use createImageContent to properly process image for easy-template-x
            if (firstImage) {
              console.log(`[documents] 🔍 Processing firstImage for attachment ${attachmentNumber}:`, {
                fieldName,
                firstImageType: typeof firstImage,
                firstImageHasBuffer: !!(firstImage.buffer),
                firstImageHasBase64: !!(firstImage.base64),
                firstImageMimeType: firstImage.mimeType,
                firstImageIsImageContent: firstImage._type === 'image',
              });
              
              // Check if firstImage is already processed image content or raw image data
              let imageContent;
              if (firstImage._type === 'image' && firstImage.source) {
                // Already processed by groupImagesBySectionAndField
                console.log(`[documents] ✅ Using already processed image content`);
                imageContent = firstImage;
              } else {
                // Need to process raw image data
                console.log(`[documents] 🔄 Processing raw image data with createImageContent`);
                imageContent = await createImageContent(firstImage);
              }
              
              if (imageContent) {
                attachmentObj.image = imageContent;
                console.log(`[documents] ✅ Created image content for attachment ${attachmentNumber}:`, {
                  fieldName: fieldName,
                  imageType: imageContent._type,
                  imageFormat: imageContent.format,
                  imageWidth: imageContent.width,
                  imageHeight: imageContent.height,
                  sourceIsBuffer: Buffer.isBuffer(imageContent.source),
                  sourceLength: imageContent.source?.length,
                });
              } else {
                console.warn(`[documents] ⚠️ Failed to create image content for attachment ${attachmentNumber}:`, {
                  fieldName,
                  firstImageKeys: Object.keys(firstImage || {}),
                });
              }
            } else {
              console.warn(`[documents] ⚠️ No firstImage available for attachment ${attachmentNumber}:`, {
                fieldName,
                fieldImagesCount: fieldImages.length,
              });
            }
            
            allAttachments.push(attachmentObj);
          } else {
            attachmentNumber = attachmentNumberMap.get(fieldKeyForAttachment);
          }
          
          attachmentText = `Хавсралт №${attachmentNumber}`;
        }
        
        // Хоосон field-уудыг шүүх - зөвхөн fieldName байгаа эсвэл question байгаа field-уудыг нэмнэ
        // Section нэрнүүдийг шүүх - fieldKey нь section нэртэй ижил биш байх ёстой
        if (!fieldName || fieldName.trim() === '' || fieldName === fieldKey) {
          console.log(`[documents] ⏭️ Skipping empty field: ${sectionName}.${fieldId} -> ${fieldKey} (fieldName: "${fieldName}")`);
          continue; // Skip this field
        }
        
        // Inspection item үүсгэх - БҮХ field-уудыг нэмнэ (status байхгүй ч)
        const item = {
          fieldName: fieldName,
          isNormal: isNormal,
          needsImprovement: needsImprovement,
          needsReplacement: needsReplacement,
          attachmentText: attachmentText,
        };
        inspectionItems.push(item);
        console.log(`[documents] ✅ Added item from fieldMappings: ${sectionName}.${fieldId} -> ${fieldKey}`, {
          fieldName,
          status: status || '(no status)',
          isNormal,
          needsImprovement,
          needsReplacement,
          hasImages: fieldImages.length > 0,
        });
      }
    }
    
    // Дараа нь sectionData-аас үлдсэн field-уудыг авна (fieldMappings-д байхгүй)
    // Section нэрнүүдийг шүүх - зөвхөн field-уудыг нэмнэ
    const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt', 'exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
    for (const fieldKey of Object.keys(sectionData)) {
      if (!processedFields.has(fieldKey) && !excludedKeys.includes(fieldKey)) {
        const fieldData = sectionData[fieldKey] || {};
        
        // БҮХ object field-уудыг нэмнэ (status, comment, question агуулсан эсвэл байхгүй ч)
        if (fieldData && typeof fieldData === 'object') {
          const status = (fieldData.status || '').toString().trim();
          const question = (fieldData.question || '').toString().trim();
          const fieldName = question || fieldKey;
          
          // Хоосон field-уудыг шүүх - зөвхөн fieldName байгаа эсвэл question байгаа field-уудыг нэмнэ
          if (!fieldName || fieldName.trim() === '' || fieldName === fieldKey) {
            continue; // Skip this field
          }
          
          // Status-аас хамаарч төлөвийн тэмдэг
          let isNormal = '';
          let needsImprovement = '';
          let needsReplacement = '';
          
          // Normalize status: handle "цэвэр" and "цэвэрлэх шаардлагатай"
          // БҮХ status-уудыг шалгах (хоосон биш байвал)
          if (status) {
            const normalizedStatus = status.toLowerCase().trim();
            console.log(`[documents] 🔍 Status check for ${sectionName}.${fieldKey}: "${status}" (normalized: "${normalizedStatus}")`);
            
            if (status === '+' || status === 'Хэвийн' || normalizedStatus === 'normal' || normalizedStatus === 'хэвийн' || normalizedStatus === 'цэвэр') {
              isNormal = 'Хэвийн';
            } else if (status === 'Сайжруулах шаардлагатай' || normalizedStatus.includes('сайжруулах') || normalizedStatus.includes('цэвэрлэх шаардлагатай') || normalizedStatus.includes('improve')) {
              needsImprovement = 'Сайжруулах шаардлагатай';
            } else if (status === 'Солих шаардлагатай' || normalizedStatus.includes('солих') || normalizedStatus.includes('replace')) {
              needsReplacement = 'Солих шаардлагатай';
            }
          }
          
          // Зураг эсвэл тайлбар байвал хавсралт үүсгэх
          let attachmentText = '';
          let attachmentNumber = null;
          // Field ID-г олох (fieldKey-аас эсвэл imagesBySectionField-аас)
          let foundFieldId = fieldKey;
          Object.keys(imagesBySectionField).forEach((key) => {
            const [section, fieldId] = key.split('.');
            if (section === sectionName && fieldMappings[sectionName] && fieldMappings[sectionName][fieldId] === fieldKey) {
              foundFieldId = fieldId;
            }
          });
          const imageKey = `${sectionName}.${foundFieldId}`;
          const fieldImages = imagesBySectionField[imageKey] || [];
          
          console.log(`[documents] 🔍 Checking images for attachment (sectionData): ${sectionName}.${fieldKey}`, {
            imageKey,
            foundFieldId,
            fieldKey,
            fieldImagesCount: fieldImages.length,
            availableImageKeys: Object.keys(imagesBySectionField),
          });
          const comment = (fieldData.comment || '').toString().trim();
          const hasImages = fieldImages.length > 0;
          const hasComment = comment.length > 0;
          
          // Хэрвээ зураг эсвэл тайлбар байвал хавсралт үүсгэх
          if (hasImages || hasComment) {
            // Хавсралтын дугаарыг давхардахгүйгээр өгөх
            const fieldKeyForAttachment = `${sectionName}.${fieldKey}`;
            if (!attachmentNumberMap.has(fieldKeyForAttachment)) {
              attachmentNumber = attachmentCounter++;
              attachmentNumberMap.set(fieldKeyForAttachment, attachmentNumber);
              
              // Хавсралтын мэдээллийг цуглуулах
              // 1 field-д 1 л зураг байгаа тул зөвхөн эхний зургийг авна
              const firstImage = hasImages ? fieldImages[0] : null;
              
              // Attachment object үүсгэх (section/fieldId/fieldKey нь d.repair холбоход хэрэгтэй)
              const attachmentObj = {
                number: attachmentNumber,
                fieldName: fieldName,
                section: sectionName,
                fieldId: foundFieldId,
                fieldKey: fieldKey,
              };
              attachmentObj.comment = (comment && comment.trim().length > 0) ? comment.trim() : '';
              
              // Зураг байвал нэмэх
              // CRITICAL: Use createImageContent to properly process image for easy-template-x
              if (firstImage) {
                console.log(`[documents] 🔍 Processing firstImage for attachment ${attachmentNumber} (sectionData):`, {
                  fieldName,
                  firstImageType: typeof firstImage,
                  firstImageHasBuffer: !!(firstImage.buffer),
                  firstImageHasBase64: !!(firstImage.base64),
                  firstImageMimeType: firstImage.mimeType,
                  firstImageIsImageContent: firstImage._type === 'image',
                });
                
                // Check if firstImage is already processed image content or raw image data
                let imageContent;
                if (firstImage._type === 'image' && firstImage.source) {
                  // Already processed by groupImagesBySectionAndField
                  console.log(`[documents] ✅ Using already processed image content (sectionData)`);
                  imageContent = firstImage;
                } else {
                  // Need to process raw image data
                  console.log(`[documents] 🔄 Processing raw image data with createImageContent (sectionData)`);
                  imageContent = await createImageContent(firstImage);
                }
                
                if (imageContent) {
                  attachmentObj.image = imageContent;
                  console.log(`[documents] ✅ Created image content for attachment ${attachmentNumber} (sectionData):`, {
                    fieldName: fieldName,
                    imageType: imageContent._type,
                    imageFormat: imageContent.format,
                    imageWidth: imageContent.width,
                    imageHeight: imageContent.height,
                    sourceIsBuffer: Buffer.isBuffer(imageContent.source),
                    sourceLength: imageContent.source?.length,
                  });
                } else {
                  console.warn(`[documents] ⚠️ Failed to create image content for attachment ${attachmentNumber} (sectionData):`, {
                    fieldName,
                    firstImageKeys: Object.keys(firstImage || {}),
                  });
                }
              } else {
                console.warn(`[documents] ⚠️ No firstImage available for attachment ${attachmentNumber} (sectionData):`, {
                  fieldName,
                  fieldImagesCount: fieldImages.length,
                });
              }
              
              allAttachments.push(attachmentObj);
            } else {
              attachmentNumber = attachmentNumberMap.get(fieldKeyForAttachment);
            }
            
            attachmentText = `Хавсралт №${attachmentNumber}`;
          }
          
          // Inspection item үүсгэх - БҮХ field-уудыг нэмнэ (status байхгүй ч)
          const item = {
            fieldName: fieldName,
            isNormal: isNormal,
            needsImprovement: needsImprovement,
            needsReplacement: needsReplacement,
            attachmentText: attachmentText,
          };
          inspectionItems.push(item);
        }
      }
    }
    } // Close the outer for loop from line 1441
    
    // Хоосон item-уудыг шүүх (fieldName хоосон эсвэл зөвхөн fieldKey байвал)
    // БҮХ field-уудыг үлдээх (status байхгүй ч)
    const filteredItems = inspectionItems.filter(item => {
      // Зөвхөн fieldName байгаа эсэхийг шалгах
      const hasFieldName = item.fieldName && item.fieldName.trim() !== '';
      
      // Section нэрнүүдийг шүүх
      const isSectionName = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'].includes(item.fieldName?.toLowerCase());
      
      return hasFieldName && !isSectionName;
    });
    
    // Filtered items-ийг inspectionItems-д солих
    inspectionItems.length = 0;
    inspectionItems.push(...filteredItems);
    
    // Template-д эхний давталтанд header хүснэгт үүсгэхэд зориулж isFirst, isLast, index, total property-уудыг нэмэх
    inspectionItems.forEach((item, index) => {
      item.isFirst = index === 0;
      item.isLast = index === filteredItems.length - 1;
      item.index = index;
      item.total = filteredItems.length;
      // Template-д заримдаа {{attachm entText}} гэж space-тэй байдаг тул alias нэмнэ
      item['attachm entText'] = item.attachmentText;
    });

    // Хавсралт бүрт d.repair (өмнө/дараа тайлбар, зураг) нэмэх – 1 сарын тайлантай ижил хэлбэр
    // before_text = үзлэгийн хариултын comment (тухайн талбар), after_text = засварын дараах comment (repair.repairDescription)
    for (const att of allAttachments) {
      const repair = repairMapByField.get(`${att.section}.${att.fieldId}`) ||
        (att.fieldKey && repairMapByField.get(`${att.section}.${att.fieldKey}`));
      const sectionMn = SECTION_NAMES_MN[att.section] || att.section;
      let beforeImage = att.image ? att.image : getBlankImageDocx();
      let afterImage = getBlankImageDocx();
      // Өмнөх тайлбар: ҮРГЭЛЖ inspection answer-ийн тухайн талбарын comment (зураг л байсан ч хоосон)
      const beforeText = (att.comment && typeof att.comment === 'string') ? att.comment.trim() : '';
      let afterText = '';
      let beforeImageAlt = att.fieldName ? `Өмнөх - ${att.fieldName}` : 'Өмнөх';
      let afterImageAlt = '';
      // Зөвхөн энэ талбарт харьяалагдах засвар байвал дараах тайлбар/зургийг нэмнэ (fieldId эсвэл fieldKey таарна)
      if (repair && repair.section === att.section && (repair.fieldId === att.fieldId || repair.fieldId === att.fieldKey)) {
        afterText = (repair.repairDescription && typeof repair.repairDescription === 'string') ? repair.repairDescription.trim() : '';
        if (repair.images && repair.images.length > 0) {
          const imgUrl = repair.images[0].imageUrl || '';
          const relPath = normalizeRelativePath(imgUrl);
          if (relPath) {
            try {
              const payload = await loadImagePayload(relPath);
              const buf = payload?.buffer || (payload?.base64 ? Buffer.from(payload.base64, 'base64') : null);
              const mimeType = payload?.mimeType || inferMimeType(relPath) || 'image/png';
              if (buf && buf.length > 0) {
                const afterContent = await createImageContent({ buffer: buf, mimeType });
                if (afterContent) {
                  afterImage = afterContent;
                  afterImageAlt = att.fieldName ? `Дараах - ${att.fieldName}` : 'Дараах';
                }
              }
            } catch (e) {
              console.warn('[documents] Repair after_image load failed:', imgUrl, e.message);
            }
          }
        }
      }
      att.d = {
        repair: {
          section: sectionMn,
          field: att.fieldName || '',
          before_text: beforeText,
          after_text: afterText,
          before_image: beforeImage,
          after_image: afterImage,
          before_image_alt: beforeImageAlt,
          after_image_alt: afterImageAlt,
        },
      };
      att['d.repair.section'] = sectionMn;
      att['d.repair.field'] = att.fieldName || '';
      att['d.repair.before_text'] = beforeText;
      att['d.repair.after_text'] = afterText;
      att['d.repair.before_image'] = beforeImage;
      att['d.repair.after_image'] = afterImage;
      att['d.repair.before_image_alt'] = beforeImageAlt;
      att['d.repair.after_image_alt'] = afterImageAlt;
    }
  } catch (inspectionItemsError) {
    console.error('[documents] ❌ Error building inspectionItems array:', inspectionItemsError);
    console.error('[documents] Error stack:', inspectionItemsError.stack);
    // Алдаа гарвал хоосон array үлдээх - const тул дахин тодорхойлох боломжгүй
    // inspectionItems = []; // const тул боломжгүй
  }
  
  // Template data-д inspectionItems нэмэх
  // CRITICAL: Array-уудыг зөвхөн nested structure-д нэмэх, flatten хийхгүй
  // easy-template-x array-уудыг nested structure-аас олдог
  // ТЭМДЭГЛЭЛ: Үзлэгийн тайлангийн header болон давталт НЭГ хүснэгт дотор байх ёстой.
  // Template (.docx) дотор: нэг <w:tbl> дотор 1-р мөр = header (Хэвийн, Сайжруулах...), 2-р мөр = {{#d.inspectionItems}}...{{/d.inspectionItems}} байрлуулна. Хоёр тусдаа хүснэгт байвал header болон давталт салж харагдана.
  if (!templateData.d) {
    templateData.d = {};
  }
  templateData.d.inspectionItems = inspectionItems;
  
  // CRITICAL: Also add flattened version for easy-template-x compatibility
  // Easy-template-x might need both nested and flattened versions
  templateData['d.inspectionItems'] = inspectionItems;
  
  // Template data-д attachments нэмэх
  // Хавсралтуудыг хүснэгтийн доор харуулах
  templateData.d.attachments = allAttachments;
  templateData['d.attachments'] = allAttachments;
  
  // CRITICAL: Also add flattened versions for each attachment's image and d.repair (хавсралтын хүснэгт)
  allAttachments.forEach((att, index) => {
    if (att.image) {
      templateData[`d.attachments.${index}.image`] = att.image;
      if (att.imageAltText) {
        templateData[`d.attachments.${index}.imageAltText`] = att.imageAltText;
      }
    } else {
      console.warn(`[documents] ⚠️ Attachment ${index} has no image:`, {
        number: att.number,
        fieldName: att.fieldName,
        hasComment: !!att.comment,
      });
    }
    if (att.d && att.d.repair) {
      templateData[`d.attachments.${index}.d.repair.section`] = att.d.repair.section;
      templateData[`d.attachments.${index}.d.repair.field`] = att.d.repair.field;
      templateData[`d.attachments.${index}.d.repair.before_text`] = att.d.repair.before_text;
      templateData[`d.attachments.${index}.d.repair.after_text`] = att.d.repair.after_text;
      templateData[`d.attachments.${index}.d.repair.before_image`] = att.d.repair.before_image;
      templateData[`d.attachments.${index}.d.repair.after_image`] = att.d.repair.after_image;
      templateData[`d.attachments.${index}.d.repair.before_image_alt`] = att.d.repair.before_image_alt;
      templateData[`d.attachments.${index}.d.repair.after_image_alt`] = att.d.repair.after_image_alt;
    }
  });
  

  let buffer;
  try {
    
    // CRITICAL: Preserve embedded images (like logo) from template
    // Extract embedded images and related files from template before processing
    let embeddedFiles = {};
    try {
      const JSZip = require('jszip');
      const templateZip = await JSZip.loadAsync(templateFile);
      
      // Extract all files that need to be preserved:
      // 1. Images from word/media/ folder
      // 2. Relationships from word/_rels/document.xml.rels
      // 3. Header/footer files (may contain embedded images)
      // 4. Any other media-related files
      const filesToPreserve = [];
      templateZip.forEach((relativePath, file) => {
        if (!file.dir) {
          // Preserve all media files
          if (relativePath.startsWith('word/media/')) {
            filesToPreserve.push(relativePath);
          }
          // Preserve relationships file (contains image references)
          else if (relativePath === 'word/_rels/document.xml.rels') {
            filesToPreserve.push(relativePath);
          }
          // Preserve header/footer files (may contain embedded images)
          else if (relativePath.startsWith('word/header') || relativePath.startsWith('word/footer')) {
            filesToPreserve.push(relativePath);
          }
          // Preserve header/footer relationship files
          else if (relativePath.includes('header') && relativePath.includes('.rels')) {
            filesToPreserve.push(relativePath);
          }
          else if (relativePath.includes('footer') && relativePath.includes('.rels')) {
            filesToPreserve.push(relativePath);
          }
        }
      });
      
      console.log('[documents] 🔍 Found files to preserve in template:', filesToPreserve.length);
      
      // Store all files
      let mediaFileCount = 0;
      for (const filePath of filesToPreserve) {
        const fileBuffer = await templateZip.file(filePath)?.async('nodebuffer');
        if (fileBuffer) {
          embeddedFiles[filePath] = fileBuffer;
          if (filePath.startsWith('word/media/')) {
            mediaFileCount++;
            console.log(`[documents] ✅ Preserved media file: ${filePath} (${fileBuffer.length} bytes)`);
          } else {
            console.log(`[documents] ✅ Preserved file: ${filePath} (${fileBuffer.length} bytes)`);
          }
        }
      }
      console.log(`[documents] 🔍 Preserved ${mediaFileCount} media files from template`);
    } catch (extractError) {
      console.warn('[documents] ⚠️ Failed to extract embedded files from template:', extractError.message);
      console.warn('[documents] Error stack:', extractError.stack);
      // Continue anyway - template processing will still work
    }
    
    buffer = await templateHandler.process(templateFile, templateData);
    console.log('[documents] ✅ Template processed successfully, buffer length:', buffer.length);
    
    // Restore embedded files to processed buffer
    if (Object.keys(embeddedFiles).length > 0) {
      try {
        const JSZip = require('jszip');
        const processedZip = await JSZip.loadAsync(buffer);
        
        // Handle document.xml.rels separately - merge instead of overwrite
        const relsPath = 'word/_rels/document.xml.rels';
        let originalRels = null;
        if (embeddedFiles[relsPath]) {
          originalRels = embeddedFiles[relsPath].toString('utf8');
          delete embeddedFiles[relsPath]; // Remove from embeddedFiles to handle separately
        }
        
        // Add back preserved files
        // CRITICAL: ALWAYS restore ALL media files from template to ensure logo displays correctly
        // Strategy: Template files are the source of truth - always restore them
        // This ensures logo and other template images are never lost
        let restoredCount = 0;
        let mediaRestoredCount = 0;
        let headerFooterRestoredCount = 0;
        for (const [filePath, fileBuffer] of Object.entries(embeddedFiles)) {
          // Skip document.xml.rels - handled separately
          if (filePath === 'word/_rels/document.xml.rels' || filePath.includes('.rels')) {
            // Handle relationship files separately if needed
            if (filePath !== 'word/_rels/document.xml.rels') {
              // Restore other relationship files (header/footer rels)
              processedZip.file(filePath, fileBuffer);
              restoredCount++;
              console.log(`[documents] ✅ Restored relationship file: ${filePath} (${fileBuffer.length} bytes)`);
            }
            continue;
          }
          
          // ALWAYS restore template media files - they are the source of truth
          processedZip.file(filePath, fileBuffer);
          restoredCount++;
          if (filePath.startsWith('word/media/')) {
            mediaRestoredCount++;
            console.log(`[documents] ✅ Restored template media file: ${filePath} (${fileBuffer.length} bytes)`);
          } else if (filePath.startsWith('word/header') || filePath.startsWith('word/footer')) {
            headerFooterRestoredCount++;
            console.log(`[documents] ✅ Restored header/footer file: ${filePath} (${fileBuffer.length} bytes)`);
          } else {
            console.log(`[documents] ✅ Restored template file: ${filePath} (${fileBuffer.length} bytes)`);
          }
        }
        
        console.log(`[documents] 🔍 Restored ${restoredCount} template files (${mediaRestoredCount} media, ${headerFooterRestoredCount} header/footer)`);
        
        // Merge document.xml.rels if we have both original and processed versions
        if (originalRels) {
          const processedRelsFile = processedZip.file(relsPath);
          if (processedRelsFile) {
            const processedRels = await processedRelsFile.async('string');
            
            // Debug: Log original relationships for logo detection
            const originalMediaCount = (originalRels.match(/media\//g) || []).length;
            const processedMediaCount = (processedRels.match(/media\//g) || []).length;
            console.log(`[documents] 🔍 document.xml.rels merge: original has ${originalMediaCount} media refs, processed has ${processedMediaCount} media refs`);
            
            const mergedRels = mergeDocumentRels(originalRels, processedRels);
            const mergedMediaCount = (mergedRels.match(/media\//g) || []).length;
            console.log(`[documents] 🔍 After merge: ${mergedMediaCount} media refs in merged file`);
            
            processedZip.file(relsPath, mergedRels);
            console.log(`[documents] ✅ Merged document.xml.rels to preserve logo and attachments`);
          } else {
            // If processed version doesn't exist, use original
            processedZip.file(relsPath, originalRels);
            console.log(`[documents] ✅ Restored document.xml.rels (no processed version found)`);
          }
        }
        
        // Generate new buffer with restored files
        buffer = await processedZip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 }
        });
        
        console.log('[documents] ✅ Embedded files restored, new buffer length:', buffer.length);
      } catch (restoreError) {
        console.warn('[documents] ⚠️ Failed to restore embedded files:', restoreError.message);
        console.warn('[documents] Error stack:', restoreError.stack);
        // Continue with processed buffer - images might still be there
      }
    }
    
    // Validate buffer is a valid DOCX file
    if (!buffer || buffer.length === 0) {
      throw new Error('Template processing returned empty buffer');
    }
    
    // Check if buffer starts with ZIP signature (DOCX files are ZIP archives)
    const zipSignature = buffer.slice(0, 2);
    if (zipSignature[0] !== 0x50 || zipSignature[1] !== 0x4B) {
      throw new Error('Template processing returned invalid DOCX file (missing ZIP signature)');
    }
    
    // Debug: Extract and check document.xml to see if loop was processed
    try {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file('word/document.xml')?.async('string');
      if (documentXml) {
        const hasFieldNameInXml = documentXml.includes('Тавцангийн лист') || documentXml.includes('sensor_base');
        const hasLoopPlaceholder = documentXml.includes('{{fieldName}}') || documentXml.includes('{{#d.inspectionItems}}');
        const hasLoopProcessed = !hasLoopPlaceholder && hasFieldNameInXml;
        console.log('[documents] 🔍 Document XML check:', {
          hasFieldNameInXml,
          hasLoopPlaceholder,
          hasLoopProcessed,
          xmlLength: documentXml.length,
          xmlPreview: documentXml.substring(0, 1000),
        });
      }
    } catch (zipError) {
      console.warn('[documents] ⚠️ Could not check document.xml:', zipError.message);
    }
    
    // Debug: Check if buffer contains inspection items (basic check)
    const bufferString = buffer.toString('utf8', 0, Math.min(10000, buffer.length));
    const hasFieldName = bufferString.includes('Тавцангийн лист') || bufferString.includes('sensor_base');
    const hasLoopContent = bufferString.includes('{{fieldName}}') === false; // Loop processed if placeholder gone
    console.log('[documents] 🔍 Buffer check:', {
      hasFieldName,
      hasLoopContent,
      bufferLength: buffer.length,
      isValidZip: zipSignature[0] === 0x50 && zipSignature[1] === 0x4B,
      bufferPreview: bufferString.substring(0, 500),
    });
  } catch (templateError) {
    console.error('[documents] ❌ Template processing error:', templateError);
    console.error('[documents] Error message:', templateError.message);
    console.error('[documents] Error stack:', templateError.stack);
    if (templateError.openDelimiterText) {
      console.error('[documents] Error at delimiter:', templateError.openDelimiterText);
    }
    if (templateError.lineNumber) {
      console.error('[documents] Error at line:', templateError.lineNumber);
    }
    throw templateError;
  }

    // Post-processing: DOCX файлыг цэвэрлэх
  // Хүснэгтүүдийг merge хийх - идэвхжүүлсэн
  try {
    buffer = await mergeAdjacentTables(buffer);
    buffer = await removeLoopTagTableRows(buffer);
    buffer = await removeDuplicateHeaderTables(buffer);
  } catch (postProcessError) {
    console.error('[documents] ⚠️ Post-processing error (continuing with original buffer):', postProcessError.message);
    // Post-processing алдаа гарвал анхны buffer-ийг ашиглах
  }

  // Хавсралтуудын хоорондох хоосон зайг арилгах - шинэ энгийн, найдвартай функц
  try {
    buffer = await removeRemainingLoopTags(buffer, 'monthly-report');
    buffer = await mergeConsecutiveTables(buffer, 'monthly-report');
    buffer = await removeConsecutiveEmptyParagraphs(buffer);
  } catch (postProcessError) {
    console.error('[documents] ⚠️ removeConsecutiveEmptyParagraphs error (continuing with original buffer):', postProcessError.message);
    // Алдаа гарвал анхны buffer-ийг ашиглах
  }

  return buffer;
}

/**
 * Mammoth/Word-ийн HTML дээрх inline текстийн өнгө, bold (font-weight)-ийг хасна.
 * PDF дээр бүх текст ижил хар, энгийн жинтэй харагдуулах.
 */
function stripInlineTextColorsFromMammothHtml(html) {
  if (!html || typeof html !== 'string') return html;
  return html.replace(/\sstyle=(["'])([^"']*)\1/gi, (full, quote, styleVal) => {
    let s = String(styleVal)
      .replace(/color\s*:\s*[^;]+;?/gi, '')
      .replace(/-webkit-text-fill-color\s*:\s*[^;]+;?/gi, '')
      .replace(/mso-color-alt\s*:\s*[^;]+;?/gi, '')
      .replace(/font-weight\s*:\s*[^;]+;?/gi, '')
      .replace(/;\s*;/g, ';')
      .trim()
      .replace(/^;+|;+$/g, '');
    if (!s) return '';
    return ` style=${quote}${s}${quote}`;
  });
}

/**
 * Үзлэгийн PDF: хэсгийн гарчигуудыг class-аар тэмдэглэн илүү тод хар харуулах.
 */
function addInspectionPdfSectionHeadingClasses(html) {
  if (!html || typeof html !== 'string') return html;
  // Урт текстээс эхэлж шалгана (ж: "Хавсралт:" нь "Хавсралт"-аас өмнө)
  const titles = [
    'Гэрээний мэдээлэл',
    'Гэрээний мэдээл',
    'Ерөнхий мэдээлэл',
    'Үзлэгийн тайлан',
    'Санал тэмдэглэл:',
    'Санал тэмдэглэл',
    'Санал, тэмдэглэл',
    'Хавсралт:',
    'Хавсралт',
    'Гарын үсэг',
  ];
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = html;
  for (const title of titles) {
    const t = escapeRe(title);
    // p/h болон хүснэгтийн нүд (th/td) — Хавсралт, Санал тэмдэглэл ихэвчлэн table-аар гарна
    const re = new RegExp(
      `<(p|h[1-6]|th|td)(\\s[^>]*)?>((?:\\s|<[^/>][^>]*>|<\\/[^>]+>)*)(${t})((?:\\s|<[^/>][^>]*>|<\\/[^>]+>)*)<\\/\\1>`,
      'gi'
    );
    out = out.replace(re, (full, tag, attrs, before, titleMatch, after) => {
      if (/inspection-section-heading/.test(full)) return full;
      const a = attrs || '';
      let merged;
      if (/\bclass\s*=\s*["']([^"']*)["']/i.test(a)) {
        merged = a.replace(/\bclass\s*=\s*["']([^"']*)["']/i, (_, c) => {
          if (/\binspection-section-heading\b/.test(c)) return `class="${c}"`;
          return `class="${c} inspection-section-heading"`;
        });
      } else {
        merged = a ? `${a.trim()} class="inspection-section-heading"` : 'class="inspection-section-heading"';
      }
      return `<${tag} ${merged}>${before}${titleMatch}${after}</${tag}>`;
    });
  }
  return out;
}

/**
 * Generate PDF buffer for a single inspection answer (using the DOCX layout)
 * @param {BigInt} answerId - The inspection answer ID
 * @returns {Promise<Buffer>} Generated PDF file buffer
 */
async function generateInspectionPdf(answerId) {
  const answerIdBigInt = typeof answerId === 'bigint' ? answerId : BigInt(answerId);
  
  // 1) Generate DOCX using existing template (keeps current layout)
  const docxBuffer = await generateInspectionDocx(answerIdBigInt);

  // 2) Convert DOCX -> HTML via mammoth (same approach as monthly PDF)
  const mammothResult = await mammoth.convertToHtml(
    { buffer: docxBuffer },
    {
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.imgElement(image =>
        image.read('base64').then(imageBuffer => ({
          src: `data:${image.contentType};base64,${imageBuffer}`,
        }))
      ),
    }
  );

  let htmlContent = stripInlineTextColorsFromMammothHtml(mammothResult.value);

  // Гарчиг "АВТО ЖИН ХЭМЖҮҮРИЙН ҮЗЛЭГИЙН ХУУДАС" бүхий элементийг тэмдэглэж голлуулах
  htmlContent = htmlContent.replace(/(<(?:h1|p)(?:\s[^>]*)?>)\s*АВТО ЖИН ХЭМЖҮҮРИЙН ҮЗЛЭГИЙН ХУУДАС/gi, (match, openTag) => {
    const hasClass = /class\s*=/.test(openTag);
    const newTag = hasClass ? openTag.replace(/class="([^"]*)"/i, 'class="$1 inspection-main-title"') : openTag.replace('>', ' class="inspection-main-title">');
    return newTag + 'АВТО ЖИН ХЭМЖҮҮРИЙН ҮЗЛЭГИЙН ХУУДАС';
  });

  // Mark attachment tables and inspection report table (Үзлэгийн тайлан) for column-specific styling
  htmlContent = htmlContent.replace(/<table([^>]*)>([\s\S]*?)<\/table>/gi, (match, attrs, content) => {
    const isAttachment = /№/.test(content) && /Ангилал/.test(content) && /Өмнө/.test(content) && /Дараа/.test(content);
    const isInspectionReport = !isAttachment && /Үзлэгийн эд анги/.test(content) && /Төлөв/.test(content);
    let classes = [];
    if (isAttachment) classes.push('attachment-table');
    if (isInspectionReport) classes.push('inspection-report-table');
    if (classes.length === 0) return match;
    const hasClass = /class\s*=/.test(attrs);
    const addClasses = classes.join(' ');
    const newAttrs = hasClass ? attrs.replace(/class="([^"]*)"/i, (_, c) => `class="${c} ${addClasses}"`) : (attrs.trim() + ` class="${addClasses}"`);
    return `<table${newAttrs}>${content}</table>`;
  });

  htmlContent = addInspectionPdfSectionHeadingClasses(htmlContent);

  // 3) Wrap HTML with basic styles and Mongolian font support
  const htmlWithFont = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light">
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    html {
      color-scheme: only light;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Бүх текст ижил бодит хар — Word-оос үлдсэн саарал/theme өнгийг дарна */
    body, body p, body span, body td, body th, body li, body strong, body em, body b, body i,
    body h1, body h2, body h3, body div, body font {
      color: #000000 !important;
      -webkit-text-fill-color: #000000 !important;
    }
    body {
      font-family: "Calibri", "Segoe UI", Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #000000;
    }
    h1, h2, h3 {
      font-family: "Calibri", "Segoe UI", Arial, sans-serif;
      font-weight: 400;
      margin: 0 0 6px 0;
      color: #000000;
    }
    h1 { font-size: 14pt; }
    h2 { font-size: 12pt; }
    h3 { font-size: 11pt; }
    /* Гарчиг: АВТО ЖИН ХЭМЖҮҮРИЙН ҮЗЛЭГИЙН ХУУДАС голлуулах */
    .inspection-main-title,
    h1:first-of-type {
      text-align: center;
    }
    /* Хэсгийн гарчиг: гэрээ, ерөнхий мэдээлэл, үзлэгийн тайлан, хавсралт, санал, гарын үсэг — илүү тод хар */
    .inspection-section-heading {
      color: #000000 !important;
      -webkit-text-fill-color: #000000 !important;
      font-weight: 700 !important;
      font-size: 11pt;
      letter-spacing: 0.015em;
    }
    h2.inspection-section-heading,
    h3.inspection-section-heading {
      font-size: 12pt;
    }
    .inspection-section-heading strong,
    .inspection-section-heading b {
      font-weight: 700 !important;
      color: #000000 !important;
      -webkit-text-fill-color: #000000 !important;
    }
    /* Хавсралт / санал тэмдэглэл нь th|td-д байхад table-ийн ерөнхий 400 жинг давах */
    th.inspection-section-heading,
    td.inspection-section-heading {
      font-weight: 700 !important;
      font-size: 11pt !important;
      color: #000000 !important;
      -webkit-text-fill-color: #000000 !important;
    }
    th.inspection-section-heading strong,
    th.inspection-section-heading b,
    td.inspection-section-heading strong,
    td.inspection-section-heading b {
      font-weight: 700 !important;
    }
    p {
      margin: 2px 0 4px 0;
    }
    table {
      width: 100% !important;
      border-collapse: collapse;
      table-layout: fixed; /* бүх хүснэгтүүдийг нэгэн төрлийн багана өргөнтэй болгох */
      margin-top: 4px;
      margin-bottom: 6px;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 3px 4px;
      vertical-align: top;
      font-size: 9pt;
      font-family: "Calibri", "Segoe UI", Arial, sans-serif;
      font-weight: 400 !important;
      color: #000000 !important;
      -webkit-text-fill-color: #000000 !important;
    }
    /* Word-оос ирсэн <strong>/<b> — PDF дээр энгийн */
    strong, b {
      font-weight: 400 !important;
    }
    th {
      background-color: #e5e7eb;
      font-weight: 400;
    }
    /* Гэрээ/ерөнхий мэдээлэл: толгой мөр голлуулах, зүүн баганыг саарал */
    table:not(.attachment-table):not(.inspection-report-table) th {
      text-align: center;
    }
    table:not(.attachment-table):not(.inspection-report-table) td:first-child {
      background-color: #e5e7eb;
    }
    /* Үзлэгийн тайлан: бүх нүд цагаан өнгөөр, ямар ч саарал/alternate өнгөгүй */
    table.inspection-report-table th,
    table.inspection-report-table td {
      background-color: #ffffff !important;
    }
    table.inspection-report-table tbody tr:nth-child(even) td {
      background-color: #ffffff !important;
    }
    table.inspection-report-table th {
      text-align: center;
    }
    /* Тайлбар/хавсралтын хүснэгтүүдийн мөрүүдийг зөөлөн ялгах */
    tbody tr:nth-child(even) td {
      background-color: #f9fafb;
    }
    table:not(.attachment-table):not(.inspection-report-table) tbody tr:nth-child(even) td:first-child {
      background-color: #e5e7eb;
    }
    img {
      max-width: 220px;
      height: auto !important;
    }
    /* Дээд талын лого зургийг жижигруулж голлуулах */
    body > p:first-child img {
      max-width: 120px;
      display: block;
      margin: 0 auto 12px auto;
    }
    td img {
      display: block;
      margin: 4px auto;
    }
    /* Зөвхөн хавсралтын хүснэгт: №, Ангилал нарийн; Өмнө/Дараа тэнцүү; зураг зөвхөн Өмнө баганад */
    table.attachment-table {
      table-layout: fixed;
    }
    table.attachment-table th:nth-child(1),
    table.attachment-table td:nth-child(1) {
      width: 5%;
      max-width: 36px;
    }
    table.attachment-table th:nth-child(2),
    table.attachment-table td:nth-child(2) {
      width: 14%;
      max-width: 100px;
    }
    table.attachment-table th:nth-child(3),
    table.attachment-table td:nth-child(3) {
      width: 40.5%;
    }
    table.attachment-table th:nth-child(4),
    table.attachment-table td:nth-child(4) {
      width: 40.5%;
    }
    table.attachment-table td:nth-child(3) img {
      max-width: 100%;
      height: auto !important;
    }
    table.attachment-table td:nth-child(4) img {
      max-width: 100%;
      height: auto !important;
    }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

  // 4) Render HTML to PDF with Puppeteer
  let browser;
  try {
    // Lazy-load Puppeteer only when needed (to keep startup fast)
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      headless: 'new',
      protocolTimeout: 600_000,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);
    await page.setContent(htmlWithFont, {
      waitUntil: 'load',
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
// Generate DOCX using Docxtemplater (answer ID)
router.get('/answers/:answerId/docx', authMiddleware, async (req, res) => {
  try {
    const answerId = BigInt(req.params.answerId);
    const buffer = await generateInspectionDocx(answerId);
    const reportData = await buildInspectionReportData(prisma, { answerId: answerId });

    const templatePath = path.join(
      __dirname,
      '..',
      'templates',
      REPORT_TEMPLATE_FILE
    );

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Template file ${REPORT_TEMPLATE_FILE} is missing.`,
      });
    }

    const filename = `inspection-${reportData.inspection.id}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('❌ Error generating inspection DOCX:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      openDelimiterText: error.openDelimiterText,
    });
    
    // Additional debugging for inspectionItems
    if (error.message && error.message.includes('inspectionItems')) {
      console.error('🔍 inspectionItems related error - checking template data:', {
        hasInspectionItems: !!templateData?.d?.inspectionItems,
        inspectionItemsLength: templateData?.d?.inspectionItems?.length || 0,
        inspectionItemsType: typeof templateData?.d?.inspectionItems,
        isArray: Array.isArray(templateData?.d?.inspectionItems),
      });
    }
    
    return res.status(500).json({
      error: 'Failed to generate document',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        name: error.name,
        openDelimiterText: error.openDelimiterText,
      } : undefined,
    });
  }
});

// Generate PDF for a single inspection answer (same layout as DOCX)
router.get('/answers/:answerId/pdf', authMiddleware, async (req, res) => {
  try {
    try {
      req.setTimeout?.(10 * 60 * 1000);
      res.setTimeout?.(10 * 60 * 1000);
    } catch (_) {}

    const answerId = BigInt(req.params.answerId);
    const reportData = await buildInspectionReportData(prisma, { answerId });

    const pdfBuffer = await generateInspectionPdf(answerId);
    const filename = `inspection-${reportData.inspection.id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('❌ Error generating inspection PDF:', error);
    return res.status(500).json({
      error: 'Failed to generate inspection PDF',
      message: error.message,
    });
  }
});

// Manually send inspection DOCX by email from admin-web (per inspection answer)
router.post('/answers/:answerId/email', authMiddleware, async (req, res) => {
  try {
    try {
      req.setTimeout?.(10 * 60 * 1000);
      res.setTimeout?.(10 * 60 * 1000);
    } catch (_) {}

    const answerId = BigInt(req.params.answerId);

    const answer = await prisma.InspectionAnswer.findUnique({
      where: { id: answerId },
      include: {
        inspection: {
          select: {
            id: true,
            title: true,
            organization: {
              select: {
                name: true,
                contactEmail: true,
                contactName: true,
              },
            },
          },
        },
      },
    });

    if (!answer) {
      return res.status(404).json({
        error: 'Not found',
        message: `Inspection answer with ID ${req.params.answerId} does not exist`,
      });
    }

    const inspection = answer.inspection;
    const org = inspection?.organization;

    if (!org || !org.contactEmail) {
      return res.status(400).json({
        error: 'No contact email',
        message:
          'Тухайн үзлэгийн байгууллагад contact_email тохируулаагүй тул mail илгээх боломжгүй байна.',
      });
    }

    const pdfBuffer = await generateInspectionPdf(answerId);

    await sendInspectionCompletionEmail({
      to: org.contactEmail,
      organizationName: org.name || 'Байгууллага',
      inspectionTitle: inspection?.title || `Үзлэг #${inspection.id.toString()}`,
      inspectionId: inspection.id.toString(),
      completedAt: answer.answeredAt || new Date(),
      contactName: org.contactName || null,
      pdfBuffer,
    });

    return res.json({
      message: 'Үзлэгийн тайланг mail-ээр амжилттай илгээлээ.',
    });
  } catch (error) {
    console.error('❌ Error sending inspection PDF email:', error);
    return res.status(500).json({
      error: 'Failed to send inspection email',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

/**
 * Нэг сарын бүх үзлэгүүдийн тайлан үүсгэх (1template.docx ашиглах)
 * @param {BigInt} orgId - Organization ID
 * @param {Number} year - Жил (жишээ: 2024)
 * @param {Number} month - Сар (1-12)
 * @returns {Promise<Buffer>} Generated DOCX buffer
 */
async function generateMonthlyReportDocx(orgId, year, month) {
  // Сарын эхлэл болон төгсгөлийн огноо тооцоолох
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  console.log(`[monthly-report] Generating report for organization ${orgId}, ${year}-${month}`);
  console.log(`[monthly-report] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Тухайн сард хийгдсэн бүх inspection answer-уудыг олох
  const answers = await prisma.InspectionAnswer.findMany({
    where: {
      inspection: {
        site: {
          orgId: BigInt(orgId),
        },
        deletedAt: null,
      },
      answeredAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      inspection: {
        include: {
          contract: { include: { organization: true } },
          site: { include: { organization: true } },
          device: { include: { model: true } },
        },
      },
    },
    orderBy: {
      answeredAt: 'asc',
    },
  });

  console.log(`[monthly-report] Found ${answers.length} inspections for the month`);

  if (answers.length === 0) {
    throw new Error('No inspections found for the specified month');
  }

  // mountly-template.docx файлыг ашиглах
  const MONTHLY_TEMPLATE_FILE = 'mountly-template.docx';
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    MONTHLY_TEMPLATE_FILE
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Monthly template file ${MONTHLY_TEMPLATE_FILE} is missing.`);
  }

  const templateFile = fs.readFileSync(templatePath);
  const normalizedTemplateFile = await normalizeDocxTemplatePlaceholders(
    templateFile,
    'monthly-template'
  );

  // Бүх inspection-уудын мэдээллийг бэлтгэх
  const inspectionsData = [];

  for (const answer of answers) {
    // Нэг үзлэгийн мэдээллийг бэлтгэх
    const reportData = await buildInspectionReportData(prisma, {
      answerId: answer.id,
    });

    console.log(`[monthly-report] Processing inspection answer ${answer.id.toString()}:`, {
      hasExterior: !!reportData.d?.exterior,
      hasIndicator: !!reportData.d?.indicator,
      hasJbox: !!reportData.d?.jbox,
      hasSensor: !!reportData.d?.sensor,
      hasFoundation: !!reportData.d?.foundation,
      hasCleanliness: !!reportData.d?.cleanliness,
      imageCount: reportData.d?.images?.length || 0,
      hasContractor: !!reportData.d?.contractor,
      contractorCompany: reportData.d?.contractor?.company || '(empty)',
      contractorContractNo: reportData.d?.contractor?.contract_no || '(empty)',
      contractorContact: reportData.d?.contractor?.contact || '(empty)',
    });

    // Flatten the d object specifically with 'd' prefix
    const flattenedFields = flattenTemplateFields(reportData.d || {}, 'd');

    // Зургуудыг бэлтгэх
    const rawImages = reportData.d?.images || [];
    console.log(`[monthly-report] Loading images for answer ${answer.id.toString()}:`, {
      totalImages: rawImages.length,
      imagesWithBase64: rawImages.filter(img => img.base64).length,
      imagesBySection: rawImages.reduce((acc, img) => {
        const section = img.section || 'unknown';
        acc[section] = (acc[section] || 0) + 1;
        return acc;
      }, {}),
    });
    
    const imagesBySectionField = await groupImagesBySectionAndField(rawImages);
    
    console.log(`[monthly-report] Grouped images:`, {
      totalGroups: Object.keys(imagesBySectionField).length,
      groups: Object.keys(imagesBySectionField).map(key => ({
        key,
        count: imagesBySectionField[key]?.length || 0,
      })),
    });

    // Field mapping – generateInspectionDocx-тэй ижил, DB-ийн бодит field_id-уудтай тааруулсан
    // DB-ийн inspection_question_images хүснэгтийн DISTINCT field_id утгуудтай нийцэх ёстой
    const fieldMappings = {
      exterior: {
        sensor_base: 'sensor_base',       // exterior section-д байдаг sensor_base field
        beam: 'beam',                     // exterior section-д байдаг beam field
        base: 'base',                     // DB-д exterior.base (1 зураг) байдаг – алдагдахаас сэргийлэх
        platform_plate: 'platform_plate',
        beam_joint_plate: 'beam_joint_plate',
        stop_bolt: 'stop_bolt',
        interplatform_bolts: 'interplatform_bolts',
      },
      indicator: {
        led_display: 'led_display',
        power_plug: 'power_plug',
        seal_bolt: 'seal_bolt',
        buttons: 'buttons',
        junction_wiring: 'junction_wiring',
        serial_converter: 'serial_converter_plug',
        battery: 'battery',
        control_screen: 'control_screen',  // DB-д indicator.control_screen (1 зураг) байдаг
      },
      jbox: {
        box_integrity: 'box_integrity',
        collector_board: 'collector_board',
        wire_tightener: 'wire_tightener',
        resistor_element: 'resistor_element',
        protective_box: 'protective_box',
      },
      sensor: {
        signal_wire: 'signal_wire',
        ball: 'ball',
        base: 'base',
        ball_cup_thin: 'ball_cup_thin',
        plate: 'plate',
      },
      foundation: {
        cross_base: 'cross_base',
        anchor_plate: 'anchor_plate',
        ramp_angle: 'ramp_angle',
        ramp_stopper: 'ramp_stopper',
        ramp: 'ramp',
        slab_base: 'slab_base',
        sensor_base: 'sensor_base',
      },
      cleanliness: {
        under_platform: 'under_platform',
        top_platform: 'top_platform',
        gap_platform_ramp: 'gap_platform_ramp',
        both_sides_area: 'both_sides_area',
      },
    };

    // Нэг үзлэгийн template data бэлтгэх
    const inspectionTemplateData = {
      ...reportData,
      ...flattenedFields,
    };

    // Ensure nested structure exists and preserve original nested data for status/comment access
    if (!inspectionTemplateData.d) {
      inspectionTemplateData.d = reportData.d || {};
    } else {
      // Merge nested structure to ensure status/comment are accessible both ways
      inspectionTemplateData.d = {
        ...reportData.d,
        ...inspectionTemplateData.d,
      };
    }
    if (!inspectionTemplateData.d.images) {
      inspectionTemplateData.d.images = {};
    }
    if (!inspectionTemplateData.d.hasImages) {
      inspectionTemplateData.d.hasImages = {};
    }

    // Ensure all section fields have proper nested structure with status/comment
    Object.keys(fieldMappings).forEach((section) => {
      if (!inspectionTemplateData.d[section]) {
        inspectionTemplateData.d[section] = reportData.d?.[section] || {};
      }
      Object.keys(fieldMappings[section]).forEach((fieldId) => {
        const fieldKey = fieldMappings[section][fieldId];
        if (!inspectionTemplateData.d[section][fieldKey]) {
          // Get from reportData if available
          const originalField = reportData.d?.[section]?.[fieldKey];
          inspectionTemplateData.d[section][fieldKey] = originalField || {
            status: '',
            comment: '',
            question: '',
          };
        }
        // Ensure status and comment exist
        const fieldData = inspectionTemplateData.d[section][fieldKey];
        if (!fieldData.status && fieldData.status !== '') {
          fieldData.status = '';
        }
        if (!fieldData.comment && fieldData.comment !== '') {
          fieldData.comment = '';
        }
        
        // Log if status/comment are missing (for debugging)
        if (!fieldData.status && !fieldData.comment) {
          console.warn(`[monthly-report] ⚠️ Field ${section}.${fieldKey} has no status or comment`);
        }
      });
    });

    // Signature image
    // CRITICAL: Add signature in both nested and flattened structure for template compatibility
    const inspectorSignature = reportData.d?.signatures?.inspector;
    const inspectorImage = await createSignatureImageContent(inspectorSignature);
    if (inspectorImage) {
      // Ensure signatures object exists in nested structure
      if (!inspectionTemplateData.d.signatures) {
        inspectionTemplateData.d.signatures = {};
      }
      // Add to nested structure (for nested placeholders like {{d.signatures.inspector}})
      inspectionTemplateData.d.signatures.inspector = inspectorImage;
      // Add flattened key (for dot-separated placeholders like {{d.signatures.inspector}})
      inspectionTemplateData['d.signatures.inspector'] = inspectorImage;
      console.log(`[monthly-report] ✅ Set d.signatures.inspector image for inspection ${answer.id.toString()} (nested + flattened)`);
    } else {
      console.log(`[monthly-report] ⚠️ No inspector signature found for inspection ${answer.id.toString()}`);
    }

    // FTP image
    const ftpImage = reportData.d?.ftp_image;
    const ftpImageContent = await createSignatureImageContent(ftpImage);
    if (ftpImageContent) {
      ftpImageContent.width = 300;
      ftpImageContent.height = 200;
      inspectionTemplateData['d.ftp_image'] = ftpImageContent;
    }

    // Initialize all field mappings
    Object.keys(fieldMappings).forEach((section) => {
      Object.keys(fieldMappings[section]).forEach((fieldId) => {
        const fieldKey = fieldMappings[section][fieldId];
        const templateKey = `d.images.${section}.${fieldKey}`;
        const hasImagesKey = `d.hasImages.${section}.${fieldKey}`;

        if (!inspectionTemplateData[templateKey]) {
          inspectionTemplateData[templateKey] = [];
        }
        if (inspectionTemplateData[hasImagesKey] === undefined) {
          inspectionTemplateData[hasImagesKey] = false;
        }

        if (!inspectionTemplateData.d.images[section]) {
          inspectionTemplateData.d.images[section] = {};
        }
        if (!inspectionTemplateData.d.hasImages[section]) {
          inspectionTemplateData.d.hasImages[section] = {};
        }
        if (!inspectionTemplateData.d.images[section][fieldKey]) {
          inspectionTemplateData.d.images[section][fieldKey] = [];
        }
        if (inspectionTemplateData.d.hasImages[section][fieldKey] === undefined) {
          inspectionTemplateData.d.hasImages[section][fieldKey] = false;
        }
      });
    });

    // Add actual images
    // Note: images in imagesBySectionField are already processed by createImageContent in groupImagesBySectionAndField
    Object.keys(imagesBySectionField).forEach((key) => {
      const [section, fieldId] = key.split('.');
      const images = imagesBySectionField[key];

      console.log(`[monthly-report] Processing images for ${key}:`, {
        section,
        fieldId,
        imageCount: Array.isArray(images) ? images.length : 0,
        hasMapping: !!(fieldMappings[section] && fieldMappings[section][fieldId]),
      });

      // Try to find matching field - first try direct match, then try reverse lookup
      let fieldKey = null;
      if (fieldMappings[section] && fieldMappings[section][fieldId]) {
        fieldKey = fieldMappings[section][fieldId];
      } else {
        // Try reverse lookup: find the fieldId that maps to fieldId
        // This handles cases where database field_id might differ from template key
        if (fieldMappings[section]) {
          const matchingEntry = Object.entries(fieldMappings[section]).find(
            ([dbFieldId, templateKey]) => dbFieldId === fieldId || templateKey === fieldId
          );
          if (matchingEntry) {
            fieldKey = matchingEntry[1]; // Use template key
            console.log(`[monthly-report] Found reverse mapping: ${fieldId} -> ${fieldKey}`);
          }
        }
      }

      if (fieldKey) {
        const templateKey = `d.images.${section}.${fieldKey}`;
        const hasImagesKey = `d.hasImages.${section}.${fieldKey}`;

        const imageArray = Array.isArray(images) ? images : [];
        const imageCount = imageArray.length;

        // Images are already processed image content objects from groupImagesBySectionAndField
        const loopItems = imageArray.map((image, index) => ({
          image,
          index,
          total: imageCount,
          isFirst: index === 0,
          isLast: index === imageCount - 1,
        }));

        inspectionTemplateData[templateKey] = loopItems;
        inspectionTemplateData[hasImagesKey] = loopItems.length > 0;

        if (!inspectionTemplateData.d.images[section]) {
          inspectionTemplateData.d.images[section] = {};
        }
        if (!inspectionTemplateData.d.hasImages[section]) {
          inspectionTemplateData.d.hasImages[section] = {};
        }
        inspectionTemplateData.d.images[section][fieldKey] = loopItems;
        inspectionTemplateData.d.hasImages[section][fieldKey] = loopItems.length > 0;

        console.log(`[monthly-report] ✅ Added ${imageCount} images for ${section}.${fieldKey}`);
      } else {
        console.warn(`[monthly-report] ⚠️ No mapping found for ${key} (section: ${section}, fieldId: ${fieldId})`);
      }
    });

    // Add general images array
    inspectionTemplateData['d.images'] = reportData.d?.images || [];

    // Ensure serial_converter data is properly set in template
    // Template uses {{d.indicator.serial_converter.status}} and {{d.indicator.serial_converter.comment}}
    // Check both serial_converter (original) and serial_converter_plug (mapped for frontend)
    let serialConverter = reportData.d?.indicator?.serial_converter;
    
    if (!serialConverter && reportData.d?.indicator?.serial_converter_plug) {
      // If serial_converter doesn't exist, get from serial_converter_plug
      serialConverter = reportData.d.indicator.serial_converter_plug;
      console.log(`[monthly-report] ⚠️ serial_converter not found, using serial_converter_plug for inspection ${answer.id.toString()}:`, serialConverter);
    }
    
    if (serialConverter) {
      // Ensure indicator section exists
      if (!inspectionTemplateData.d.indicator) {
        inspectionTemplateData.d.indicator = reportData.d.indicator || {};
      }
      
      // Template uses d.indicator.serial_converter.status, so set serial_converter
      inspectionTemplateData.d.indicator.serial_converter = serialConverter;
      
      // Set in flattened structure (for dot-separated placeholders like d.indicator.serial_converter.status)
      inspectionTemplateData['d.indicator.serial_converter'] = serialConverter;
      inspectionTemplateData['d.indicator.serial_converter.status'] = serialConverter.status || '';
      inspectionTemplateData['d.indicator.serial_converter.comment'] = serialConverter.comment || '';
      inspectionTemplateData['d.indicator.serial_converter.question'] = serialConverter.question || '';
      
      // Remove serial_converter_plug from template data to avoid duplication in DOCX
      // Template only uses serial_converter, not serial_converter_plug
      if (inspectionTemplateData.d.indicator.serial_converter_plug) {
        delete inspectionTemplateData.d.indicator.serial_converter_plug;
      }
      if (inspectionTemplateData['d.indicator.serial_converter_plug']) {
        delete inspectionTemplateData['d.indicator.serial_converter_plug'];
      }
      if (inspectionTemplateData['d.indicator.serial_converter_plug.status']) {
        delete inspectionTemplateData['d.indicator.serial_converter_plug.status'];
      }
      if (inspectionTemplateData['d.indicator.serial_converter_plug.comment']) {
        delete inspectionTemplateData['d.indicator.serial_converter_plug.comment'];
      }
      if (inspectionTemplateData['d.indicator.serial_converter_plug.question']) {
        delete inspectionTemplateData['d.indicator.serial_converter_plug.question'];
      }
      
      console.log(`[monthly-report] ✅ Explicitly set serial_converter data for inspection ${answer.id.toString()}:`, {
        status: serialConverter.status,
        comment: serialConverter.comment,
        question: serialConverter.question,
      });
    } else {
      console.warn(`[monthly-report] ⚠️ serial_converter data not found for inspection ${answer.id.toString()}`);
    }

    // Нэг үзлэгийн inspectionItems болон attachments бэлтгэх
    // (generateInspectionDocx-ийн логикийг ашиглах)
    const inspectionItems = [];
    const allAttachments = [];
    let attachmentCounter = 1;
    const attachmentNumberMap = new Map();
    
    // Засварын мэдээлэл бэлтгэх (attachments-д ашиглах)
    // CRITICAL: Зөвхөн дууссан болон баталгаажсан засваруудыг attachments-д нэмэх
    // Өмнөх хүлээгдэж буй засваруудыг attachments-д нэмэхгүй
    let repairsByField = new Map(); // field-ийн repair data-г хадгалах
    try {
      const repairs = await prisma.Repair.findMany({
      where: {
        inspectionAnswerId: answer.id,
        repairStatus: {
          in: ['COMPLETED', 'VERIFIED'], // Зөвхөн дууссан болон баталгаажсан засварууд
        },
      },
        include: {
          images: {
            orderBy: { uploadedAt: 'asc' },
          },
        },
        orderBy: [
          { section: 'asc' },
          { fieldId: 'asc' },
        ],
      });
      
      // Section name-ийг монгол хэл рүү хөрвүүлэх map
      const sectionNameMap = {
        'exterior': 'Гадаад',
        'indicator': 'Индикатор',
        'jbox': 'J-Box',
        'sensor': 'Мэдрэгч',
        'foundation': 'Суурь',
        'cleanliness': 'Цэвэрлэгээ'
      };
      
      // Repair-үүдийг field-ээр нь group хийх
      for (const repair of repairs) {
        const sectionMongolian = sectionNameMap[repair.section] || repair.section;
        const fieldKey = `${repair.section}.${repair.fieldId}`;
        repairsByField.set(fieldKey, {
          repair: repair,
          sectionMongolian: sectionMongolian,
        });
      }
      
      console.log(`[monthly-report] ✅ Loaded ${repairs.length} completed/verified repairs for inspection ${answer.id.toString()}`);
    } catch (repairError) {
      console.warn(`[monthly-report] ⚠️ Failed to load repair data for inspection ${answer.id.toString()}:`, repairError.message);
    }
    
    try {
      const sectionOrder = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
      
      for (const sectionName of sectionOrder) {
        const sectionData = reportData.d?.[sectionName] || {};
        const processedFields = new Set();
        
        // FieldMappings-аас field-уудыг авна
        if (fieldMappings[sectionName]) {
          for (const fieldId of Object.keys(fieldMappings[sectionName])) {
            const fieldKey = fieldMappings[sectionName][fieldId];
            processedFields.add(fieldKey);
            
            const fieldData = sectionData[fieldKey] || {};
            const status = (fieldData.status || '').toString().trim();
            const question = (fieldData.question || '').toString().trim();
            const fieldName = question || fieldKey;
            
            // Status-аас хамаарч төлөвийн бичвэр
            let isNormal = '';
            let needsImprovement = '';
            let needsReplacement = '';
            
            if (status) {
              const normalizedStatus = status.toLowerCase().trim();
              if (status === '+' || status === 'Хэвийн' || normalizedStatus === 'normal' || normalizedStatus === 'хэвийн' || normalizedStatus === 'цэвэр') {
                isNormal = 'Хэвийн';
              } else if (status === 'Сайжруулах шаардлагатай' || normalizedStatus.includes('сайжруулах') || normalizedStatus.includes('цэвэрлэх шаардлагатай') || normalizedStatus.includes('improve')) {
                needsImprovement = 'Сайжруулах шаардлагатай';
              } else if (status === 'Солих шаардлагатай' || normalizedStatus.includes('солих') || normalizedStatus.includes('replace')) {
                needsReplacement = 'Солих шаардлагатай';
              }
            }
            
            // Хавсралт үүсгэх
            // CRITICAL: Зөвхөн засвар шаардлагатай талбаруудыг хавсралт үүсгэх
            // Хэвийн статустай талбарууд зурагтай ч гэсэн хавсралт үүсгэхгүй (repair data байхгүй бол)
            let attachmentText = '';
            let attachmentNumber = null;
            const imageKey = `${sectionName}.${fieldId}`;
            const fieldImages = imagesBySectionField[imageKey] || [];
            const comment = (fieldData.comment || '').toString().trim();
            const hasImages = fieldImages.length > 0;
            const hasComment = comment.length > 0;
            
            // Зөвхөн засвар шаардлагатай талбаруудыг хавсралт үүсгэх
            // Хэвийн статустай талбаруудыг хавсралт үүсгэхгүй
            const isNormalStatus = isNormal === 'Хэвийн';
            const needsRepair = needsImprovement || needsReplacement;
            
            // Repair data байгаа эсэхийг шалгах
            const fieldKeyForRepair = `${sectionName}.${fieldId}`;
            const repairData = repairsByField.get(fieldKeyForRepair);
            const hasRepairData = repairData && repairData.repair && 
                                  (repairData.repair.repairStatus === 'COMPLETED' || 
                                   repairData.repair.repairStatus === 'VERIFIED');
            
            // Хавсралт үүсгэх нөхцөл:
            // 1. Засвар шаардлагатай (needsImprovement эсвэл needsReplacement) БОЛОН
            // 2. Зураг эсвэл тайлбар байвал
            // ЭСВЭЛ
            // 3. Repair data байвал (COMPLETED/VERIFIED статустай)
            const shouldCreateAttachment = (needsRepair && (hasImages || hasComment)) || hasRepairData;
            
            if (shouldCreateAttachment) {
              const fieldKeyForAttachment = `${sectionName}.${fieldKey}`;
              if (!attachmentNumberMap.has(fieldKeyForAttachment)) {
                attachmentNumber = attachmentCounter++;
                attachmentNumberMap.set(fieldKeyForAttachment, attachmentNumber);
                
                const firstImage = hasImages ? fieldImages[0] : null;
                const attachmentObj = {
                  number: attachmentNumber,
                  fieldName: fieldName,
                  // comment-ийг үргэлж set хийх (хоосон байсан ч) – easy-template-x fallback
                  // resolution-оос parent scope-ийн буруу утга олохоос сэргийлэх
                  comment: comment.trim(),
                };
                
                if (firstImage && firstImage._type === 'image' && firstImage.source) {
                  attachmentObj.image = firstImage;
                  // Alt text нэмэх: Хавсралт №{number} - {fieldName}
                  attachmentObj.imageAltText = `Хавсралт №${attachmentNumber} - ${fieldName}`;
                }
                
                // CRITICAL: Тухайн field-ийн repair data-г attachment-д нэмэх
                // Template дээр {{d.repair.section}}, {{d.repair.field}}, {{d.repair.before_image}}, {{d.repair.after_image}} ашиглаж байна
                // Зөвхөн дууссан болон баталгаажсан засваруудыг attachments-д нэмэх
                // Note: repairData is already fetched above
                
                // Section name-ийг монгол хэл рүү хөрвүүлэх
                const sectionNameMap = {
                  'exterior': 'Гадаад',
                  'indicator': 'Индикатор',
                  'jbox': 'J-Box',
                  'sensor': 'Мэдрэгч',
                  'foundation': 'Суурь',
                  'cleanliness': 'Цэвэрлэгээ'
                };
                const sectionNameMongolian = sectionNameMap[sectionName] || sectionName;
                
                // CRITICAL: Зөвхөн COMPLETED эсвэл VERIFIED статустай засваруудыг attachments-д нэмэх
                // Өмнөх хүлээгдэж буй засваруудыг attachments-д нэмэхгүй
                if (repairData && repairData.repair) {
                  const repairStatus = repairData.repair.repairStatus;
                  const isCompletedOrVerified = repairStatus === 'COMPLETED' || repairStatus === 'VERIFIED';
                  
                  if (!isCompletedOrVerified) {
                    // Зөвхөн COMPLETED эсвэл VERIFIED статустай засваруудыг attachments-д нэмэх
                    // Бусад статустай засваруудыг attachments-д нэмэхгүй
                    console.log(`[monthly-report] ⚠️ Skipping repair with status ${repairStatus} for field ${fieldKeyForRepair} (only COMPLETED/VERIFIED repairs are included in attachments)`);
                    attachmentObj.repair = {
                      section: sectionNameMongolian,
                      field: fieldName,
                      before_text: '',
                      after_text: '',
                      before_image: null,
                      after_image: null,
                      beforeImageAltText: '',
                      afterImageAltText: '',
                    };
                  } else {
                    // Тухайн field-ийн repair data байвал, repair-report-builder-ийн логикийг ашиглах
                    try {
                      const { buildRepairReportData } = require('./repair-report-builder');
                      const specificRepairData = await buildRepairReportData(prisma, answer.inspection.id, repairData.repair.id);
                      
                      if (specificRepairData?.d?.repair) {
                        const repair = specificRepairData.d.repair;
                        attachmentObj.repair = {
                          section: repair.section || sectionNameMongolian,
                          field: repair.field || fieldName,
                          before_text: repair.before_text || '',
                          after_text: repair.after_text || '',
                          before_image: repair.before_image || null, // Зураг object (DOCX-д ашиглах)
                          after_image: repair.after_image || null,   // Зураг object (DOCX-д ашиглах)
                          beforeImageAltText: repair.beforeImageAltText || '',
                          afterImageAltText: repair.afterImageAltText || '',
                        };
                      } else {
                        // Repair data бэлтгэхэд алдаа гарвал хоосон утга өгөх
                        attachmentObj.repair = {
                          section: sectionNameMongolian,
                          field: fieldName,
                          before_text: '',
                          after_text: '',
                          before_image: null,
                          after_image: null,
                          beforeImageAltText: '',
                          afterImageAltText: '',
                        };
                      }
                    } catch (repairBuildError) {
                      console.warn(`[monthly-report] ⚠️ Failed to build repair data for field ${fieldKeyForRepair}:`, repairBuildError.message);
                      // Repair data бэлтгэхэд алдаа гарвал хоосон утга өгөх
                      attachmentObj.repair = {
                        section: sectionNameMongolian,
                        field: fieldName,
                        before_text: '',
                        after_text: '',
                        before_image: null,
                        after_image: null,
                        beforeImageAltText: '',
                        afterImageAltText: '',
                      };
                    }
                  }
                } else {
                  // Тухайн field-ийн repair data байхгүй бол хоосон утга өгөх
                  attachmentObj.repair = {
                    section: sectionNameMongolian,
                    field: fieldName,
                    before_text: '',
                    after_text: '',
                    before_image: null,
                    after_image: null,
                    beforeImageAltText: '',
                    afterImageAltText: '',
                  };
                }
                
                allAttachments.push(attachmentObj);
              } else {
                attachmentNumber = attachmentNumberMap.get(fieldKeyForAttachment);
              }
              
              attachmentText = `Хавсралт №${attachmentNumber}`;
            }
            
            // Inspection item үүсгэх
            if (fieldName && fieldName.trim() !== '' && fieldName !== fieldKey) {
              const item = {
                fieldName: fieldName,
                isNormal: isNormal,
                needsImprovement: needsImprovement,
                needsReplacement: needsReplacement,
                attachmentText: attachmentText,
              };
              inspectionItems.push(item);
            }
          }
        }
      }
      
      // Хоосон item-уудыг шүүх
      const filteredItems = inspectionItems.filter(item => {
        const hasFieldName = item.fieldName && item.fieldName.trim() !== '';
        const isSectionName = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'].includes(item.fieldName?.toLowerCase());
        return hasFieldName && !isSectionName;
      });
      
      inspectionItems.length = 0;
      inspectionItems.push(...filteredItems);
      
      // Template-д эхний давталтанд header хүснэгт үүсгэхэд зориулж isFirst, isLast, index, total property-уудыг нэмэх
      inspectionItems.forEach((item, index) => {
        item.isFirst = index === 0;
        item.isLast = index === filteredItems.length - 1;
        item.index = index;
        item.total = filteredItems.length;
      });
    } catch (inspectionItemsError) {
      console.error('[monthly-report] ❌ Error building inspectionItems array:', inspectionItemsError);
    }
    
    // Нэг үзлэгийн template data-д inspectionItems болон attachments нэмэх
    if (!inspectionTemplateData.d) {
      inspectionTemplateData.d = {};
    }
    inspectionTemplateData.d.inspectionItems = inspectionItems;
    inspectionTemplateData.d.attachments = allAttachments;
    inspectionTemplateData['d.inspectionItems'] = inspectionItems;
    inspectionTemplateData['d.attachments'] = allAttachments;
    
    // CRITICAL: Attachments array-д бүр attachment бүрт өөрийн repair data-г нэмэх
    // Template дээр {{#d.attachments}} loop дотор {{d.repair.section}}, {{d.repair.field}} ашиглаж байна
    // Иймээс attachment object-ийн repair data-г d.repair гэж нэмэх хэрэгтэй
    allAttachments.forEach((attachment, index) => {
      if (attachment.repair) {
        // Attachment object-д d.repair гэж нэмэх (template дээр {{d.repair.section}} ашиглаж байна)
        attachment.d = {
          repair: attachment.repair
        };
        // Flattened version нэмэх
        attachment['d.repair.section'] = attachment.repair.section || '';
        attachment['d.repair.field'] = attachment.repair.field || '';
        attachment['d.repair.section-field'] = attachment.repair.section && attachment.repair.field 
          ? `${attachment.repair.section}-${attachment.repair.field}` 
          : '';
        attachment['d.repair.before_text'] = attachment.repair.before_text || '';
        attachment['d.repair.after_text'] = attachment.repair.after_text || '';
        // Зураг object-үүд (DOCX-д ашиглах) - repair template-ийн адил
        if (attachment.repair.before_image) {
          attachment.d.repair.before_image = attachment.repair.before_image;
          attachment['d.repair.before_image'] = attachment.repair.before_image;
        }
        if (attachment.repair.after_image) {
          attachment.d.repair.after_image = attachment.repair.after_image;
          attachment['d.repair.after_image'] = attachment.repair.after_image;
        }
        // Alt text (template дээр alt text ашиглах боломжтой)
        attachment['d.repair.before_image_alt'] = attachment.repair.beforeImageAltText || '';
        attachment['d.repair.after_image_alt'] = attachment.repair.afterImageAltText || '';
      }

      // CRITICAL: Хавсралт бүрийн зураг/тайлбарыг indexed flattened path-аар нэмэх
      // easy-template-x нь loop дотор зургийг олохын тулд root-оос тооцсон бүтэн замыг шаардана
      // generateInspectionDocx дотор templateData['d.attachments.0.image'] гэж нэмдэгтэй адил
      inspectionTemplateData[`d.attachments.${index}.number`] = attachment.number ?? '';
      inspectionTemplateData[`d.attachments.${index}.fieldName`] = attachment.fieldName || '';
      inspectionTemplateData[`d.attachments.${index}.comment`] = attachment.comment || '';
      if (attachment.image) {
        inspectionTemplateData[`d.attachments.${index}.image`] = attachment.image;
        inspectionTemplateData[`d.attachments.${index}.imageAltText`] = attachment.imageAltText || '';
      }
      if (attachment.repair) {
        inspectionTemplateData[`d.attachments.${index}.repair.section`] = attachment.repair.section || '';
        inspectionTemplateData[`d.attachments.${index}.repair.field`] = attachment.repair.field || '';
        inspectionTemplateData[`d.attachments.${index}.repair.section-field`] = attachment['d.repair.section-field'] || '';
        inspectionTemplateData[`d.attachments.${index}.repair.before_text`] = attachment.repair.before_text || '';
        inspectionTemplateData[`d.attachments.${index}.repair.after_text`] = attachment.repair.after_text || '';
        if (attachment.repair.before_image) {
          inspectionTemplateData[`d.attachments.${index}.repair.before_image`] = attachment.repair.before_image;
        }
        if (attachment.repair.after_image) {
          inspectionTemplateData[`d.attachments.${index}.repair.after_image`] = attachment.repair.after_image;
        }
        inspectionTemplateData[`d.attachments.${index}.repair.before_image_alt`] = attachment.repair.beforeImageAltText || '';
        inspectionTemplateData[`d.attachments.${index}.repair.after_image_alt`] = attachment.repair.afterImageAltText || '';
      }
    });
    
    // d.repair placeholder-уудыг эхний хавсралтын repair data-аас авах
    // (template дотор {{#d.attachments}} loop-оос ГАДНА {{d.repair.*}} ашиглах тохиолдолд)
    // CRITICAL: buildRepairReportData(null) дуудалтыг зогсоосон шалтгаан:
    //   - null-ийн тухайд энэ функц тухайн inspection-ийн ХАМГИЙН СҮҮЛИЙН answer-ийн өгөгдлийг
    //     ашиглан ЭХНИЙ (alphabetical) засварын мэдээллийг буцаадаг.
    //   - Тиймээс loop дахь answer нь хамгийн сүүлийн бус, өмнөх answer байвал
    //     "before_text/before_image" нь тухайн answer-ийнх биш, хамгийн сүүлийн answer-ийнх болдог.
    //   - Хэрэглэгч "өөр үзлэгийн мэдээлэл" гэж хардаг шалтгаан нь энэ.
    // FIX: d.repair-ийг эхний хавсралтаас (allAttachments[0]) авна.
    //   Хавсралт бүр аль хэдийн өөрийн repair data-г attachment.d.repair-т зөв агуулж байна.
    if (!inspectionTemplateData.d) {
      inspectionTemplateData.d = {};
    }
    const firstAttachmentWithRepair = allAttachments.find(att => att.repair);
    if (firstAttachmentWithRepair?.repair) {
      const r = firstAttachmentWithRepair.repair;
      inspectionTemplateData.d.repair = r;
      inspectionTemplateData['d.repair.section'] = r.section || '';
      inspectionTemplateData['d.repair.field'] = r.field || '';
      inspectionTemplateData['d.repair.section-field'] = r.section && r.field ? `${r.section}-${r.field}` : '';
      inspectionTemplateData['d.repair.before_text'] = r.before_text || '';
      inspectionTemplateData['d.repair.after_text'] = r.after_text || '';
      if (r.before_image) {
        inspectionTemplateData.d.repair.before_image = r.before_image;
        inspectionTemplateData['d.repair.before_image'] = r.before_image;
      }
      if (r.after_image) {
        inspectionTemplateData.d.repair.after_image = r.after_image;
        inspectionTemplateData['d.repair.after_image'] = r.after_image;
      }
      inspectionTemplateData['d.repair.before_image_alt'] = r.beforeImageAltText || '';
      inspectionTemplateData['d.repair.after_image_alt'] = r.afterImageAltText || '';
      console.log(`[monthly-report] ✅ d.repair set from first attachment for inspection ${answer.id.toString()}:`, {
        section: r.section || '(empty)',
        field: r.field || '(empty)',
        hasBeforeImage: !!r.before_image,
        hasAfterImage: !!r.after_image,
      });
    } else {
      // Хавсралт байхгүй эсвэл repair data байхгүй үед хоосон утгаар template алдаанаас сэргийлэх
      inspectionTemplateData.d.repair = { section: '', field: '', before_text: '', after_text: '' };
      inspectionTemplateData['d.repair.section'] = '';
      inspectionTemplateData['d.repair.field'] = '';
      inspectionTemplateData['d.repair.section-field'] = '';
      inspectionTemplateData['d.repair.before_text'] = '';
      inspectionTemplateData['d.repair.after_text'] = '';
      inspectionTemplateData['d.repair.before_image_alt'] = '';
      inspectionTemplateData['d.repair.after_image_alt'] = '';
      console.log(`[monthly-report] ℹ️ No repair data for inspection ${answer.id.toString()} (no attachments with repair)`);
    }
    
    // Нэг үзлэгийн мэдээллийг array-д нэмэх
    // Debug: Inspection data-г шалгах
    console.log(`[monthly-report] 📋 Inspection ${answer.id.toString()} template data summary:`, {
      inspectionId: answer.inspection.id.toString(),
      hasRepair: !!inspectionTemplateData.d?.repair,
      repairSection: inspectionTemplateData.d?.repair?.section || 'none',
      repairField: inspectionTemplateData.d?.repair?.field || 'none',
      hasBeforeImage: !!inspectionTemplateData.d?.repair?.before_image,
      hasAfterImage: !!inspectionTemplateData.d?.repair?.after_image,
      beforeImageAltText: inspectionTemplateData['d.repair.before_image_alt'] || 'none',
      afterImageAltText: inspectionTemplateData['d.repair.after_image_alt'] || 'none',
      inspectionItemsCount: inspectionTemplateData.d?.inspectionItems?.length || 0,
      attachmentsCount: inspectionTemplateData.d?.attachments?.length || 0,
    });
    
    inspectionsData.push(inspectionTemplateData);
  }

  // Гэрээний мэдээлэл - эхний үзлэгээс авч template data-д нэмэх
  const firstInspection = inspectionsData[0];
  const contractorInfo = firstInspection?.d?.contractor || {};

  // Debug: Гэрээний мэдээллийг шалгах
  console.log('[monthly-report] 🔍 Contractor info from first inspection:', {
    hasFirstInspection: !!firstInspection,
    hasD: !!firstInspection?.d,
    hasContractor: !!firstInspection?.d?.contractor,
    company: contractorInfo.company || '(empty)',
    contract_no: contractorInfo.contract_no || '(empty)',
    contact: contractorInfo.contact || '(empty)',
  });

  // Template data бэлтгэх - inspections array-ийг дамжуулах
  const templateData = {
    inspections: inspectionsData,
    totalInspections: inspectionsData.length,
    year: year,
    month: month,
    monthName: new Date(year, month - 1).toLocaleString('mn-MN', { month: 'long' }),
    // Гэрээний мэдээлэл давталтын гадна
    // Template дээр {{d.contractor.company}} гэж ашиглах
    d: {
      contractor: {
        company: contractorInfo.company || '',
        contract_no: contractorInfo.contract_no || '',
        contact: contractorInfo.contact || '',
      },
    },
    // Мөн flattened version нэмэх (easy-template-x compatibility)
    'd.contractor.company': contractorInfo.company || '',
    'd.contractor.contract_no': contractorInfo.contract_no || '',
    'd.contractor.contact': contractorInfo.contact || '',
    // Backward compatibility - template дээр {{contractor.company}} гэж ашигласан байж магадгүй
    contractor: {
      company: contractorInfo.company || '',
      contract_no: contractorInfo.contract_no || '',
      contact: contractorInfo.contact || '',
    },
    'contractor.company': contractorInfo.company || '',
    'contractor.contract_no': contractorInfo.contract_no || '',
    'contractor.contact': contractorInfo.contact || '',
  };

  // Debug: Template data-д гэрээний мэдээлэл зөв нэмэгдсэн эсэхийг шалгах
  console.log('[monthly-report] 🔍 Template data contractor info:', {
    'd.contractor.company': templateData.d?.contractor?.company || '(empty)',
    'd.contractor.contract_no': templateData.d?.contractor?.contract_no || '(empty)',
    'd.contractor.contact': templateData.d?.contractor?.contact || '(empty)',
    'd.contractor.company (flattened)': templateData['d.contractor.company'] || '(empty)',
    'd.contractor.contract_no (flattened)': templateData['d.contractor.contract_no'] || '(empty)',
    'd.contractor.contact (flattened)': templateData['d.contractor.contact'] || '(empty)',
    'contractor.company (backward compat)': templateData.contractor?.company || '(empty)',
    'contractor.contract_no (backward compat)': templateData.contractor?.contract_no || '(empty)',
    'contractor.contact (backward compat)': templateData.contractor?.contact || '(empty)',
    'inspections[0].d.contractor.company': inspectionsData[0]?.d?.contractor?.company || '(empty)',
    'inspections[0].d.contractor.contract_no': inspectionsData[0]?.d?.contractor?.contract_no || '(empty)',
    'inspections[0].d.contractor.contact': inspectionsData[0]?.d?.contractor?.contact || '(empty)',
  });

  console.log(`[monthly-report] Template data prepared with ${inspectionsData.length} inspections`);
  
  // Debug: Бүх inspection-уудын repair data-г шалгах
  inspectionsData.forEach((inspection, index) => {
    console.log(`[monthly-report] 🔍 Inspection ${index} repair data:`, {
      hasRepair: !!inspection.d?.repair,
      repairSection: inspection.d?.repair?.section || 'none',
      repairField: inspection.d?.repair?.field || 'none',
      hasBeforeImage: !!inspection.d?.repair?.before_image,
      hasAfterImage: !!inspection.d?.repair?.after_image,
      beforeImageAltText: inspection['d.repair.before_image_alt'] || 'none',
      afterImageAltText: inspection['d.repair.after_image_alt'] || 'none',
    });
  });

  // Template-ийг боловсруулах
  // CRITICAL: Preserve embedded images (like logo) from template
  // Extract embedded images and related files from template before processing
  let embeddedFiles = {};
  try {
    const JSZip = require('jszip');
    const templateZip = await JSZip.loadAsync(normalizedTemplateFile);
    
    // Extract all files that need to be preserved
    const filesToPreserve = [];
    templateZip.forEach((relativePath, file) => {
      if (!file.dir) {
        if (relativePath.startsWith('word/media/')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath === 'word/_rels/document.xml.rels') {
          filesToPreserve.push(relativePath);
        } else if (relativePath.startsWith('word/header') || relativePath.startsWith('word/footer')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath.includes('header') && relativePath.includes('.rels')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath.includes('footer') && relativePath.includes('.rels')) {
          filesToPreserve.push(relativePath);
        }
      }
    });
    
    console.log('[monthly-report] 🔍 Found files to preserve in template:', filesToPreserve.length);
    
    // Store all files
    let mediaFileCount = 0;
    let headerFooterCount = 0;
    for (const filePath of filesToPreserve) {
      const fileBuffer = await templateZip.file(filePath)?.async('nodebuffer');
      if (fileBuffer) {
        embeddedFiles[filePath] = fileBuffer;
        if (filePath.startsWith('word/media/')) {
          mediaFileCount++;
          console.log(`[monthly-report] ✅ Preserved media file: ${filePath} (${fileBuffer.length} bytes)`);
        } else if (filePath.startsWith('word/header') || filePath.startsWith('word/footer')) {
          headerFooterCount++;
          console.log(`[monthly-report] ✅ Preserved header/footer file: ${filePath} (${fileBuffer.length} bytes)`);
        } else {
          console.log(`[monthly-report] ✅ Preserved file: ${filePath} (${fileBuffer.length} bytes)`);
        }
      }
    }
    console.log(`[monthly-report] 🔍 Preserved ${mediaFileCount} media files, ${headerFooterCount} header/footer files from template`);
    
    if (mediaFileCount === 0) {
      console.warn('[monthly-report] ⚠️ WARNING: No media files found in template!');
      console.warn('[monthly-report] ⚠️ Logo might be missing or template needs to be updated.');
    }
  } catch (extractError) {
    console.warn('[monthly-report] ⚠️ Failed to extract embedded files from template:', extractError.message);
    // Continue anyway - template processing will still work
  }
  
  // Template-ийн бүтцийг зөв боловсруулах: header хүснэгт болон loop-ийн мөрүүд нэг хүснэгтэд байх ёстой
  // Энэ нь template-ийг боловсруулахаас өмнө хийгдэнэ
  // Гэхдээ одоогийн код нь post-processing-д merge хийж байгаа тул энд хийх шаардлагагүй
  
  let buffer = await templateHandler.process(normalizedTemplateFile, templateData);
  
  // Restore embedded files to processed buffer
  if (Object.keys(embeddedFiles).length > 0) {
    try {
      const JSZip = require('jszip');
      const processedZip = await JSZip.loadAsync(buffer);
      
      // Handle document.xml.rels separately - merge instead of overwrite
      const relsPath = 'word/_rels/document.xml.rels';
      let originalRels = null;
      if (embeddedFiles[relsPath]) {
        originalRels = embeddedFiles[relsPath].toString('utf8');
        delete embeddedFiles[relsPath]; // Remove from embeddedFiles to handle separately
      }
      
      // Add back preserved files
      // CRITICAL: ALWAYS restore ALL media files from template to ensure logo displays correctly
      // Strategy: Template files are the source of truth - always restore them
      let restoredCount = 0;
      for (const [filePath, fileBuffer] of Object.entries(embeddedFiles)) {
        // Skip document.xml.rels - handled separately
        if (filePath === 'word/_rels/document.xml.rels') {
          continue;
        }
        
        // ALWAYS restore template media files - they are the source of truth
        processedZip.file(filePath, fileBuffer);
        restoredCount++;
        console.log(`[monthly-report] ✅ Restored template file: ${filePath} (${fileBuffer.length} bytes)`);
      }
      
      console.log(`[monthly-report] 🔍 Restored ${restoredCount} template media files`);
      
          // Merge document.xml.rels if we have both original and processed versions
          if (originalRels) {
            const processedRelsFile = processedZip.file(relsPath);
            if (processedRelsFile) {
              const processedRels = await processedRelsFile.async('string');
              
              // Debug: Log original relationships for logo detection
              const originalMediaCount = (originalRels.match(/media\//g) || []).length;
              const processedMediaCount = (processedRels.match(/media\//g) || []).length;
              console.log(`[monthly-report] 🔍 document.xml.rels merge: original has ${originalMediaCount} media refs, processed has ${processedMediaCount} media refs`);
              
              const mergedRels = mergeDocumentRels(originalRels, processedRels);
              const mergedMediaCount = (mergedRels.match(/media\//g) || []).length;
              console.log(`[monthly-report] 🔍 After merge: ${mergedMediaCount} media refs in merged file`);
              
              processedZip.file(relsPath, mergedRels);
              console.log(`[monthly-report] ✅ Merged document.xml.rels to preserve logo and attachments`);
            } else {
              // If processed version doesn't exist, use original
              processedZip.file(relsPath, originalRels);
              console.log(`[monthly-report] ✅ Restored document.xml.rels (no processed version found)`);
            }
          }
      
      // Generate new buffer with restored files
      buffer = await processedZip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      
      console.log('[monthly-report] ✅ Embedded files restored, new buffer length:', buffer.length);
    } catch (restoreError) {
      console.warn('[monthly-report] ⚠️ Failed to restore embedded files:', restoreError.message);
      // Continue with processed buffer - images might still be there
    }
  }

    // Post-processing: DOCX файлыг цэвэрлэх
  // Хүснэгтүүдийг merge хийх шаардлагагүй (template дээр нэгтгэсэн)
  try {
    console.log('[monthly-report] 🔧 Starting post-processing...');
    console.log('[monthly-report] 📊 Buffer size before processing:', buffer?.length || 'undefined');
    
    console.log('[monthly-report] ════════════════════════════════════════════════════');
    console.log('[monthly-report] Step 1: removeLoopTagTableRows (DISABLED FOR TESTING)');
    console.log('[monthly-report] ════════════════════════════════════════════════════');
    // buffer = await removeLoopTagTableRows(buffer);  // ТҮРЭЭР ИДЭВХГҮЙ БОЛГОСОН
    
    console.log('[monthly-report] ════════════════════════════════════════════════════');
    console.log('[monthly-report] ✅ Post-processing completed');
    console.log('[monthly-report] 📊 Buffer size after processing:', buffer?.length || 'undefined');
    // Сарын тайлангийн хувьд header мөрийг бүх үзлэгүүдэд харуулахын тулд removeDuplicateHeaderTables() дуудлагыг устгасан
    // buffer = await removeDuplicateHeaderTables(buffer);
  } catch (postProcessError) {
    console.error('[monthly-report] ❌ Post-processing error (continuing with original buffer):', postProcessError.message);
    console.error('[monthly-report] Error stack:', postProcessError.stack);
    // Post-processing алдаа гарвал анхны buffer-ийг ашиглах
  }

  // Хавсралтуудын хоорондох хоосон зайг арилгах - шинэ энгийн, найдвартай функц
  try {
    buffer = await removeConsecutiveEmptyParagraphs(buffer);
  } catch (postProcessError) {
    console.error('[documents] ⚠️ removeConsecutiveEmptyParagraphs error (continuing with original buffer):', postProcessError.message);
    // Алдаа гарвал анхны buffer-ийг ашиглах
  }

  return buffer;
}

/**
 * Нэг сарын бүх үзлэгүүдийн тайланг PDF хэлбэрээр үүсгэх
 * @param {BigInt} orgId - Organization ID
 * @param {Number} year - Жил (жишээ: 2024)
 * @param {Number} month - Сар (1-12)
 * @returns {Promise<Buffer>} Generated PDF buffer
 */
async function generateMonthlyReportPdf(orgId, year, month) {
  console.log(`[monthly-report-pdf] Generating PDF report for organization ${orgId}, ${year}-${month}`);
  
  try {
    // Эхлээд DOCX үүсгэх
    const docxBuffer = await generateMonthlyReportDocx(orgId, year, month);
    console.log(`[monthly-report-pdf] DOCX generated, size: ${docxBuffer.length} bytes`);
    
    // DOCX-ийг HTML болгох (mammoth ашиглан)
    // StyleMap ашиглан формат, өнгө, font зэргийг хадгалах
    const styleMap = [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "r[style-name='Strong'] => strong",
      "p[style-name='Title'] => h1.title:fresh",
      "p[style-name='Subtitle'] => h2.subtitle:fresh",
    ];
    
    const mammothOptions = {
      styleMap: styleMap,
      includeDefaultStyleMap: true,
      // Mammoth нь DOCX-ийн inline style-ийг HTML inline style attribute-д автоматаар хадгалдаг
      // Бид зөвхөн зургийн тохиргоог зааж байна
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read("base64").then(function(imageBuffer) {
          const imgAttributes = {
            src: "data:" + image.contentType + ";base64," + imageBuffer
          };
          // Зургийн хэмжээ хадгалах (зөвхөн байгаа тохиолдолд)
          if (image.width && typeof image.width === 'number') {
            imgAttributes.width = image.width.toString();
          }
          if (image.height && typeof image.height === 'number') {
            imgAttributes.height = image.height.toString();
          }
          return imgAttributes;
        }).catch(function(error) {
          console.error(`[monthly-report-pdf] Error converting image:`, error);
          // Алдаа гарвал зөвхөн src-тэй буцаана
          return {
            src: "data:" + image.contentType + ";base64,"
          };
        });
      })
    };
    
    const mammothResult = await mammoth.convertToHtml(
      { buffer: docxBuffer },
      mammothOptions
    );
    const htmlContent = mammothResult.value;
    const messages = mammothResult.messages;
    
    if (messages && messages.length > 0) {
      console.log(`[monthly-report-pdf] Mammoth conversion messages:`, messages);
      messages.forEach((msg, idx) => {
        console.log(`[monthly-report-pdf] Message ${idx}:`, msg.type, msg.message);
      });
    }
    
    console.log(`[monthly-report-pdf] HTML converted, length: ${htmlContent.length} characters`);
    
    // Монгол хэлний дэмжлэгтэй HTML бэлтгэх
    // Template-ийн формат, өнгө, font-ийг хадгалах CSS
    const htmlWithFont = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: "Arial", "Times New Roman", "DejaVu Sans", "Mongolian Baiti", sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
      margin: 0;
      padding: 0;
      background-color: #fff;
    }
    /* Template-ийн бүх стиль хадгалах - inline style-ийг дараахгүй */
    p {
      margin: 3px 0;
    }
    /* Table стиль - Template-ийн хэлбэрт тохируулах */
    /* Гэхдээ inline style байгаа тохиолдолд түүнийг ашиглах */
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 10px 0;
    }
    /* Зөвхөн inline style байхгүй тохиолдолд border, padding заах */
    table:not([style*="border"]) {
      border: 1px solid #000;
    }
    table td:not([style]), table th:not([style]) {
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    /* Inline style байгаа тохиолдолд түүнийг ашиглах */
    table td[style], table th[style] {
      /* DOCX-ийн оригинал стиль хадгалах */
    }
    /* Хүснэгтийн header - саарал өнгө (зөвхөн үзлэгийн тайлангийн header) */
    /* Зөвхөн "Үзлэгийн эд анги", "Төлөв", "Хавсралт" текст агуулсан хүснэгтүүдийн header-үүдийг саарал болгох */
    /* JavaScript-ээр хүснэгтийг шалгаж, class нэмэх */
    table.inspection-report-table tr:first-child th,
    table.inspection-report-table tr:first-child td {
      background-color: #D9D9D9 !important;
      color: #000 !important;
      font-weight: bold;
      text-align: center;
    }
    table.inspection-report-table tr:nth-child(2) th,
    table.inspection-report-table tr:nth-child(2) td {
      background-color: #D9D9D9 !important;
      color: #000 !important;
      font-weight: bold;
      text-align: center;
    }
    /* Хүснэгтийн эхний багана (гарчиг) - зөвхөн inline style байхгүй тохиолдолд */
    table tbody td:first-child:not([style*="background"]),
    table td:first-child:not([style*="background"]) {
      background-color: #D9D9D9;
      font-weight: bold;
      width: 30%;
    }
    /* Inline style байгаа элементүүд - DOCX-ийн оригинал стиль хадгалах */
    [style] {
      /* Mammoth-ийн хөрвүүлсэн inline style-ийг хадгалах - CSS override хийхгүй */
    }
    /* Зургийн стиль */
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 5px 0;
    }
    /* Logo - төвд байрлуулах */
    img[alt*="logo"], 
    img[alt*="Logo"],
    img[src*="logo"],
    img[src*="Logo"],
    /* Эхний зураг (logo байх магадлалтай) */
    body > p:first-child img,
    body > div:first-child img {
      display: block;
      margin: 10px auto;
      text-align: center;
    }
    /* Heading стиль - зүүн талд байрлуулах */
    h1, h2, h3, h4, h5, h6 {
      font-family: "Arial", "Times New Roman", "DejaVu Sans", "Mongolian Baiti", sans-serif;
      margin: 10px 0;
      font-weight: bold;
      text-align: left !important;
    }
    /* Том гарчиг - зүүн талд байрлуулах */
    h1 {
      text-align: left !important;
      font-size: 16pt;
      font-weight: bold;
      margin: 15px 0;
    }
    /* Гарчигууд - зүүн талд */
    p[style*="text-align: center"] {
      text-align: left !important;
    }
    /* Inline стиль хадгалах */
    strong, b {
      font-weight: bold;
    }
    em, i {
      font-style: italic;
    }
    u {
      text-decoration: underline;
    }
    /* Inline style-ийг хадгалах - CSS дээр override хийхгүй */
    /* Mammoth DOCX-ийг HTML болгохдоо inline style attribute-д өнгө, font, хэмжээ зэргийг хадгалдаг */
    /* Бид эдгээр inline style-ийг хадгалахын тулд CSS дээр override хийхгүй */
    
    /* Template-ийн placeholder текст - inline style байвал түүнийг ашиглах */
    span[style] {
      /* Inline style байвал түүнийг ашиглах */
    }
    span:not([style]) {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>
    `.trim();
    
    // Debug: HTML-ийг файлд хадгалах (development only)
    // Development mode-д HTML файл үргэлж хадгалах (debug хийхэд хялбар)
    if (process.env.NODE_ENV === 'development') {
      const htmlDebugPath = path.join(__dirname, '..', 'debug-monthly-report.html');
      fs.writeFileSync(htmlDebugPath, htmlWithFont);
      console.log(`[monthly-report-pdf] Debug: HTML saved to ${htmlDebugPath}`);
      
      // Мөн mammoth-ийн хөрвүүлсэн HTML-ийг хадгалах
      const rawHtmlPath = path.join(__dirname, '..', 'debug-monthly-report-raw.html');
      fs.writeFileSync(rawHtmlPath, htmlContent);
      console.log(`[monthly-report-pdf] Debug: Raw HTML saved to ${rawHtmlPath}`);
    }
    
    // Puppeteer ашиглан HTML-ийг PDF болгох
    // Lazy load puppeteer only when needed for PDF generation
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (puppeteerError) {
      console.error(`[monthly-report-pdf] Puppeteer not available:`, puppeteerError.message);
      throw new Error('PDF generation requires puppeteer. Please install it: npm install puppeteer');
    }
    
    console.log(`[monthly-report-pdf] Starting Puppeteer browser...`);
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 600_000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    });
    
    try {
      const page = await browser.newPage();
      
      // Том хэмжээний HTML ачаалах үед timeout ихэсгэх
      // (анхны 30 секундийн timeout багадаж байсан тул 120 секунд болгож сунгав)
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);
      
      // Монгол хэлний дэмжлэгийг баталгаажуулах
      await page.setContent(htmlWithFont, {
        // Сүлжээний хөдөлгөөнд хамаарахгүй, DOM бэлэн болмогц үргэлжлүүлнэ
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      
      // Зөвхөн "Үзлэгийн тайлан" хүснэгтүүдэд class нэмэх
      await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
          // Хүснэгтийн текст агуулгыг шалгах
          const tableText = table.innerText || table.textContent || '';
          const hasInspectionHeaders = 
            tableText.includes('Үзлэгийн эд анги') &&
            tableText.includes('Төлөв') &&
            tableText.includes('Хавсралт');
          
          if (hasInspectionHeaders) {
            table.classList.add('inspection-report-table');
          }
        });
      });
      
      // Inline стиль хадгалахын тулд хугацаа өгөх
      await new Promise(resolve => setTimeout(resolve, 500)); // CSS render хийхэд хугацаа өгөх
      
      console.log(`[monthly-report-pdf] Generating PDF...`);
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        margin: {
          top: '2cm',
          right: '2cm',
          bottom: '2cm',
          left: '2cm',
        },
      });
      
      console.log(`[monthly-report-pdf] PDF generated successfully, size: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
      console.log(`[monthly-report-pdf] Browser closed`);
    }
  } catch (error) {
    console.error(`[monthly-report-pdf] Error generating PDF:`, error);
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}

// Нэг сарын тайлан үүсгэх endpoint (PDF формат)
// ── Шинэ: mountly_render.js модулийг ашиглана ──
const { generateMonthlyReportPdf: _renderMonthlyPdf } = require('./mountly_render');

router.get('/organizations/:orgId/monthly-report', authMiddleware, async (req, res) => {
  try {
    const orgId = BigInt(req.params.orgId);
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = parseInt(req.query.startDay) || 1;
    const endDay = parseInt(req.query.endDay) || daysInMonth;

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid month', message: 'Month must be between 1 and 12' });
    }
    if (startDay < 1 || startDay > daysInMonth) {
      return res.status(400).json({
        error: 'Invalid start day',
        message: `Start day must be between 1 and ${daysInMonth}`,
      });
    }
    if (endDay < 1 || endDay > daysInMonth) {
      return res.status(400).json({
        error: 'Invalid end day',
        message: `End day must be between 1 and ${daysInMonth}`,
      });
    }
    if (startDay > endDay) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'Start day must be less than or equal to end day',
      });
    }

    console.log(`[monthly-report-endpoint] PDF хүсэлт: orgId=${orgId}, ${year}-${month}, ${startDay}-${endDay}`);
    const buffer   = await _renderMonthlyPdf(orgId, year, month, startDay, endDay);
    const filename = `monthly-report-${orgId}-${year}-${month}-${startDay}-${endDay}.pdf`;

    console.log(`[monthly-report-endpoint] PDF амжилттай, хэмжээ: ${buffer.length} bytes`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.send(buffer);
  } catch (error) {
    console.error('[monthly-report-endpoint] Алдаа:', error.message);
    return res.status(500).json({
      error:   'Failed to generate monthly report PDF',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

router.post('/organizations/:orgId/monthly-report/email', authMiddleware, async (req, res) => {
  try {
    const orgId = BigInt(req.params.orgId);
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = parseInt(req.query.startDay) || 1;
    const endDay = parseInt(req.query.endDay) || daysInMonth;

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid month', message: 'Month must be between 1 and 12' });
    }
    if (startDay < 1 || startDay > daysInMonth || endDay < 1 || endDay > daysInMonth || startDay > endDay) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: `Date range must be between 1 and ${daysInMonth}, and startDay <= endDay`,
      });
    }

    const org = await prisma.Organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        contactEmail: true,
        contactName: true,
      },
    });

    if (!org) {
      return res.status(404).json({
        error: 'Organization not found',
        message: 'Сонгосон байгууллага олдсонгүй',
      });
    }

    if (!org.contactEmail) {
      return res.status(400).json({
        error: 'No contact email',
        message: 'Байгууллагын contact_email тохируулаагүй тул mail илгээх боломжгүй байна.',
      });
    }

    const buffer = await _renderMonthlyPdf(orgId, year, month, startDay, endDay);

    await sendMonthlyReportEmail({
      to: org.contactEmail,
      organizationName: org.name || 'Байгууллага',
      contactName: org.contactName || null,
      year,
      month,
      startDay,
      endDay,
      pdfBuffer: buffer,
    });

    return res.json({
      message: `Сарын тайланг ${org.contactEmail} хаяг руу амжилттай илгээлээ.`,
      to: org.contactEmail,
    });
  } catch (error) {
    console.error('[monthly-report-email-endpoint] Алдаа:', error.message);
    return res.status(500).json({
      error: 'Failed to send monthly report email',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Export functions for testing (before router export)
const exportedFunctions = {
  groupImagesBySectionAndField,
  createImageContent,
  createSignatureImageContent,
  removeEmptyParagraphs,
  postProcessDocxBuffer,
  generateInspectionDocx,
  generateMonthlyReportDocx,
};
// =============================================================================
// REPAIR REPORT GENERATION
// =============================================================================

const { buildRepairReportData } = require('./repair-report-builder');

/**
 * Generate DOCX buffer for repair report
 * @param {Object} prisma - Prisma client instance
 * @param {BigInt} inspectionId - The inspection ID
 * @param {BigInt|null} repairId - Зөвхөн тухайн засварыг шүүх (optional)
 * @returns {Promise<Buffer>} The generated DOCX file buffer
 */
async function generateRepairReportDocx(prisma, inspectionId, repairId = null) {
  const inspectionIdBigInt = typeof inspectionId === 'bigint' ? inspectionId : BigInt(inspectionId);
  const repairIdBigInt = repairId ? (typeof repairId === 'bigint' ? repairId : BigInt(repairId)) : null;
  const reportData = await buildRepairReportData(prisma, inspectionIdBigInt, repairIdBigInt);
  
  console.log('[Repair Report DOCX] Building report data for inspection:', inspectionIdBigInt.toString());
  console.log('[Repair Report DOCX] Report data keys:', Object.keys(reportData));
  console.log('[Repair Report DOCX] d object keys:', reportData.d ? Object.keys(reportData.d) : 'MISSING');

  // Template file path (засварын тайлангийн template)
  const REPAIR_TEMPLATE_FILE = 'repair_template.docx'; // Template файлын нэрийг өөрчлөх
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    REPAIR_TEMPLATE_FILE
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Repair template file ${REPAIR_TEMPLATE_FILE} is missing.`);
  }

  const templateFile = fs.readFileSync(templatePath);
  
  // CRITICAL: Flatten non-image fields for easy-template-x dot-separated placeholders
  // Image objects must NOT be flattened - they remain in nested structure only
  console.log('[Repair Report DOCX] Flattening non-image fields for dot-separated placeholders');
  
  // Flatten the d object - image objects will be skipped by flattenTemplateFields
  const flattenedFields = flattenTemplateFields(reportData.d || {}, 'd');
  console.log('[Repair Report DOCX] Flattened fields count:', Object.keys(flattenedFields).length);
  
  // Create templateData with both nested structure AND flattened keys (for dot-separated placeholders)
  // This allows {{d.contractor.company}} to work while keeping images in nested structure
  const templateData = {
    ...reportData,
    ...flattenedFields,  // Add flattened keys for dot-separated placeholders like {{d.contractor.company}}
    // Keep nested structure for images and easy-template-x nested path resolution
    d: {
      ...reportData.d,
      // Ensure all nested data is preserved
      contractor: reportData.d?.contractor || {},
      metadata: reportData.d?.metadata || {},
      repair: reportData.d?.repair || undefined,
      signatures: reportData.d?.signatures || {},
    },
    // JSON мэдээлэл template-д ашиглах
    jsonData: reportData.jsonData || '',
  };
  
  // Зургийн object-үүдийг flattened version-аар нэмэх (easy-template-x compatibility)
  // {{d.repair.before_image}} болон {{d.repair.after_image}} placeholder-ууд ажиллахын тулд
  if (templateData.d?.repair?.before_image) {
    templateData['d.repair.before_image'] = templateData.d.repair.before_image;
  }
  if (templateData.d?.repair?.after_image) {
    templateData['d.repair.after_image'] = templateData.d.repair.after_image;
  }
  
  // Зургийн alt text placeholder-ууд нэмэх: {{d.repair.before_image_alt}}, {{d.repair.after_image_alt}}
  if (templateData.d?.repair?.beforeImageAltText) {
    templateData['d.repair.before_image_alt'] = templateData.d.repair.beforeImageAltText;
  }
  if (templateData.d?.repair?.afterImageAltText) {
    templateData['d.repair.after_image_alt'] = templateData.d.repair.afterImageAltText;
  }
  
  // Debug: Verify template data has all required placeholders
  console.log('📋 [Repair Report DOCX] Template Data Verification:');
  console.log('   Has d.contractor.company:', !!templateData.d?.contractor?.company);
  console.log('   Has d.contractor.contract_no:', !!templateData.d?.contractor?.contract_no);
  console.log('   Has d.contractor.contact:', !!templateData.d?.contractor?.contact);
  console.log('   Has d.metadata.date:', !!templateData.d?.metadata?.date);
  console.log('   Has d.metadata.inspector:', !!templateData.d?.metadata?.inspector);
  console.log('   Has d.metadata.location:', !!templateData.d?.metadata?.location);
  console.log('   Has d.repair:', !!templateData.d?.repair);
  console.log('   d.repair.section:', templateData.d?.repair?.section || 'MISSING');
  console.log('   d.repair.field:', templateData.d?.repair?.field || 'MISSING');
  console.log('   d.repair.before_text:', templateData.d?.repair?.before_text || 'MISSING');
  console.log('   d.repair.after_text:', templateData.d?.repair?.after_text || 'MISSING');
  console.log('   d.repair.before_image:', templateData.d?.repair?.before_image ? 'EXISTS' : 'MISSING');
  console.log('   d.repair.after_image:', templateData.d?.repair?.after_image ? 'EXISTS' : 'MISSING');
  
  // Verify image objects exist in nested structure ONLY
  if (templateData.d?.repair) {
    console.log('[Repair Report DOCX] 🔍 Verifying image objects (nested only):');
    console.log('   d.repair.before_image:', {
      exists: !!templateData.d.repair.before_image,
      _type: templateData.d.repair.before_image?._type,
      sourceIsBuffer: Buffer.isBuffer(templateData.d.repair.before_image?.source),
      format: templateData.d.repair.before_image?.format,
      width: templateData.d.repair.before_image?.width,
      height: templateData.d.repair.before_image?.height,
    });
    console.log('   d.repair.after_image:', {
      exists: !!templateData.d.repair.after_image,
      _type: templateData.d.repair.after_image?._type,
      sourceIsBuffer: Buffer.isBuffer(templateData.d.repair.after_image?.source),
      format: templateData.d.repair.after_image?.format,
      width: templateData.d.repair.after_image?.width,
      height: templateData.d.repair.after_image?.height,
    });
  }
  
  // Logo image - Template-д лого аль хэдийн байрлаж байгаа тул код-оос дахин тохируулах шаардлагагүй
  // Template-д лого placeholder байхгүй, зөвхөн бодит лого зураг байгаа

  // Signature image - keep in nested structure ONLY
  // CRITICAL: Only set signature for signature placeholders, NOT for logo placeholders
  // Template-д лого placeholder-ийн оронд гарын үсэг орж байгаа асуудлыг засах
  const inspectorSignature = reportData.d?.signatures?.inspector;
  const inspectorImage = await createSignatureImageContent(inspectorSignature);
  if (inspectorImage) {
    if (!templateData.d.signatures) {
      templateData.d.signatures = {};
    }
    // CRITICAL: Only set signature for signature-specific placeholders
    // Do NOT overwrite logo placeholders
    templateData.d.signatures.inspector = inspectorImage;
    // Also add flattened key for dot-separated placeholder {{d.signatures.inspector}}
    // This should ONLY match signature placeholders, not logo placeholders
    templateData['d.signatures.inspector'] = inspectorImage;
    
    // CRITICAL: Do NOT set signature at root level or anywhere that might conflict with logo
    // Signature should only be available via d.signatures.inspector path
    
    console.log('[Repair Report DOCX] ✅ Set d.signatures.inspector image (nested + flattened) - signature only, not logo');
  } else {
    console.log('[Repair Report DOCX] ⚠️ No inspector signature found');
  }

  // Ensure before_image and after_image are also available as flattened keys
  // (for dot-separated placeholders like {{d.repair.before_image}})
  if (templateData.d?.repair?.before_image) {
    templateData['d.repair.before_image'] = templateData.d.repair.before_image;
    console.log('[Repair Report DOCX] ✅ Added flattened d.repair.before_image');
  }
  if (templateData.d?.repair?.after_image) {
    templateData['d.repair.after_image'] = templateData.d.repair.after_image;
    console.log('[Repair Report DOCX] ✅ Added flattened d.repair.after_image');
  }

  // Debug: Log template data structure
  console.log('📋 [Repair Report DOCX] Template Data Structure:');
  console.log('   Inspection ID:', inspectionIdBigInt.toString());
  console.log('   Contractor company:', templateData.d?.contractor?.company || 'MISSING');
  console.log('   Contractor contract_no:', templateData.d?.contractor?.contract_no || 'MISSING');
  console.log('   Contractor contact:', templateData.d?.contractor?.contact || 'MISSING');

  // Debug: Log image placeholder keys in templateData
  console.log('🔍 [Repair Report DOCX] Image placeholder verification:');
  console.log('   templateData["before_image"] exists:', !!templateData['before_image']);
  console.log('   templateData["before_image"] type:', templateData['before_image'] ? typeof templateData['before_image'] : 'N/A');
  console.log('   templateData["before_image"] _type:', templateData['before_image']?._type || 'N/A');
  console.log('   templateData["after_image"] exists:', !!templateData['after_image']);
  console.log('   templateData["after_image"] type:', templateData['after_image'] ? typeof templateData['after_image'] : 'N/A');
  console.log('   templateData["after_image"] _type:', templateData['after_image']?._type || 'N/A');
  console.log('   templateData root level keys containing "image":', Object.keys(templateData).filter(k => k.includes('image')));
  console.log('   templateData root level keys:', Object.keys(templateData).slice(0, 20));

  // JSON мэдээлэл template-д оруулаж байгаа мэдээллийг хэвлэх
  // Image object-үүд Buffer агуулдаг тул зөвхөн metadata-г хэвлэх
  const jsonForTemplate = {
    contractor: {
      company: templateData.d?.contractor?.company || null,
      contract_no: templateData.d?.contractor?.contract_no || null,
      contact: templateData.d?.contractor?.contact || null,
    },
    metadata: {
      date: templateData.d?.metadata?.date || null,
      inspector: templateData.d?.metadata?.inspector || null,
      location: templateData.d?.metadata?.location || null,
      scale_id_serial_no: templateData.d?.metadata?.scale_id_serial_no || null,
      model: templateData.d?.metadata?.model || null,
    },
    repair: {
      section: templateData.d?.repair?.section || null,
      field: templateData.d?.repair?.field || null,
      before_text: templateData.d?.repair?.before_text || null,
      after_text: templateData.d?.repair?.after_text || null,
      before_image: templateData.d?.repair?.before_image?._type === 'image' ? 'IMAGE_OBJECT_EXISTS' : null,
      after_image: templateData.d?.repair?.after_image?._type === 'image' ? 'IMAGE_OBJECT_EXISTS' : null,
    },
  };

  console.log('📄 [Repair Report DOCX] JSON data being passed to template (nested only):');
  console.log(JSON.stringify(jsonForTemplate, null, 2));
  
  // Show the actual structure being passed to easy-template-x
  console.log('📦 [Repair Report DOCX] Full templateData structure (d object):');
  console.log('   d.contractor:', JSON.stringify(templateData.d?.contractor || {}, null, 2));
  console.log('   d.metadata:', JSON.stringify(templateData.d?.metadata || {}, null, 2));
  console.log('   d.repair keys:', templateData.d?.repair ? Object.keys(templateData.d.repair) : 'MISSING');
  console.log('   d.repair.section:', templateData.d?.repair?.section);
  console.log('   d.repair.field:', templateData.d?.repair?.field);
  console.log('   d.repair.before_text:', templateData.d?.repair?.before_text);
  console.log('   d.repair.after_text:', templateData.d?.repair?.after_text);
  console.log('   d.repair.before_image type:', templateData.d?.repair?.before_image?._type || 'null');
  console.log('   d.repair.after_image type:', templateData.d?.repair?.after_image?._type || 'null');
  console.log('   d.repair.before_image format:', templateData.d?.repair?.before_image?.format || 'null');
  console.log('   d.repair.after_image format:', templateData.d?.repair?.after_image?.format || 'null');

  // CRITICAL: Preserve embedded images (like logo) from template
  // Extract embedded images and related files from template before processing
  let embeddedFiles = {};
  try {
    const JSZip = require('jszip');
    const templateZip = await JSZip.loadAsync(templateFile);
    
    // Extract all files that need to be preserved
    const filesToPreserve = [];
    templateZip.forEach((relativePath, file) => {
      if (!file.dir) {
        if (relativePath.startsWith('word/media/')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath === 'word/_rels/document.xml.rels') {
          filesToPreserve.push(relativePath);
        } else if (relativePath.startsWith('word/header') || relativePath.startsWith('word/footer')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath.includes('header') && relativePath.includes('.rels')) {
          filesToPreserve.push(relativePath);
        } else if (relativePath.includes('footer') && relativePath.includes('.rels')) {
          filesToPreserve.push(relativePath);
        }
      }
    });
    
    console.log('[repair-report] 🔍 Found files to preserve in template:', filesToPreserve.length);
    
    // Store all files
    let mediaFileCount = 0;
    let headerFooterCount = 0;
    for (const filePath of filesToPreserve) {
      const fileBuffer = await templateZip.file(filePath)?.async('nodebuffer');
      if (fileBuffer) {
        embeddedFiles[filePath] = fileBuffer;
        if (filePath.startsWith('word/media/')) {
          mediaFileCount++;
          console.log(`[repair-report] ✅ Preserved media file: ${filePath} (${fileBuffer.length} bytes)`);
        } else if (filePath.startsWith('word/header') || filePath.startsWith('word/footer')) {
          headerFooterCount++;
          console.log(`[repair-report] ✅ Preserved header/footer file: ${filePath} (${fileBuffer.length} bytes)`);
        } else {
          console.log(`[repair-report] ✅ Preserved file: ${filePath} (${fileBuffer.length} bytes)`);
        }
      }
    }
    console.log(`[repair-report] 🔍 Preserved ${mediaFileCount} media files, ${headerFooterCount} header/footer files from template`);
    
    if (mediaFileCount === 0) {
      console.warn('[repair-report] ⚠️ WARNING: No media files found in template!');
      console.warn('[repair-report] ⚠️ Logo might be missing or template needs to be updated.');
    }
  } catch (extractError) {
    console.warn('[repair-report] ⚠️ Failed to extract embedded files from template:', extractError.message);
    // Continue anyway - template processing will still work
  }
  
  // CRITICAL: Use templateHandler with proper configuration (fixRawXml, maxXmlDepth)
  // Creating a new handler without options will fail to process Word XML correctly
  let buffer = await templateHandler.process(templateFile, templateData);
  
  // Restore embedded files to processed buffer
  if (Object.keys(embeddedFiles).length > 0) {
    try {
      const JSZip = require('jszip');
      const processedZip = await JSZip.loadAsync(buffer);
      
      // Handle document.xml.rels separately - merge instead of overwrite
      const relsPath = 'word/_rels/document.xml.rels';
      let originalRels = null;
      if (embeddedFiles[relsPath]) {
        originalRels = embeddedFiles[relsPath].toString('utf8');
        delete embeddedFiles[relsPath]; // Remove from embeddedFiles to handle separately
      }
      
      // Add back preserved files
      // CRITICAL: ALWAYS restore ALL media files from template to ensure logo displays correctly
      // Strategy: Template files are the source of truth - always restore them
      let restoredCount = 0;
      for (const [filePath, fileBuffer] of Object.entries(embeddedFiles)) {
        // Skip document.xml.rels - handled separately
        if (filePath === 'word/_rels/document.xml.rels') {
          continue;
        }
        
        // ALWAYS restore template media files - they are the source of truth
        processedZip.file(filePath, fileBuffer);
        restoredCount++;
        console.log(`[repair-report] ✅ Restored template file: ${filePath} (${fileBuffer.length} bytes)`);
      }
      
      console.log(`[repair-report] 🔍 Restored ${restoredCount} template media files`);
      
          // Merge document.xml.rels if we have both original and processed versions
          if (originalRels) {
            const processedRelsFile = processedZip.file(relsPath);
            if (processedRelsFile) {
              const processedRels = await processedRelsFile.async('string');
              
              // Debug: Log original relationships for logo detection
              const originalMediaCount = (originalRels.match(/media\//g) || []).length;
              const processedMediaCount = (processedRels.match(/media\//g) || []).length;
              console.log(`[repair-report] 🔍 document.xml.rels merge: original has ${originalMediaCount} media refs, processed has ${processedMediaCount} media refs`);
              
              const mergedRels = mergeDocumentRels(originalRels, processedRels);
              const mergedMediaCount = (mergedRels.match(/media\//g) || []).length;
              console.log(`[repair-report] 🔍 After merge: ${mergedMediaCount} media refs in merged file`);
              
              processedZip.file(relsPath, mergedRels);
              console.log(`[repair-report] ✅ Merged document.xml.rels to preserve logo and attachments`);
            } else {
              // If processed version doesn't exist, use original
              processedZip.file(relsPath, originalRels);
              console.log(`[repair-report] ✅ Restored document.xml.rels (no processed version found)`);
            }
          }
      
      // Generate new buffer with restored files
      buffer = await processedZip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      
      console.log('[repair-report] ✅ Embedded files restored, new buffer length:', buffer.length);
    } catch (restoreError) {
      console.warn('[repair-report] ⚠️ Failed to restore embedded files:', restoreError.message);
      // Continue with processed buffer - images might still be there
    }
  }

  return buffer;
}

// GET /api/documents/repairs/:inspectionId/preview - Get repair report preview data
// Query parameter: ?repairId=56 - зөвхөн тухайн засварыг харуулах
router.get('/repairs/:inspectionId/preview', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.inspectionId);
    const repairId = req.query.repairId ? BigInt(req.query.repairId) : null; // Зөвхөн тухайн засварыг шүүх
    const userId = BigInt(req.user.id);

    // Verify access
    const prisma = new PrismaClient();
    const inspection = await prisma.Inspection.findUnique({
      where: { id: inspectionId },
      include: {
        organization: {
          select: { id: true }
        }
      }
    });

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found',
        message: 'The requested inspection does not exist',
      });
    }

    // Check if user is admin
    const user = await prisma.User.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: { name: true }
        }
      }
    });

    const isAdmin = user?.role?.name?.toLowerCase() === 'admin';

    // Check organization access (skip for admin users)
    if (!isAdmin && inspection.orgId.toString() !== req.user.orgId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this inspection',
      });
    }

    // Зөвхөн тухайн засварыг шүүх repairId байвал
    const reportData = await buildRepairReportData(prisma, inspectionId, repairId);
    
    // Preview-д зориулж image object-үүдийг арилгах (Buffer агуулж байгаа тул serialize хийх боломжгүй)
    const previewData = JSON.parse(JSON.stringify(reportData));
    if (previewData.d?.repair) {
      delete previewData.d.repair.before_image; // Buffer агуулж байгаа тул арилгах
      delete previewData.d.repair.after_image;  // Buffer агуулж байгаа тул арилгах
      // beforeImagePreview болон afterImagePreview-ийг үлдээх (base64 + imageUrl)
    }
    
    return res.json({ data: serializeBigInt(previewData) });
  } catch (error) {
    console.error('Error building repair report preview data:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      error: 'Failed to build preview data',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        code: error.code,
        meta: error.meta,
      } : undefined,
    });
  }
});

// GET /api/documents/repairs/:inspectionId/docx - Generate repair report
// Query parameter: ?repairId=56 - зөвхөн тухайн засварыг харуулах
router.get('/repairs/:inspectionId/docx', authMiddleware, async (req, res) => {
  try {
    const inspectionId = BigInt(req.params.inspectionId);
    const repairId = req.query.repairId ? BigInt(req.query.repairId) : null; // Зөвхөн тухайн засварыг шүүх
    const userId = BigInt(req.user.id);

    // Verify access
    const prisma = new PrismaClient();
    const inspection = await prisma.Inspection.findUnique({
      where: { id: inspectionId },
      include: {
        organization: {
          select: { id: true }
        }
      }
    });

    if (!inspection) {
      return res.status(404).json({
        error: 'Inspection not found',
        message: 'The requested inspection does not exist',
      });
    }

    // Check if user is admin
    const user = await prisma.User.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: { name: true }
        }
      }
    });

    const isAdmin = user?.role?.name?.toLowerCase() === 'admin';

    // Check organization access (skip for admin users)
    if (!isAdmin && inspection.orgId.toString() !== req.user.orgId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have access to this inspection',
      });
    }

    // Зөвхөн тухайн засварыг шүүх repairId байвал
    const buffer = await generateRepairReportDocx(prisma, inspectionId, repairId);
    const reportData = await buildRepairReportData(prisma, inspectionId, repairId);

    // Filename-ийг repairId байвал түүнийг ашиглах, эсвэл inspectionId ашиглах
    const filename = repairId 
      ? `repair-report-${repairId.toString()}.docx`
      : `repair-report-${reportData.inspection.id}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Error generating repair report DOCX:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      error: 'Failed to generate repair report',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
      } : undefined,
    });
  }
});

/**
 * Суурьлуулалтын тайлан DOCX — гэрээгээр шүүж татах
 * GET /api/documents/contracts/:contractId/installation-report
 *
 * DEV NOTE: Локал хөгжүүлэлтэд туршихын тулд authMiddleware-ийг түр салгасан.
 */
const INSTALLATION_REPORT_TEMPLATE = 'Суурьлуулалт.docx';
router.get('/contracts/:contractId/installation-report', async (req, res) => {
  try {
    // This endpoint can take a long time (many images + DOCX processing).
    // Increase socket timeouts to avoid 120s client/server aborts.
    try {
      req.setTimeout?.(10 * 60 * 1000);
      res.setTimeout?.(10 * 60 * 1000);
    } catch (_) {}

    const contractId = req.params.contractId;
    const templatePath = path.join(__dirname, '..', 'templates', INSTALLATION_REPORT_TEMPLATE);

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Суурьлуулалтын template олдсонгүй: ${INSTALLATION_REPORT_TEMPLATE}`,
      });
    }

    const reportData = await buildInstallationReportData(prisma, contractId);
    if (!reportData.d.installationItems || reportData.d.installationItems.length === 0) {
      return res.status(404).json({
        error: 'No data',
        message: 'Энэ гэрээнд суурьлуулалтын өгөгдөл олдсонгүй.',
      });
    }

    // Зургийн URL эсвэл relative path-аас loadImagePayload-д өгөх path гаргах
    function getRelativePathFromUrl(imageUrl) {
      if (!imageUrl || typeof imageUrl !== 'string') return null;
      const s = imageUrl.trim();
      if (!s) return null;
      try {
        const u = new URL(imageUrl);
        const pathname = (u.pathname || '').replace(/^\/+/, '').trim();
        return pathname || null;
      } catch (_) {
        // URL биш (relative path): бүтэн path-ийг буцаана
        return s.replace(/^\/+/, '');
      }
    }

    // Зургийн тоолуур: хэд ачаалагдсаныг логлоно (91 байхад 61 л DOCX-д гардаг асуудал шалгах)
    let installationReportImagesTried = 0;
    let installationReportImagesLoaded = 0;

    // Акт болон field зургуудыг image content болгон ачаалах
    for (const item of reportData.d.installationItems) {
      for (const act of item.acts) {
        if (act.actImage && typeof act.actImage === 'string') {
          const rel = getRelativePathFromUrl(act.actImage);
          if (rel) {
            installationReportImagesTried += 1;
            const payload = await loadImagePayload(rel);
            if (payload && (payload.buffer || payload.base64)) {
              installationReportImagesLoaded += 1;
              let actBuffer = payload.buffer || Buffer.from(payload.base64, 'base64');
              try {
                actBuffer = await sharp(actBuffer)
                  .autoOrient()
                  .resize(300, 800, { fit: 'cover' })
                  .png()
                  .toBuffer();
              } catch (resizeErr) {
                console.warn('[installation-report] Акт зургийн resize алдаа:', resizeErr.message);
              }
              const imgContent = await createImageContent({
                buffer: actBuffer,
                mimeType: 'image/png',
                displayWidth: 300,
                displayHeight: 800,
              });
              act.actImage = imgContent || null;
            } else {
              act.actImage = null;
            }
          }
        }
      }
      for (const section of item.sections) {
        for (const title of section.titles) {
          if (title.images && title.images.length) {
            const loaded = [];
            for (const img of title.images) {
              const rel = getRelativePathFromUrl(img.imageUrl);
              if (rel) {
                installationReportImagesTried += 1;
                const payload = await loadImagePayload(rel);
                if (payload && (payload.buffer || payload.base64)) {
                  // Downscale actual image buffer to speed up processing (91+ images can be very slow).
                  let buf = payload.buffer || (payload.base64 ? Buffer.from(payload.base64, 'base64') : null);
                  try {
                    if (buf) {
                      buf = await sharp(buf)
                        .autoOrient()
                        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                        .png()
                        .toBuffer();
                    }
                  } catch (resizeErr) {
                    console.warn('[installation-report] Field зургийн resize алдаа:', resizeErr.message);
                  }

                  const imgContent = await createImageContent({
                    buffer: buf,
                    mimeType: 'image/png',
                  });
                  if (imgContent) {
                    loaded.push({ fieldImage: imgContent });
                    installationReportImagesLoaded += 1;
                  }
                }
              }
            }
            title.images = loaded;
          }
        }
      }
    }

    console.log(
      `[installation-report] Images: ${installationReportImagesLoaded}/${installationReportImagesTried} loaded (in data). ` +
      (installationReportImagesTried > installationReportImagesLoaded
        ? `Missing ${installationReportImagesTried - installationReportImagesLoaded} (load/createImageContent failed).`
        : '')
    );

    let templateFile = fs.readFileSync(templatePath);
    templateFile = await normalizeDocxTemplatePlaceholders(templateFile, 'installation-report');

    // Template-ээс: document.xml.rels, header rels (merge-д), лого доголборын XML (body эсвэл header-ээс)
    let embeddedFiles = {};
    let originalHeaderRels = {}; // path -> utf8 string, merge-д ашиглана
    let logoParagraphXml = null;
    try {
      const JSZip = require('jszip');
      const templateZip = await JSZip.loadAsync(templateFile);
      const relsPath = 'word/_rels/document.xml.rels';
      const relsFile = templateZip.file(relsPath);
      if (relsFile) {
        const fileBuffer = await relsFile.async('nodebuffer');
        if (fileBuffer) embeddedFiles[relsPath] = fileBuffer;
      }
      // Header rels: лого ихэвчлэн header-т байдаг, rels нэгтгэх шаардлагатай
      const headerRelsRegex = /^word\/_rels\/header\d*\.xml\.rels$/;
      for (const name of Object.keys(templateZip.files)) {
        if (headerRelsRegex.test(name)) {
          const buf = await templateZip.file(name)?.async('nodebuffer');
          if (buf) originalHeaderRels[name] = buf.toString('utf8');
        }
      }
      const extractFirstDrawingParagraph = (xml) => {
        if (!xml) return null;
        const pRegex = /<w:p[^>]*>[\s\S]*?<\/w:p>/g;
        let pMatch;
        while ((pMatch = pRegex.exec(xml)) !== null) {
          if (/<w:drawing|a:blip|wp:inline|wp:anchor/.test(pMatch[0])) return pMatch[0];
        }
        return null;
      };
      const templateDocXml = await templateZip.file('word/document.xml')?.async('string');
      if (templateDocXml) {
        const bodyMatch = templateDocXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
        if (bodyMatch) logoParagraphXml = extractFirstDrawingParagraph(bodyMatch[1]);
      }
      // Body-д лого байхгүй бол header-ээс авна (body эхэнд inject хийхэд ашиглана)
      if (!logoParagraphXml) {
        for (const name of Object.keys(templateZip.files)) {
          if (/^word\/header\d*\.xml$/.test(name)) {
            const headerXml = await templateZip.file(name)?.async('string');
            logoParagraphXml = extractFirstDrawingParagraph(headerXml || '');
            if (logoParagraphXml) break;
          }
        }
      }
      if (logoParagraphXml) console.log('[documents] Logo paragraph extracted from template (body or header)');
      else console.log('[documents] No logo drawing paragraph found in template body/headers');
    } catch (extractErr) {
      console.warn('[installation-report] Failed to extract document.xml.rels:', extractErr.message);
    }

    // Лого: зөвхөн FTP storage (ftp_data) -аас уншина. LOGO_PATH = файлын нэр эсвэл relative path (FTP_STORAGE_PATH-ийн доор)
    let logoImageContent = null;
    let logoBufferForZip = null;
    const ftpStoragePath = path.resolve(process.env.FTP_STORAGE_PATH || 'C:/ftp_data');
    const logoRelative = (process.env.LOGO_PATH || 'LOGO_PATH.png').replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
    const logoFullPath = path.resolve(ftpStoragePath, logoRelative);
    if (logoFullPath.startsWith(ftpStoragePath) && fs.existsSync(logoFullPath)) {
      try {
        const buf = fs.readFileSync(logoFullPath);
        logoBufferForZip = buf;
        const ext = path.extname(logoFullPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        logoImageContent = await createImageContent({ buffer: buf, mimeType });
        if (logoImageContent) {
          logoImageContent.width = Math.round((logoImageContent.width || 300) / 2);
          logoImageContent.height = Math.round((logoImageContent.height || 272) / 2);
        }
      } catch (logoErr) {
        console.warn('[installation-report] Logo load failed:', logoErr.message);
      }
    }

    // Flatten d so {{d.contractor.company}}, {{d.contractor.contract_no}}, {{d.contractor.contact}} resolve
    const flattenedFields = flattenTemplateFields(reportData.d || {}, 'd');
    const contractor = reportData.d?.contractor || {};
    const installationItems = reportData.d?.installationItems || [];
    const templateData = {
      ...reportData,
      ...flattenedFields,
      d: {
        ...reportData.d,
        reportTitle: 'Суурьлуулалтын тайлан',
        ...(logoImageContent && { logo: logoImageContent }),
      },
      ...(logoImageContent && { 'd.logo': logoImageContent }),
      'd.reportTitle': 'Суурьлуулалтын тайлан',
      contractor,
      'contractor.company': contractor.company ?? '',
      'contractor.contract_no': contractor.contract_no ?? '',
      'contractor.contact': contractor.contact ?? '',
      company: contractor.company ?? '',
      contract_no: contractor.contract_no ?? '',
      contact: contractor.contact ?? '',
      // Template {{#installationItems}} давталт (d-гүйгээр) ажиллахын тулд
      installationItems,
    };
    // Installation report can contain many images; increase processing timeout.
    // Default timeouts (e.g. 120s) may be exceeded when embedding 90+ images.
    let buffer = await templateHandler.process(templateFile, templateData, {
      timeout: 10 * 60 * 1000, // 10 minutes
    });

    // Лого болон template-ийн media/rels-ийг боловсруулсан buffer-д буцаан оруулах (document + header rels)
    const hasRelsOrLogo = Object.keys(embeddedFiles).length > 0 || Object.keys(originalHeaderRels).length > 0 || logoBufferForZip;
    if (hasRelsOrLogo) {
      try {
        const JSZip = require('jszip');
        const processedZip = await JSZip.loadAsync(buffer);
        const relsPath = 'word/_rels/document.xml.rels';
        let originalRels = null;
        if (embeddedFiles[relsPath]) {
          originalRels = embeddedFiles[relsPath].toString('utf8');
          delete embeddedFiles[relsPath];
        }
        for (const [filePath, fileBuffer] of Object.entries(embeddedFiles)) {
          processedZip.file(filePath, fileBuffer);
        }
        // Логог зөвхөн өөр нэртэй файлд бичнэ (image.pnng/image2.pnng-ийг бүү дар — тэнд акт/section зургууд байж болно)
        const LOGO_MEDIA_1 = 'media/logo_primary.png';
        const LOGO_MEDIA_2 = 'media/logo_secondary.png';
        const replaceLogoTargetsInRels = (relsXml) => {
          if (!relsXml) return relsXml;
          let out = relsXml;
          const allTargets = [...relsXml.matchAll(/Target="([^"]*media\/[^"]+)"/g)]
            .map(m => m[1].replace(/^\/+/, '').trim());
          const logoTargetsOrdered = [];
          const seen = new Set();
          for (const t of allTargets) {
            if (!/image\.pnng|image2\.pnng|logo/i.test(t)) continue;
            if (seen.has(t)) continue;
            seen.add(t);
            logoTargetsOrdered.push(t);
            if (logoTargetsOrdered.length >= 2) break;
          }
          for (let idx = 0; idx < logoTargetsOrdered.length; idx++) {
            const t = logoTargetsOrdered[idx];
            const replacement = idx === 0 ? LOGO_MEDIA_1 : LOGO_MEDIA_2;
            out = out.replace(new RegExp(`Target="${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'), `Target="${replacement}"`);
          }
          return out;
        };
        if (logoBufferForZip && logoBufferForZip.length > 0) {
          processedZip.file('word/' + LOGO_MEDIA_1, logoBufferForZip);
          processedZip.file('word/' + LOGO_MEDIA_2, logoBufferForZip);
        }
        if (originalRels) {
          const processedRelsFile = processedZip.file(relsPath);
          if (processedRelsFile) {
            const processedRels = await processedRelsFile.async('string');
            let mergedRels = mergeDocumentRels(originalRels, processedRels);
            mergedRels = replaceLogoTargetsInRels(mergedRels);
            processedZip.file(relsPath, mergedRels);
          } else {
            processedZip.file(relsPath, replaceLogoTargetsInRels(originalRels));
          }
        }
        // Header rels: merge хийж, лого Target-уудыг logo_primary/secondary руу засаад бичих
        for (const [headerRelsPath, origHeaderRels] of Object.entries(originalHeaderRels)) {
          const processedHeaderRelsFile = processedZip.file(headerRelsPath);
          if (processedHeaderRelsFile) {
            const processedHeaderRels = await processedHeaderRelsFile.async('string');
            let merged = mergeDocumentRels(origHeaderRels, processedHeaderRels);
            merged = replaceLogoTargetsInRels(merged);
            processedZip.file(headerRelsPath, merged);
          } else {
            processedZip.file(headerRelsPath, replaceLogoTargetsInRels(origHeaderRels));
          }
        }
        // document.xml-д лого reference (r:embed) process-д алга болсон бол template-ийн лого доголборыг эхэнд оруулна (зураг нь FTP-аас)
        if (logoParagraphXml) {
          const processedDocXml = await processedZip.file('word/document.xml')?.async('string');
          if (processedDocXml) {
            const bodyContent = processedDocXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/)?.[1] || '';
            const hasDrawingNearStart = /<w:drawing|a:blip|wp:inline|wp:anchor/.test(bodyContent.substring(0, 4000));
            if (!hasDrawingNearStart) {
              const bodyOpenMatch = processedDocXml.match(/(<w:body[^>]*>)/);
              if (bodyOpenMatch) {
                processedZip.file('word/document.xml',
                  processedDocXml.replace(bodyOpenMatch[0], bodyOpenMatch[0] + logoParagraphXml));
                console.log('[documents] Injected logo paragraph into document body');
              }
            }
          }
        }
        buffer = await processedZip.generateAsync({ type: 'nodebuffer' });
      } catch (restoreErr) {
        console.warn('[installation-report] Failed to restore embedded files:', restoreErr.message);
      }
    }

    const filename = `installation-report-${contractId}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('[installation-report] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate installation report',
      message: error.message,
    });
  }
});

// Export router as default
module.exports = Object.assign(router, exportedFunctions);





