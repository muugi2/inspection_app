'use strict';
/**
 * mountly_render.js
 * 1 сарын тайланг PDF хэлбэрээр үүсгэх тусдаа модуль.
 *
 * Шаардлагууд:
 *  1. Тухайн сарын бүх үзлэгийг тайланд оруулна (1 ч дутуу байж болохгүй).
 *  2. 1 үзлэг доторх тайлбар/зураг хоорондоо хэзээ ч солигдохгүй, дутахгүй.
 *  3. "Хэвийн" + зөвхөн тайлбар эсвэл зөвхөн зураг орсон бол хавсралтад тэр
 *     зураг/тайлбарыг байрлуулна. Бусад хэсэг хоосон байж болно.
 */

const path     = require('path');
const fsSync   = require('fs');
const { TemplateHandler, MimeType } = require('easy-template-x');
const sharp    = require('sharp');
const mammoth  = require('mammoth');
const JSZip    = require('jszip');

const { loadImagePayload, inferMimeType, normalizeRelativePath } = require('../utils/imageStorage');
const { PrismaClient } = require('@prisma/client');

// ─────────────────────────────────────────────────────────────
// Тогтмолууд
// ─────────────────────────────────────────────────────────────

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'mountly-template.docx');

/** Хавсралтын зургийн DOCX доторх логик хэмжээ (pixel, 96 DPI базис) */
const ATT_IMG_W = 280;
const ATT_IMG_H = 210;

/**
 * 1×1 цагаан PNG – "зураг байхгүй" тохиолдолд DOCX template-ийн image placeholder-ийг
 * орлуулахад ашиглана.
 * ШАЛТГААН: easy-template-x нь image placeholder-ийн утга null/undefined байвал
 * tag-ийн ТЕКСТИЙГ УСТГАДАГ боловч Drawing (зургийн) ELEMENT-ийг хэвээр үлдээдэг.
 * Үр дүнд нь template-д байх placeholder зураг (жишээ нь засварын зураг) давтагдаж
 * бүх хавсралтад харагддаг байсан.
 * BLANK_IMAGE ашиглавал Drawing element нь 1×1 цагаан пикселэр ОРЛОГДОЖ,
 * буруу зураг харагдахгүй болно.
 */
const BLANK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' +
  'AABjkB6QAAAABJRU5ErkJggg==';
let _blankImageObj = null;
function getBlankImage() {
  if (!_blankImageObj) {
    _blankImageObj = {
      _type:  'image',
      source: Buffer.from(BLANK_PNG_B64, 'base64'),
      format: MimeType.Png,
      width:  1,
      height: 1,
    };
  }
  return _blankImageObj;
}

/** DOCX template handler */
const templateHandler = new TemplateHandler({
  delimiters: {
    tagStart: '{{',
    tagEnd: '}}',
    containerTagOpen: '#',
    containerTagClose: '/',
  },
  fixRawXml: true,
  maxXmlDepth: 25,
});

// ─────────────────────────────────────────────────────────────
// Field mappings  (DB field_id → template placeholder key)
// ─────────────────────────────────────────────────────────────

const FIELD_MAPPINGS = {
  exterior: {
    sensor_base:        'sensor_base',
    beam:               'beam',
    base:               'base',           // DB дотор exterior.base байдаг
    platform_plate:     'platform_plate',
    beam_joint_plate:   'beam_joint_plate',
    stop_bolt:          'stop_bolt',
    interplatform_bolts:'interplatform_bolts',
  },
  indicator: {
    led_display:      'led_display',
    power_plug:       'power_plug',
    seal_bolt:        'seal_bolt',
    buttons:          'buttons',
    junction_wiring:  'junction_wiring',
    serial_converter: 'serial_converter_plug',  // DB: serial_converter → template: serial_converter_plug
    battery:          'battery',
    control_screen:   'control_screen',          // DB дотор indicator.control_screen байдаг
  },
  jbox: {
    box_integrity:    'box_integrity',
    collector_board:  'collector_board',
    wire_tightener:   'wire_tightener',
    resistor_element: 'resistor_element',
    protective_box:   'protective_box',
  },
  sensor: {
    signal_wire:  'signal_wire',
    ball:         'ball',
    base:         'base',
    ball_cup_thin:'ball_cup_thin',
    plate:        'plate',
    load_sensor:  'load_sensor',
  },
  foundation: {
    cross_base:   'cross_base',
    anchor_plate: 'anchor_plate',
    ramp_angle:   'ramp_angle',
    ramp_stopper: 'ramp_stopper',
    ramp:         'ramp',
    slab_base:    'slab_base',
    sensor_base:  'sensor_base',
  },
  cleanliness: {
    under_platform:    'under_platform',
    top_platform:      'top_platform',
    gap_platform_ramp: 'gap_platform_ramp',
    both_sides_area:   'both_sides_area',
  },
};

const SECTION_NAMES_MN = {
  exterior:    'Гадаад',
  indicator:   'Индикатор',
  jbox:        'J-Box',
  sensor:      'Мэдрэгч',
  foundation:  'Суурь',
  cleanliness: 'Цэвэрлэгээ',
};

