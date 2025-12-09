const express = require('express');
const path = require('path');
const fs = require('fs');
const { TemplateHandler, MimeType } = require('easy-template-x');
const sharp = require('sharp');
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
      format: MimeType.Png,
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
  console.log('[documents] createImageContent called with:', {
    hasImageData: !!imageData,
    isObject: imageData && typeof imageData === 'object',
    hasBuffer: !!(imageData && imageData.buffer),
    hasBase64: !!(imageData && imageData.base64),
    hasMimeType: !!(imageData && imageData.mimeType),
    base64Length: imageData?.base64?.length,
    mimeType: imageData?.mimeType,
    section: imageData?.section,
    fieldId: imageData?.fieldId,
  });

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
  let format = MIME_TYPE_MAP[normalizedType];

  // Detailed format validation
  // Note: MimeType enum values are strings in easy-template-x
  const formatCheck = {
    originalMimeType: imageData.mimeType,
    normalizedType,
    format,
    formatType: typeof format,
    formatValue: format,
    formatIsUndefined: format === undefined,
    formatIsNull: format === null,
    isMimeTypeEnum: format === MimeType.Png || format === MimeType.Jpeg || format === MimeType.Gif || format === MimeType.Bmp || format === MimeType.Svg,
    formatName: format === MimeType.Png ? 'Png' : format === MimeType.Jpeg ? 'Jpeg' : format === MimeType.Gif ? 'Gif' : format === MimeType.Bmp ? 'Bmp' : format === MimeType.Svg ? 'Svg' : 'Other',
    MIME_TYPE_MAP_keys: Object.keys(MIME_TYPE_MAP),
    MIME_TYPE_MAP_hasKey: normalizedType in MIME_TYPE_MAP,
    MimeTypeEnumValues: {
      Png: MimeType.Png,
      Jpeg: MimeType.Jpeg,
      Gif: MimeType.Gif,
      Bmp: MimeType.Bmp,
      Svg: MimeType.Svg,
    },
  };

  console.log('[documents] Image format mapping:', formatCheck);

  // If format is undefined or not a MimeType enum, this is a problem
  // Note: MimeType enum values are strings, not numbers
  if (format === undefined || format === null || !formatCheck.isMimeTypeEnum) {
    console.error('[documents] ❌ FORMAT ERROR:', {
      formatIsUndefined: format === undefined,
      formatIsNull: format === null,
      formatIsNotEnum: !formatCheck.isMimeTypeEnum,
      formatType: typeof format,
      formatValue: format,
      expectedType: 'MimeType enum (string)',
      actualType: typeof format,
      normalizedType,
      MIME_TYPE_MAP_hasKey: normalizedType in MIME_TYPE_MAP,
      expectedFormat: MIME_TYPE_MAP[normalizedType],
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

    if (!format) {
      const converted = await convertUnsupportedImage(
        source,
        normalizedType || 'unknown'
      );
      if (!converted) {
        return null;
      }
      source = converted.buffer;
      format = converted.format;
      normalizedType = converted.mimeType;
    }
    
    if (!source || source.length === 0) {
      console.error('[documents] ❌ Buffer is empty after conversion');
      return null;
    }

    // EXIF orientation-ийг засах.
    // Анхны чанарыг аль болох хадгалах үүднээс:
    //  - Orientation зөв байвал buffer-ийг өөрчлөхгүй, зөвхөн хэмжээгээр (width/height) харуулах
    //  - Orientation буруу бол зөвхөн тэр үед sharp ашиглан засна
    let finalWidth = IMAGE_WIDTH;
    let finalHeight = IMAGE_HEIGHT;
    
    try {
      const sharpImage = sharp(source);
      const metadata = await sharpImage.metadata();
      
      console.log('[documents] Image metadata:', {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        format: metadata.format,
      });
      
      // EXIF orientation байвал засах
      if (metadata.orientation && metadata.orientation !== 1) {
        console.log('[documents] Fixing image orientation:', {
          originalOrientation: metadata.orientation,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
        });
        
        // autoOrient() нь EXIF orientation-ийг уншиж, зурагийг зөв байрлуулна.
        // Чанарыг алдагдуулахгүйн тулд энд resize хийхгүй, зөвхөн orientation засна.
        source = await sharpImage.autoOrient().toBuffer();
        
        console.log('[documents] ✅ Image orientation fixed');
      } else {
        // Orientation зөв бол анхны buffer-ийг шууд ашиглана
        console.log(
          '[documents] Image orientation is correct, using original buffer without re-encoding'
        );
      }
    } catch (orientationError) {
      console.warn('[documents] ⚠️ Could not process image with sharp:', orientationError.message);
      // Алдаа гарвал анхны buffer-ийг ашиглах
    }

    console.log('[documents] ✅ Buffer created successfully:', {
      bufferLength: source.length,
      format,
      formatType: typeof format,
      formatValue: format,
      isMimeTypeEnum: format === MimeType.Png || format === MimeType.Jpeg || format === MimeType.Gif || format === MimeType.Bmp || format === MimeType.Svg,
      formatName: format === MimeType.Png ? 'Png' : format === MimeType.Jpeg ? 'Jpeg' : format === MimeType.Gif ? 'Gif' : format === MimeType.Bmp ? 'Bmp' : format === MimeType.Svg ? 'Svg' : 'Other',
      width: finalWidth,
      height: finalHeight,
      isBuffer: Buffer.isBuffer(source),
      sourceType: typeof source,
    });

    return {
      _type: 'image',
      source, // Buffer object - easy-template-x will use this directly
      format,
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

function createSignatureImageContent(signature) {
  if (
    !signature ||
    typeof signature !== 'object' ||
    !signature.data ||
    !signature.mimeType
  ) {
    return null;
  }

  const normalizedType = signature.mimeType.toLowerCase();
  const format = MIME_TYPE_MAP[normalizedType] || MimeType.Png;

  try {
    const source = Buffer.from(signature.data, 'base64');
    if (!source.length) {
      return null;
    }

    return {
      _type: 'image',
      source, // Buffer object - easy-template-x will use this directly
      format,
      width: 180, // Гарын үсгийн өргөн
      height: 80, // Гарын үсгийн өндөр
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
      format: MimeType.Png,
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

  // 3. Paragraph properties хэсгийг авч хаях
  let content = paragraphXml.replace(/<w:pPr[\s\S]*?<\/w:pPr>/gi, '');

  // 4. Бүх XML tag-уудыг устгах
  content = content.replace(/<[^>]+>/g, '');

  // 5. NBSP болон түүнтэй төстэй whitespace entity-үүдийг энгийн space болгож, дараа нь цэвэрлэх
  content = content
    .replace(/&nbsp;|&#160;|&amp;#160;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();

  // Ямар нэг харагдах текст байхгүй бол paragraph-ийг хоосон гэж үзнэ
  return content.length === 0;
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
    
    const xml = await xmlFile.async('string');
    const originalLength = xml.length;
    
    console.log('[documents] removeEmptyParagraphs: Processing XML with paragraph-aware cleanup...');

    // DOCX XML-д paragraph нь <w:p>...</w:p> tag-тай байдаг.
    // Эхлээд бүх paragraph-уудыг блок болгон олж, бүр paragraph тутамд "хоосон эсэх"-ийг шалгана.
    const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi;

    let newXml = '';
    let lastIndex = 0;
    let removedParagraphs = 0;
    let keptParagraphs = 0;

    xml.replace(paragraphRegex, (match, offset) => {
      // Paragraph-оос өмнөх хэсгийг хадгална
      newXml += xml.slice(lastIndex, offset);

      if (isEmptyWordParagraph(match)) {
        removedParagraphs += 1;
        // Хоосон paragraph-ийг алгасанаар устгаж байна
      } else {
        keptParagraphs += 1;
        newXml += match;
      }

      lastIndex = offset + match.length;
      return match;
    });

    // Сүүлийн paragraph-аас хойших үлдэгдэл XML-ийг нэмнэ
    newXml += xml.slice(lastIndex);

    const newLength = newXml.length;
    const removedChars = originalLength - newLength;

    console.log(
      `[documents] removeEmptyParagraphs: Removed ${removedParagraphs} empty paragraphs, kept ${keptParagraphs} paragraphs (Δ${removedChars} chars)`
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
 * DOCX файл дээр хийх бүх post-processing алхмуудыг нэг газар төвлөрүүлэх туслах функц
 * Одоогоор:
 *  - Хоосон paragraph-уудыг арилгах
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
const { buildInspectionReportData } = require('../services/report-service');

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
  process.env.REPORT_TEMPLATE_FILE || 'template.docx';

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
  
  // Flatten the d object specifically with 'd' prefix
  const flattenedFields = flattenTemplateFields(reportData.d || {}, 'd');
  console.log('[documents] Flattened fields count:', Object.keys(flattenedFields).length);
  
  // Debug: Check serial_converter_plug data
  console.log('[documents] Indicator section data:', {
    hasIndicator: !!reportData.d?.indicator,
    indicatorKeys: reportData.d?.indicator ? Object.keys(reportData.d.indicator) : [],
    serialConverterPlug: reportData.d?.indicator?.serial_converter_plug,
    serialConverter: reportData.d?.indicator?.serial_converter,
  });
  console.log('[documents] Flattened serial_converter_plug fields:', {
    status: flattenedFields['d.indicator.serial_converter_plug.status'],
    comment: flattenedFields['d.indicator.serial_converter_plug.comment'],
    question: flattenedFields['d.indicator.serial_converter_plug.question'],
  });
  
  // Create templateData with both nested structure and flattened keys
  const templateData = {
    ...reportData,  // Keep original nested structure
    ...flattenedFields,  // Add flattened keys for dot-separated placeholders
  };
  
  // Also ensure nested structure exists for images (easy-template-x might need both)
  if (!templateData.d) {
    templateData.d = {};
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
  const inspectorSignature = reportData.d?.signatures?.inspector;
  const inspectorImage = createSignatureImageContent(inspectorSignature);
  if (inspectorImage) {
    templateData['d.signatures.inspector'] = inspectorImage;
  }

  // FTP image
  const ftpImage = reportData.d?.ftp_image;
  const ftpImageContent = createSignatureImageContent(ftpImage);
  if (ftpImageContent) {
    ftpImageContent.width = 300;
    ftpImageContent.height = 200;
    templateData['d.ftp_image'] = ftpImageContent;
  }

  // Group images by section + field_id and add to template data
  const imagesBySectionField = await groupImagesBySectionAndField(
    reportData.d?.images || []
  );
  
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
    
    if (fieldMappings[section] && fieldMappings[section][fieldId]) {
      const fieldKey = fieldMappings[section][fieldId];
      const templateKey = `d.images.${section}.${fieldKey}`;
      const hasImagesKey = `d.hasImages.${section}.${fieldKey}`;
      
      const imageArray = Array.isArray(images) ? images : [];
      const imageCount = imageArray.length;
      
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
    }
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
    
    // Also set serial_converter_plug for backward compatibility
    templateData.d.indicator.serial_converter_plug = serialConverter;
    templateData['d.indicator.serial_converter_plug'] = serialConverter;
    templateData['d.indicator.serial_converter_plug.status'] = serialConverter.status || '';
    templateData['d.indicator.serial_converter_plug.comment'] = serialConverter.comment || '';
    templateData['d.indicator.serial_converter_plug.question'] = serialConverter.question || '';
    
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

  // Process template with easy-template-x
  let buffer = await templateHandler.process(templateFile, templateData);

  // Post-processing: DOCX файлыг цэвэрлэх (хоосон мөрүүдийг арилгах гэх мэт)
  buffer = await postProcessDocxBuffer(buffer, { context: 'inspection-docx' });

  return buffer;
}

// Generate DOCX using Docxtemplater (answer ID)
router.get('/answers/:answerId/docx', authMiddleware, async (req, res) => {
  try {
    const answerId = BigInt(req.params.answerId);
    const buffer = await generateInspectionDocx(answerId);
    const reportData = await buildInspectionReportData(prisma, { answerId });

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
    console.error('Error generating inspection DOCX:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      openDelimiterText: error.openDelimiterText,
    });
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

/**
 * Нэг сарын бүх үзлэгүүдийн тайлан үүсгэх (1template.docx ашиглах)
 * @param {BigInt} siteId - Site ID
 * @param {Number} year - Жил (жишээ: 2024)
 * @param {Number} month - Сар (1-12)
 * @returns {Promise<Buffer>} Generated DOCX buffer
 */
async function generateMonthlyReportDocx(siteId, year, month) {
  // Сарын эхлэл болон төгсгөлийн огноо тооцоолох
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  console.log(`[monthly-report] Generating report for site ${siteId}, ${year}-${month}`);
  console.log(`[monthly-report] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Тухайн сард хийгдсэн бүх inspection answer-уудыг олох
  const answers = await prisma.InspectionAnswer.findMany({
    where: {
      inspection: {
        siteId: BigInt(siteId),
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

  // 1template.docx файлыг ашиглах
  const MONTHLY_TEMPLATE_FILE = '1template.docx';
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

    // Field mapping (одоогийн кодтой ижил)
    const fieldMappings = {
      exterior: {
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
    const inspectorSignature = reportData.d?.signatures?.inspector;
    const inspectorImage = createSignatureImageContent(inspectorSignature);
    if (inspectorImage) {
      inspectionTemplateData['d.signatures.inspector'] = inspectorImage;
    }

    // FTP image
    const ftpImage = reportData.d?.ftp_image;
    const ftpImageContent = createSignatureImageContent(ftpImage);
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
      
      // Also set serial_converter_plug for backward compatibility
      inspectionTemplateData.d.indicator.serial_converter_plug = serialConverter;
      inspectionTemplateData['d.indicator.serial_converter_plug'] = serialConverter;
      inspectionTemplateData['d.indicator.serial_converter_plug.status'] = serialConverter.status || '';
      inspectionTemplateData['d.indicator.serial_converter_plug.comment'] = serialConverter.comment || '';
      inspectionTemplateData['d.indicator.serial_converter_plug.question'] = serialConverter.question || '';
      
      console.log(`[monthly-report] ✅ Explicitly set serial_converter data for inspection ${answer.id.toString()}:`, {
        status: serialConverter.status,
        comment: serialConverter.comment,
        question: serialConverter.question,
      });
    } else {
      console.warn(`[monthly-report] ⚠️ serial_converter data not found for inspection ${answer.id.toString()}`);
    }

    // Нэг үзлэгийн мэдээллийг array-д нэмэх
    inspectionsData.push(inspectionTemplateData);
  }

  // Template data бэлтгэх - inspections array-ийг дамжуулах
  const templateData = {
    inspections: inspectionsData,
    totalInspections: inspectionsData.length,
    year: year,
    month: month,
    monthName: new Date(year, month - 1).toLocaleString('mn-MN', { month: 'long' }),
  };

  console.log(`[monthly-report] Template data prepared with ${inspectionsData.length} inspections`);

  // Template-ийг боловсруулах
  let buffer = await templateHandler.process(templateFile, templateData);

  // Post-processing: DOCX файлыг цэвэрлэх (хоосон мөрүүдийг арилгах гэх мэт)
  buffer = await postProcessDocxBuffer(buffer, { context: 'monthly-report' });

  return buffer;
}

// Нэг сарын тайлан үүсгэх endpoint
router.get('/sites/:siteId/monthly-report', authMiddleware, async (req, res) => {
  try {
    const siteId = BigInt(req.params.siteId);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    if (month < 1 || month > 12) {
      return res.status(400).json({
        error: 'Invalid month',
        message: 'Month must be between 1 and 12',
      });
    }

    const buffer = await generateMonthlyReportDocx(siteId, year, month);

    const filename = `monthly-report-${siteId}-${year}-${month}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Error generating monthly report:', error);
    return res.status(500).json({
      error: 'Failed to generate monthly report',
      message: error.message,
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
// Export router as default
module.exports = Object.assign(router, exportedFunctions);