const SECTION_ORDER = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];

// ─────────────────────────────────────────────────────────────
// Туслах функцүүд
// ─────────────────────────────────────────────────────────────

/** Статус утгыг хэвийн/сайжруулах/солих гэсэн 3 бүлэгт хөрвүүлэх */
function parseStatus(raw) {
  const s     = (raw || '').toString().trim();
  const lower = s.toLowerCase();
  if (!s) return { isNormal: '', needsImprovement: '', needsReplacement: '' };
  if (s === '+' || lower === 'normal'  || lower === 'хэвийн' || lower === 'цэвэр') {
    return { isNormal: 'Хэвийн', needsImprovement: '', needsReplacement: '' };
  }
  if (lower.includes('сайжруулах') || lower.includes('improve') || lower.includes('цэвэрлэх шаардлагатай')) {
    return { isNormal: '', needsImprovement: 'Сайжруулах шаардлагатай', needsReplacement: '' };
  }
  if (lower.includes('солих') || lower.includes('replace')) {
    return { isNormal: '', needsImprovement: '', needsReplacement: 'Солих шаардлагатай' };
  }
  return { isNormal: '', needsImprovement: '', needsReplacement: '' };
}

/**
 * Buffer + MIME type-оос easy-template-x-ийн image object үүсгэх.
 * targetW/H – DOCX доторх харагдах хэмжээ (pixel).
 */
async function makeDocxImage(buf, mimeType, targetW, targetH) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return null;
  try {
    const img  = sharp(buf);
    const meta = await img.metadata();
    const origW = meta.width  || targetW;
    const origH = meta.height || targetH;
    const ar    = origW / origH;

    let finalW, finalH;
    if (ar > targetW / targetH) {
      finalW = targetW;
      finalH = Math.round(targetW / ar);
    } else {
      finalH = targetH;
      finalW = Math.round(targetH * ar);
    }

    // EXIF orientation засаж, ЗУРАГИЙГ ЖИНХЭНЭЭР RESIZE ХИЙНЭ.
    // Өмнө нь зөвхөн width/height metadata өөрчлөгдөж, buffer нь анхны resolution-оороо
    // үлдэж байсан тул DOCX файлын хэмжээ маш том болж байсан.
    const pngBuf = await img
      .autoOrient()
      .resize(finalW, finalH, {
        fit: 'inside',
        withoutEnlargement: true,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    return {
      _type:  'image',
      source: pngBuf,
      format: MimeType.Png,
      width:  finalW,
      height: finalH,
    };
  } catch (e) {
    console.error('[mountly_render] makeDocxImage error:', e.message);
    return null;
  }
}

/** ftp_data доторх logo файлын бодит замыг олж буцаана (файл олдоогүй бол null). */
function resolveLogoPath() {
  const ftpStoragePath = path.resolve(process.env.FTP_STORAGE_PATH || 'C:/ftp_data');
  const logoName       = (process.env.LOGO_PATH || 'LOGO_PATH').replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  const candidates     = path.extname(logoName) ? [logoName] : [logoName, `${logoName}.png`, `${logoName}.jpg`, `${logoName}.jpeg`];
  for (const rel of candidates) {
    const full = path.resolve(ftpStoragePath, rel);
    if (full.startsWith(ftpStoragePath) && fsSync.existsSync(full)) return full;
  }
  return null;
}

/** ftp_data (FTP_STORAGE_PATH) доторх logo файлыг уншиж easy-template-x image object буцаана. Файлын нэр: LOGO_PATH (env эсвэл "LOGO_PATH"). */
async function loadLogoFromFtp() {
  const logoFullPath = resolveLogoPath();
  if (!logoFullPath) {
    console.warn('[mountly_render] Logo file not found in ftp_data.');
    return null;
  }
  try {
    const buf = fsSync.readFileSync(logoFullPath);
    const ext = path.extname(logoFullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
    const logoW = 150;
    const logoH = 80;
    const docxImg = await makeDocxImage(buf, mimeType, logoW, logoH);
    if (docxImg) console.log('[mountly_render] Logo loaded from ftp_data:', path.basename(logoFullPath));
    return docxImg || null;
  } catch (e) {
    console.warn('[mountly_render] Logo load failed:', e.message);
    return null;
  }
}

/** ftp_data-аас logo файлын Buffer буцаана (DOCX zip дотор бичихэд ашиглана). */
function loadLogoBufferFromFtp() {
  const logoFullPath = resolveLogoPath();
  if (!logoFullPath) return null;
  try {
    return fsSync.readFileSync(logoFullPath);
  } catch (e) {
    console.warn('[mountly_render] Logo buffer load failed:', e.message);
    return null;
  }
}

/** FTP storage-оос нэг зургийн Buffer ачааллах */
async function fetchImageBuffer(imageUrl) {
  const relPath = normalizeRelativePath(imageUrl);
  if (!relPath) return null;
  try {
    const payload = await loadImagePayload(relPath);
    if (!payload) return null;
    if (payload.buffer && Buffer.isBuffer(payload.buffer)) return payload.buffer;
    if (payload.base64) return Buffer.from(payload.base64, 'base64');
    return null;
  } catch (e) {
    console.warn('[mountly_render] fetchImageBuffer failed:', imageUrl, e.message);
    return null;
  }
}

/**
 * inspection_question_images хүснэгтээс нэг answer-ийн бүх зургийг ачааллаж,
 * 'section.field_id' → [docxImageObj, ...] хэлбэрт бүлэглэх.
 */
async function loadAnswerImages(prisma, answerId) {
  const rows = await prisma.$queryRaw`
    SELECT id, field_id, section, image_order, image_url
    FROM inspection_question_images
    WHERE answer_id = ${answerId}
    ORDER BY section, field_id, image_order
  `;

  const grouped = {};
  for (const row of rows) {
    const key = `${row.section}.${row.field_id}`;
    if (!grouped[key]) grouped[key] = [];

    const buf = await fetchImageBuffer(row.image_url);
    if (!buf) {
      console.warn(`[mountly_render] Could not load image: ${row.image_url}`);
      continue;
    }
    const mimeType = inferMimeType(normalizeRelativePath(row.image_url) || '');
    const docxImg  = await makeDocxImage(buf, mimeType, ATT_IMG_W, ATT_IMG_H);
    if (docxImg) grouped[key].push(docxImg);
  }
  return grouped;
}

/** base64 data URI-аас гарын үсгийн image object үүсгэх */
async function makeSignatureImage(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') return null;
  const m = dataUri.match(/^data:(.+);base64,(.+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], 'base64');
    return await makeDocxImage(buf, m[1], 180, 70);
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Нэг үзлэгийн template item бэлтгэх
// ─────────────────────────────────────────────────────────────

async function buildOneInspection(prisma, answer) {
  // ── 1. JSON answers задлах ───────────────────────────────
  let parsed = {};
  try {
    const raw = answer.answers;
    parsed = raw
      ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
      : {};
  } catch (e) {
    console.warn(`[mountly_render] JSON parse failed for answer ${answer.id}:`, e.message);
  }

  const dataRoot = parsed.data || parsed;
  const metadata = dataRoot.metadata || parsed.metadata || {};

  // ── 2. Гэрээний мэдээлэл ────────────────────────────────
  const inspection   = answer.inspection;
  const contractOrg  = inspection.contract?.organization || inspection.site?.organization;
  const deviceModel  = inspection.device?.model;
  const modelSpecs   = deviceModel?.specs || {};

  // Загварын мөр: "D2008 40М*3,4М 7"
  const pLen = metadata.platformLength  || metadata.platform_length  || modelSpecs.platformLength  ||
               modelSpecs.platform_size?.toString().split(/[*x×]/)[0]?.trim() || '';
  const pWid = metadata.platformWidth   || metadata.platform_width   || modelSpecs.platformWidth   ||
               modelSpecs.platform_size?.toString().split(/[*x×]/)[1]?.trim() || '';
  const pCnt = metadata.platformCount   || metadata.platform_count   || modelSpecs.platformCount   || '';
  const baseM = metadata.model || deviceModel?.model || '';
  const modelStr = [
    baseM,
    pLen && pWid ? `${pLen}М*${pWid}М` : '',
    pCnt ? pCnt.toString() : '',
  ].filter(Boolean).join(' ');

  // ── 3. Зургуудыг ачааллах (section.field_id → [docxImg]) ─
  const imagesByField = await loadAnswerImages(prisma, answer.id);

  // ── 4. Дууссан засваруудыг ачааллах ─────────────────────
  const repairs = await prisma.Repair.findMany({
    where: {
      inspectionId: inspection.id,
      repairStatus: { in: ['COMPLETED', 'VERIFIED'] },
    },
    include: { images: { orderBy: { uploadedAt: 'asc' } } },
    orderBy: [{ section: 'asc' }, { fieldId: 'asc' }],
  });
  // section.fieldId → Repair
  const repairMap = new Map(repairs.map(r => [`${r.section}.${r.fieldId}`, r]));

  // ── 5. inspectionItems + attachments бэлтгэх ─────────────
  const inspectionItems = [];
  const attachments     = [];
  let   attCounter      = 1;

  for (const sectionName of SECTION_ORDER) {
    const sectionData    = dataRoot[sectionName] || {};
    const sectionMapping = FIELD_MAPPINGS[sectionName] || {};

    for (const [dbFieldId, templateKey] of Object.entries(sectionMapping)) {
      // Field-ийн өгөгдөл (DB ба template key хоёуланг туршина)
      const fieldData  = sectionData[dbFieldId] || sectionData[templateKey] || {};
      const status     = (fieldData.status  || '').toString().trim();
      const comment    = (fieldData.comment || '').toString().trim();
      const question   = (fieldData.question|| '').toString().trim();
      const fieldName  = question || templateKey;

      const statusObj = parseStatus(status);

      // Энэ field-д хамаарах зурагнуудыг авах
      const imgKey     = `${sectionName}.${dbFieldId}`;
      const fieldImgs  = imagesByField[imgKey] || [];
      const hasImages  = fieldImgs.length > 0;
      const hasComment = comment.length > 0;

      // Засварын мэдээлэл
      const repair    = repairMap.get(`${sectionName}.${dbFieldId}`) || null;
      const hasRepair = !!repair;

      // ── Хавсралт үүсгэх нөхцөл (шинэчлэгдсэн) ─────────
      // 1. Ямар ч статустай байсан + (зураг ИЛЭ тайлбар) байвал → хавсралт
      // 2. Дууссан засвар байвал → хавсралт
      // Энэ нь шаардлага 3-ыг хангана: "Хэвийн" + зараг/тайлбар → хавсралт
      const shouldAttach = hasImages || hasComment || hasRepair;

      let attachmentText = '';

      if (shouldAttach) {
        const attNum = attCounter++;
        attachmentText = `Хавсралт №${attNum}`;

        // Хавсралтын объект – бүх field-ийг ҮРГЭЛЖ тодорхойлох (хоосон ч гэсэн)
        const att = {
          number:       attNum,
          fieldName:    fieldName,
          comment:      comment,        // хоосон байж болно, харин ҮРГЭЛЖ set
          imageAltText: '',
          // Repair мэдээлэл (хоосон default)
          'd.repair.section':       '',
          'd.repair.field':         '',
          'd.repair.section-field': '',
          'd.repair.before_text':   '',
          'd.repair.after_text':    '',
          'd.repair.before_image_alt': '',
          'd.repair.after_image_alt':  '',
        };

        // ── Хавсралтын үндсэн зураг (inspection үеийн 1-р зураг) ──────────
        // BLANK_IMAGE ашиглах нь ЗААВАЛ шаардлагатай:
        // easy-template-x-д image undefined байвал Drawing element хэвээр үлдэж
        // template-ийн placeholder зураг харагддаг.
        att.image        = hasImages ? fieldImgs[0] : getBlankImage();
        att.imageAltText = hasImages ? `Хавсралт №${attNum} - ${fieldName}` : '';

        // ── Засварын мэдээлэл ─────────────────────────────────────────────
        if (hasRepair) {
          const snMn = SECTION_NAMES_MN[sectionName] || sectionName;
          att['d.repair.section']       = snMn;
          att['d.repair.field']         = fieldName;
          att['d.repair.section-field'] = `${snMn}-${fieldName}`;
          att['d.repair.before_text']   = repair.originalStatus || '';
          att['d.repair.after_text']    = repair.repairDescription || '';

          // Өмнөх зураг: үзлэгийн зураг (байгаа бол), эсвэл BLANK
          att['d.repair.before_image']     = hasImages ? fieldImgs[0] : getBlankImage();
          att['d.repair.before_image_alt'] = hasImages ? `Өмнөх - ${fieldName}` : '';

          // Дараах зураг: засварын зураг (байгаа бол), эсвэл BLANK
          let afterImg = null;
          if (repair.images && repair.images.length > 0) {
            const afterUrl = repair.images[0].imageUrl || repair.images[0].image_url || '';
            const afterBuf = await fetchImageBuffer(afterUrl);
            if (afterBuf) {
              afterImg = await makeDocxImage(
                afterBuf,
                inferMimeType(normalizeRelativePath(afterUrl) || ''),
                ATT_IMG_W, ATT_IMG_H
              );
            }
          }
          att['d.repair.after_image']     = afterImg || getBlankImage();
          att['d.repair.after_image_alt'] = afterImg ? `Дараах - ${fieldName}` : '';
        } else {
          // Засвар байхгүй тохиолдолд:
          //   before_image = үзлэгийн зураг (байвал) – "өмнөх байдал" болгон харуулна
          //   after_image  = BLANK – засварын дараах зураг байхгүй
          // BLANK_IMAGE ЗААВАЛ тавих шалтгаан: undefined үлдвэл easy-template-x
          // scope fallback хийж template-ийн placeholder зураг (буруу зураг) харагддаг.
          att['d.repair.before_image']     = hasImages ? fieldImgs[0] : getBlankImage();
          att['d.repair.before_image_alt'] = hasImages ? fieldName : '';
          att['d.repair.after_image']      = getBlankImage();
          att['d.repair.after_image_alt']  = '';
        }

        // Nested d.repair structure (template дотор {{d.repair.section}} гэх мэтийг
        // easy-template-x нь attachment.d.repair-аас nested path-аар хайдаг)
        att.d = {
          repair: {
            section:      att['d.repair.section'],
            field:        att['d.repair.field'],
            before_text:  att['d.repair.before_text'],
            after_text:   att['d.repair.after_text'],
            before_image: att['d.repair.before_image'],
            after_image:  att['d.repair.after_image'],
          },
        };

        attachments.push(att);
      }

      // Inspection item (field question text эсвэл status байвал нэмнэ)
      if (status || comment || hasImages) {
        inspectionItems.push({
          fieldName:        fieldName,
          isNormal:         statusObj.isNormal,
          needsImprovement: statusObj.needsImprovement,
          needsReplacement: statusObj.needsReplacement,
          attachmentText:   attachmentText,
        });
      }
    }
  }

  // isFirst / isLast / index / total тохируулах
  inspectionItems.forEach((item, i) => {
    item.isFirst = i === 0;
    item.isLast  = i === inspectionItems.length - 1;
    item.index   = i;
    item.total   = inspectionItems.length;
  });

  // ── 6. Гарын үсэг ───────────────────────────────────────
  const sigImage = await makeSignatureImage(parsed.signatures?.inspector).catch(() => null);

  // ── 7. Template item object үүсгэх ─────────────────────
  // easy-template-x нь {{d.metadata.date}} → item['d.metadata.date'] (flat key) гэж уншдаг
  const item = {
    // Metadata (flat keys)
    'd.metadata.date':           metadata.date               || '',
    'd.metadata.inspector':      metadata.inspector           || '',
    'd.metadata.location':       metadata.location            || '',
    'd.metadata.scale_id_serial_no': metadata.scale_id_serial_no || '',
    'd.metadata.model':          modelStr,

    // Гэрээний мэдээлэл (flat keys)
    'd.contractor.company':      contractOrg?.name                    || '',
    'd.contractor.contract_no':  inspection.contract?.contractNumber  || '',
    'd.contractor.contact':      contractOrg?.contactPhone             || '',

    // Санал тэмдэглэл
    'd.remarks': (parsed.remarks || '').toString(),

    // Loop arrays (flat keys)
    'd.inspectionItems': inspectionItems,
    'd.attachments':     attachments,
  };

  // Гарын үсэг
  if (sigImage) item['d.signatures.inspector'] = sigImage;

  // Attachment-уудын зургийг indexed flat key-ээр ЗААВАЛ тавих.
  // ШАЛТГААН: easy-template-x нь nested loop ({{#inspections}}→{{#d.attachments}}) дотор
  // зургийн path-ийг root-оос тооцдог. Flat key байхгүй бол scope fallback хийж буруу
  // зургийг харуулна. Мөн зурагнуудыг (image/before_image/after_image) ЗААВАЛ тавих ёстой –
  // undefined үлдвэл template-ийн placeholder зураг хэвээр үлдэнэ.
  attachments.forEach((att, i) => {
    item[`d.attachments.${i}.number`]       = att.number;
    item[`d.attachments.${i}.fieldName`]    = att.fieldName;
    item[`d.attachments.${i}.comment`]      = att.comment;
    item[`d.attachments.${i}.imageAltText`] = att.imageAltText || '';
    // Зурагнуудыг ЗААВАЛ тавих (BLANK_IMAGE ч гэсэн тавина)
    item[`d.attachments.${i}.image`]               = att.image;
    item[`d.attachments.${i}.repair.section`]       = att['d.repair.section']       || '';
    item[`d.attachments.${i}.repair.field`]         = att['d.repair.field']         || '';
    item[`d.attachments.${i}.repair.section-field`] = att['d.repair.section-field'] || '';
    item[`d.attachments.${i}.repair.before_text`]   = att['d.repair.before_text']   || '';
    item[`d.attachments.${i}.repair.after_text`]    = att['d.repair.after_text']    || '';
    item[`d.attachments.${i}.repair.before_image`]  = att['d.repair.before_image'];
    item[`d.attachments.${i}.repair.after_image`]   = att['d.repair.after_image'];
    item[`d.attachments.${i}.repair.before_image_alt`] = att['d.repair.before_image_alt'] || '';
    item[`d.attachments.${i}.repair.after_image_alt`]  = att['d.repair.after_image_alt']  || '';
  });

  // Nested d object (template дотор {{d.metadata.date}} nested path-аар хайх тохиолдолд)
  item.d = {
    metadata: {
      date:                metadata.date               || '',
      inspector:           metadata.inspector           || '',
      location:            metadata.location            || '',
      scale_id_serial_no:  metadata.scale_id_serial_no || '',
      model:               modelStr,
    },
    contractor: {
      company:    contractOrg?.name                   || '',
      contract_no:inspection.contract?.contractNumber || '',
      contact:    contractOrg?.contactPhone            || '',
    },
    remarks:        (parsed.remarks || '').toString(),
    inspectionItems: inspectionItems,
    attachments:     attachments,
    signatures: { inspector: sigImage || null },
  };

  return item;
}

// ─────────────────────────────────────────────────────────────
// Бүх үзлэгийн template data бэлтгэх
// ─────────────────────────────────────────────────────────────

async function buildTemplateData(prisma, orgId, year, month, startDay = 1, endDay = null) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeStartDay = Math.max(1, Math.min(daysInMonth, Number(startDay) || 1));
  const safeEndDay = Math.max(
    safeStartDay,
    Math.min(daysInMonth, Number(endDay) || daysInMonth)
  );

  const startDate = new Date(year, month - 1, safeStartDay, 0, 0, 0, 0);
  const endDate   = new Date(year, month - 1, safeEndDay, 23, 59, 59, 999);

  console.log(`[mountly_render] Querying inspections for org=${orgId}, ${year}-${month}`);
  console.log(`[mountly_render] Date range: ${startDate.toISOString()} → ${endDate.toISOString()}`);

  const answers = await prisma.InspectionAnswer.findMany({
    where: {
      inspection: {
        site:      { orgId: BigInt(orgId) },
        deletedAt: null,
      },
      answeredAt: { gte: startDate, lte: endDate },
    },
    include: {
      inspection: {
        include: {
          contract: { include: { organization: true } },
          site:     { include: { organization: true } },
          device:   { include: { model: true } },
        },
      },
    },
    orderBy: { answeredAt: 'asc' },
  });

  if (answers.length === 0) {
    throw new Error(`${year} оны ${month} сарын ${safeStartDay}-${safeEndDay} хооронд org ${orgId}-д үзлэг олдсонгүй`);
  }

  console.log(`[mountly_render] Found ${answers.length} inspection answers`);

  const inspections = [];
  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    console.log(`[mountly_render] Building ${i + 1}/${answers.length} → answer ID: ${answer.id}`);
    try {
      const item = await buildOneInspection(prisma, answer);
      inspections.push(item);
    } catch (err) {
      console.error(`[mountly_render] ❌ Error building answer ${answer.id}:`, err.message);
      // Алдаа гарсан тохиолдолд тайлан дотор placeholder оруулах (тоог алдахгүй)
      inspections.push({
        'd.metadata.date':      '',
        'd.metadata.inspector': '⚠ Алдаа',
        'd.metadata.location':  `Answer ${answer.id}: ${err.message}`,
        'd.inspectionItems':    [],
        'd.attachments':        [],
        'd.remarks':            '',
        d: {
          metadata:    { date: '', inspector: '⚠ Алдаа', location: '', scale_id_serial_no: '', model: '' },
          contractor:  { company: '', contract_no: '', contact: '' },
          remarks:     '',
          inspectionItems: [],
          attachments: [],
          signatures:  { inspector: null },
        },
      });
    }
  }

  // Гэрээний мэдээлэл – тайлангийн header дотор
  const first       = inspections[0];
  const cCompany    = first?.['d.contractor.company']     || first?.d?.contractor?.company     || '';
  const cContractNo = first?.['d.contractor.contract_no'] || first?.d?.contractor?.contract_no || '';
  const cContact    = first?.['d.contractor.contact']     || first?.d?.contractor?.contact     || '';

  const templateData = {
    inspections,
    totalInspections: inspections.length,
    year,
    month,
    startDay: safeStartDay,
    endDay: safeEndDay,
    monthName: new Date(year, month - 1).toLocaleString('mn-MN', { month: 'long' }),
    // Template-ийн header хэсэгт contractor ({{d.contractor.company}} гэх мэт)
    d: {
      contractor: { company: cCompany, contract_no: cContractNo, contact: cContact },
    },
    'd.contractor.company':     cCompany,
    'd.contractor.contract_no': cContractNo,
    'd.contractor.contact':     cContact,
    contractor: { company: cCompany, contract_no: cContractNo, contact: cContact },
    'contractor.company':     cCompany,
    'contractor.contract_no': cContractNo,
    'contractor.contact':     cContact,
  };

  return templateData;
}

/** Template data-д logo нэмнэ (ftp_data-аас ачаалсан). generateDocx дуудахаас өмнө дуудагдана. */
async function injectLogoIntoTemplateData(templateData) {
  const logo = await loadLogoFromFtp();
  if (!logo) return;
  templateData.logo = logo;
  templateData['d.logo'] = logo;
  if (templateData.d) {
    templateData.d.logo = logo;
  }
}

/**
 * document.xml эсвэл header-ийн агуулгаас эхний r:embed (зургийн rId) олно.
 */
function findFirstImageRId(xmlContent) {
  const embedMatch = (xmlContent || '').match(/r:embed="(rId\d+)"/);
  return embedMatch ? embedMatch[1] : null;
}

/**
 * document.xml.rels-аас өгөгдсөн rId-тэй Relationship-ийн Target (media path) олно.
 */
function getTargetByRId(relsXml, rId) {
  const re = new RegExp(`<Relationship\\s+[^>]*Id="${rId}"[^>]*Target="([^"]+)"`, 'i');
  const m = relsXml.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<Relationship\\s+[^>]*Target="([^"]+)"[^>]*Id="${rId}"`, 'i');
  const m2 = relsXml.match(re2);
  return m2 ? m2[1] : null;
}

/**
 * DOCX buffer дотор лого байрлах хэсгийн зургийг (эхний зураг) ftp_data-ийн logo-ор солино.
 * Загварт {{d.logo}} текст байсан ч гэсэн эхний зураг байвал түүнийг солино; зураг байхгүй бол
 * body-ийн эхэнд логоор шинэ зураг оруулна.
 */
async function injectLogoIntoDocxBuffer(docxBuffer) {
  const logoBuf = loadLogoBufferFromFtp();
  if (!logoBuf || logoBuf.length === 0) return docxBuffer;
  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    if (!relsFile) return docxBuffer;
    const relsXml = await relsFile.async('string');

    let target = null;
    const docXmlFile = zip.file('word/document.xml');
    if (docXmlFile) {
      const docXml = await docXmlFile.async('string');
      const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
      const bodyContent = bodyMatch ? bodyMatch[1] : docXml;
      const firstRId = findFirstImageRId(bodyContent);
      if (firstRId) target = getTargetByRId(relsXml, firstRId);
    }
    if (!target && zip.file('word/header1.xml')) {
      const headerXml = await zip.file('word/header1.xml').async('string');
      const firstRId = findFirstImageRId(headerXml);
      if (firstRId) {
        const headerRelsPath = 'word/_rels/header1.xml.rels';
        const headerRels = zip.file(headerRelsPath) ? await zip.file(headerRelsPath).async('string') : '';
        target = headerRels ? getTargetByRId(headerRels, firstRId) : null;
        if (target) {
          target = target.replace(/^\/+/, '').trim();
          const mediaPath = target.startsWith('word/') ? target : 'word/' + target;
          zip.file(mediaPath, logoBuf);
          const out = await zip.generateAsync({ type: 'nodebuffer' });
          console.log('[mountly_render] Logo injected (header):', mediaPath);
          return out;
        }
      }
    }
    if (!target) {
      const firstMedia = relsXml.match(/Target="(media\/[^"]+)"/);
      if (firstMedia) target = firstMedia[1];
    }

    if (target) {
      target = target.replace(/^\/+/, '').trim();
      if (!target.toLowerCase().includes('media/')) target = 'media/' + target.replace(/^.*[/\\]/, '');
      const mediaPath = target.startsWith('word/') ? target : 'word/' + target;
      zip.file(mediaPath, logoBuf);
      const out = await zip.generateAsync({ type: 'nodebuffer' });
      console.log('[mountly_render] Logo injected into DOCX:', mediaPath);
      return out;
    }

    // Загварт зөвхөн {{d.logo}} текст байгаа (зураг байхгүй): шинэ media + body эхэнд логоор paragraph оруулна
    const rIdNumbers = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
    const nextRIdNum = rIdNumbers.length ? Math.max(...rIdNumbers) + 1 : 5;
    const newRId = `rId${nextRIdNum}`;
    const logoMediaPath = 'media/logo_inserted.png';
    const relsInsert = `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${logoMediaPath}"/>`;
    const relsClose = '</Relationships>';
    const newRelsXml = relsXml.replace(relsClose, relsInsert + relsClose);
    zip.file(relsPath, newRelsXml);
    zip.file('word/' + logoMediaPath, logoBuf);
    const cx = 14900;
    const cy = 7900;
    const logoParagraph = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Logo"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${newRId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fillRect/></a:stretch></pic:blipFill><pic:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const docXml = await zip.file('word/document.xml').async('string');
    const bodyOpenMatch = docXml.match(/(<w:body[^>]*>)/);
    if (bodyOpenMatch) {
      const newDocXml = docXml.replace(bodyOpenMatch[0], bodyOpenMatch[0] + logoParagraph);
      zip.file('word/document.xml', newDocXml);
      console.log('[mountly_render] Logo paragraph inserted at body start (no image in template).');
    }
    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch (e) {
    console.warn('[mountly_render] injectLogoIntoDocxBuffer failed:', e.message);
    return docxBuffer;
  }
}

// ─────────────────────────────────────────────────────────────
// Template preprocessing: Word XML placeholder fragmentation засах
// ─────────────────────────────────────────────────────────────

async function normalizeTemplatePlaceholders(docxBuffer) {
  // Word нь {{fieldName}} -ийг олон XML text node болгон хуваадаг.
  // JSZip-ээр word/document.xml болон бусад xml файлуудыг унших,
  // хуваагдсан placeholder-уудыг нэгтгэх.
  try {
    const zip  = await JSZip.loadAsync(docxBuffer);
    const xmlFiles = Object.keys(zip.files).filter(
      n => !zip.files[n].dir && (n.endsWith('.xml') || n.endsWith('.rels'))
    );

    for (const xmlPath of xmlFiles) {
      const content = await zip.file(xmlPath).async('string');
      // {{...}} хуваагдсан тохиолдол: <w:t>{{</w:t>...<w:t>fieldName</w:t>...<w:t>}}</w:t>
      // Regex-ээр нэгтгэх
      const fixed = content.replace(
        /\{\{([^{}]*?)\}\}/gs,
        (_, inner) => `{{${inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}}}`
      );
      if (fixed !== content) {
        zip.file(xmlPath, fixed);
      }
    }

    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch (e) {
    console.warn('[mountly_render] normalizeTemplatePlaceholders skipped:', e.message);
    return docxBuffer;
  }
}

// ─────────────────────────────────────────────────────────────
// DOCX үүсгэх
// ─────────────────────────────────────────────────────────────

async function generateDocx(templateData) {
  if (!fsSync.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template файл олдсонгүй: ${TEMPLATE_PATH}`);
  }

  let templateFile = fsSync.readFileSync(TEMPLATE_PATH);
  templateFile = await normalizeTemplatePlaceholders(templateFile);

  const buffer = await templateHandler.process(templateFile, templateData);
  console.log(`[mountly_render] DOCX үүсгэгдлээ, хэмжээ: ${buffer.length} bytes`);
  return buffer;
}

// ─────────────────────────────────────────────────────────────
// DOCX → HTML (mammoth)
// ─────────────────────────────────────────────────────────────

async function docxToHtml(docxBuffer) {
  const result = await mammoth.convertToHtml(
    { buffer: docxBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.imgElement(function (image) {
        return image.read('base64').then(function (b64) {
          const attrs = { src: `data:${image.contentType};base64,${b64}` };
          if (image.width  && typeof image.width  === 'number') attrs.width  = String(image.width);
          if (image.height && typeof image.height === 'number') attrs.height = String(image.height);
          return attrs;
        });
      }),
    }
  );

  if (result.messages && result.messages.length > 0) {
    result.messages.forEach(m => {
      if (m.type === 'error') console.error('[mountly_render] mammoth:', m.message);
      else                    console.warn('[mountly_render] mammoth:', m.message);
    });
  }

  return result.value;
}

// ─────────────────────────────────────────────────────────────
// HTML → PDF (Puppeteer)
// ─────────────────────────────────────────────────────────────

/* Өмнөх загварын дагуу: өнгө болон хүснэгтийн хэмжээ (documents.js monthly-report-тай ижил харагдах) */
const PAGE_CSS = `
  @page { margin: 2cm; size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: "Arial", "Times New Roman", "DejaVu Sans", "Mongolian Baiti", sans-serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    margin: 0;
    padding: 0;
    background-color: #fff;
  }
  p { margin: 3px 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
  }
  table:not([style*="border"]) {
    border: 1px solid #000;
  }
  table td:not([style]), table th:not([style]) {
    border: 1px solid #000;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  table td[style], table th[style] { }
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
  table tbody td:first-child:not([style*="background"]),
  table td:first-child:not([style*="background"]) {
    background-color: #D9D9D9;
    font-weight: bold;
    width: 30%;
  }
  img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 5px 0;
  }
  img[alt*="logo"], img[alt*="Logo"],
  img[src*="logo"], img[src*="Logo"],
  body > p:first-child img,
  body > div:first-child img {
    display: block;
    margin: 10px auto;
    text-align: center;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: "Arial", "Times New Roman", "DejaVu Sans", "Mongolian Baiti", sans-serif;
    margin: 10px 0;
    font-weight: bold;
    text-align: left !important;
  }
  h1 { text-align: left !important; font-size: 16pt; font-weight: bold; margin: 15px 0; }
  p[style*="text-align: center"] { text-align: left !important; }
  strong, b { font-weight: bold; }
  em, i { font-style: italic; }
  u { text-decoration: underline; }
`;

async function htmlToPdf(htmlContent) {
  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <style>${PAGE_CSS}</style>
</head>
<body>${htmlContent}</body>
</html>`;

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    throw new Error('puppeteer package олдсонгүй. npm install puppeteer хийнэ үү.');
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 600_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    page.setDefaultNavigationTimeout(180000);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 180000 });

    /* Өмнөх загвар: "Үзлэгийн тайлан" хүснэгтүүдэд class нэмж саарал header (#D9D9D9) ашиглана */
    await page.evaluate(() => {
      document.querySelectorAll('table').forEach((table) => {
        const text = (table.innerText || table.textContent || '');
        if (text.includes('Үзлэгийн эд анги') && text.includes('Төлөв') && text.includes('Хавсралт')) {
          table.classList.add('inspection-report-table');
        }
      });
    });
    await new Promise((r) => setTimeout(r, 300));

    const pdfBuf = await page.pdf({
      format:          'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
    });

    console.log(`[mountly_render] PDF үүсгэгдлээ, хэмжээ: ${pdfBuf.length} bytes`);
    return Buffer.from(pdfBuf);
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────
// Гол функц – нийтийн API
// ─────────────────────────────────────────────────────────────

/**
 * Тухайн байгууллага, жил, сарын бүх үзлэгийг агуулсан сарын тайлан PDF үүсгэнэ.
 * @param {number|bigint} orgId
 * @param {number} year
 * @param {number} month  1–12
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateMonthlyReportPdf(orgId, year, month, startDay = 1, endDay = null) {
  const prisma = new PrismaClient();
  try {
    console.log(
      `[mountly_render] === Generating monthly PDF: org=${orgId}, ${year}-${month}, day-range=${startDay}-${endDay ?? 'end'} ===`
    );
    const templateData = await buildTemplateData(prisma, orgId, year, month, startDay, endDay);
    await injectLogoIntoTemplateData(templateData);
    let docxBuffer     = await generateDocx(templateData);
    docxBuffer         = await injectLogoIntoDocxBuffer(docxBuffer);
    const htmlContent  = await docxToHtml(docxBuffer);
    const pdfBuffer    = await htmlToPdf(htmlContent);
    console.log(`[mountly_render] === Done ===`);
    return pdfBuffer;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { generateMonthlyReportPdf };
