const {
  loadImagePayload,
  inferMimeType,
  normalizeRelativePath,
  buildPublicUrl,
} = require('../utils/imageStorage');

/**
 * Convert status value to display text for template
 * @param {string} status - Original status value
 * @returns {string} - Display text for template
 */
function formatStatusForTemplate(status) {
  if (!status) return '';
  
  const normalized = status.trim().toLowerCase();
  
  // Handle "+" symbol and "normal" status
  if (status === '+' || normalized === 'normal' || normalized === 'хэвийн' || normalized === 'цэвэр') {
    return 'Хэвийн';
  }
  
  // Handle "improve" or "сайжруулах" status
  if (normalized.includes('сайжруулах') || normalized.includes('improve') || normalized.includes('цэвэрлэх шаардлагатай')) {
    return 'Сайжруулах шаардлагатай';
  }
  
  // Handle "replace" or "солих" status
  if (normalized.includes('солих') || normalized.includes('replace')) {
    return 'Солих шаардлагатай';
  }
  
  // Return original status if no match
  return status;
}

function safeField(section = {}, key) {
  const item = section?.[key] || {};
  return {
    status: formatStatusForTemplate(item.status || ''),
    comment: item.comment || '',
    question: item.question || '',
  };
}

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

async function loadImagesForAnswer(prisma, answerId) {
  try {
    // Check if table exists first
    const tableCheck = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'inspection_question_images'
    `;
    const tableExists = tableCheck[0]?.count > 0;

    if (!tableExists) {
      console.warn('[report-service] ⚠️ inspection_question_images table does not exist. Returning empty images array.');
      return [];
    }

    const rows = await prisma.$queryRaw`
      SELECT
        id,
        field_id,
        section,
        image_order,
        image_url,
        uploaded_at
      FROM inspection_question_images
      WHERE answer_id = ${answerId}
      ORDER BY section, field_id, image_order;
    `;

    const images = [];
    
    for (const row of rows) {
      const normalizedPath = normalizeRelativePath(row.image_url);

      if (!normalizedPath) {
        console.warn(`[report-service] ❌ Failed to normalize path: ${row.image_url}`);
        continue;
      }

      const payload = await loadImagePayload(normalizedPath);

      if (!payload.buffer && !payload.base64) {
        console.error(
          `[report-service] ❌ Failed to load image payload for: ${normalizedPath}`,
          {
            error: payload.error,
            localPath: payload.localPath,
          }
        );
        // Continue anyway - will create image object without image data
      }

      const mimeType = inferMimeType(normalizedPath);

      const imageObj = {
        id: row.id?.toString() || null,
        section: row.section || null,
        fieldId: row.field_id || null,
        order: Number(row.image_order) || 0,
        imageUrl: buildPublicUrl(normalizedPath),
        storagePath: normalizedPath,
        // Prefer binary buffer for DOCX generation; keep base64 for APIs that still use it
        buffer: payload.buffer || null,
        base64: payload.base64 || null,
        mimeType,
        uploadedAt: row.uploaded_at || null,
      };

      images.push(imageObj);
    }
    return images;
  } catch (error) {
    console.error('[report-service] ❌ Error loading images for answer:', error.message);
    console.error('[report-service] Error details:', {
      code: error.code,
      message: error.message,
      answerId: answerId?.toString(),
    });
    // Return empty array if table doesn't exist or other error occurs
    return [];
  }
}

function mapIndicatorSection(section = {}) {
  // Template-defined fields for indicator section
  const allowedFields = ['led_display', 'power_plug', 'seal_bolt', 'buttons', 'junction_wiring', 'serial_converter', 'control_screen', 'battery'];
  
  const mapped = {};
  allowedFields.forEach(field => {
    // Template uses d.indicator.serial_converter.status, so keep serial_converter as is
    // Also add serial_converter_plug for backward compatibility with frontend
    if (field === 'serial_converter') {
      const serialConverterData = safeField(section, 'serial_converter');
      // Keep original name for template compatibility
      mapped['serial_converter'] = serialConverterData;
      // Also add serial_converter_plug for frontend display compatibility
      mapped['serial_converter_plug'] = serialConverterData;
    } else if (field !== 'battery') {
      // Skip battery field as it's removed from display
      mapped[field] = safeField(section, field);
    }
  });
  
  // Include any other fields from database
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt', 'battery'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

function mapFoundationSection(section = {}) {
  const allowedFields = ['cross_base', 'anchor_plate', 'ramp_angle', 'ramp_stopper', 'ramp', 'slab_base', 'sensor_base'];
  
  const mapped = {};
  allowedFields.forEach(field => {
    mapped[field] = safeField(section, field);
  });
  
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

function mapCleanlinessSection(section = {}) {
  const allowedFields = ['under_platform', 'top_platform', 'gap_platform_ramp', 'both_sides_area'];
  
  const mapped = {};
  allowedFields.forEach(field => {
    mapped[field] = safeField(section, field);
  });
  
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

function mapExteriorSection(section = {}) {
  // Template-defined fields for exterior section
  const allowedFields = ['platform_plate', 'beam_joint_plate', 'stop_bolt', 'interplatform_bolts'];
  
  // Start with template-defined fields
  const mapped = {};
  allowedFields.forEach(field => {
    mapped[field] = safeField(section, field);
  });
  
  // Also include any other fields from database (for template flexibility)
  // Filter out metadata and non-field keys
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      // Include new fields that might have been added to template
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

function mapJboxSection(section = {}) {
  const allowedFields = ['box_integrity', 'collector_board', 'wire_tightener', 'resistor_element', 'resistance_element', 'protective_box'];
  
  const mapped = {};
  allowedFields.forEach(field => {
    mapped[field] = safeField(section, field);
  });
  
  // Handle both resistor_element and resistance_element (backend may use either)
  if (section.resistance_element && !mapped.resistance_element) {
    mapped['resistance_element'] = safeField(section, 'resistance_element');
  }
  if (section.resistor_element && !mapped.resistor_element) {
    mapped['resistor_element'] = safeField(section, 'resistor_element');
  }
  
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

function mapSensorSection(section = {}) {
  const allowedFields = ['signal_wire', 'ball', 'base', 'ball_cup_thin', 'plate'];
  
  const mapped = {};
  allowedFields.forEach(field => {
    mapped[field] = safeField(section, field);
  });
  
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  return mapped;
}

async function buildInspectionReportData(
  prisma,
  identifiers = {}
) {
  let inspectionId = null;
  let answer = null;

  if (
    identifiers &&
    typeof identifiers === 'object' &&
    identifiers !== null
  ) {
    if (identifiers.answerId) {
      const answerId = BigInt(identifiers.answerId);
      answer = await prisma.InspectionAnswer.findUnique({
        where: { id: answerId },
      });
      if (!answer) {
        throw new Error('Inspection answer not found');
      }
      inspectionId = answer.inspectionId;
    }

    if (identifiers.inspectionId) {
      inspectionId = BigInt(identifiers.inspectionId);
    }
  } else if (identifiers) {
    inspectionId = BigInt(identifiers);
  }

  if (!inspectionId) {
    throw new Error('Inspection ID is required');
  }

  const inspection = await prisma.Inspection.findUnique({
    where: { id: inspectionId },
    include: {
      contract: { include: { organization: true } },
      site: { include: { organization: true } },
      device: { include: { model: true } },
    },
  });

  if (!inspection) {
    throw new Error('Inspection not found');
  }

  if (!answer) {
    answer = await prisma.InspectionAnswer.findFirst({
      where: { inspectionId },
      orderBy: [
        { answeredAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  let parsedAnswers = {};
  if (answer?.answers) {
    try {
      parsedAnswers =
        typeof answer.answers === 'string'
          ? JSON.parse(answer.answers)
          : answer.answers;
    } catch (error) {
      console.warn(
        '[report-service] Failed to parse answers JSON:',
        error.message
      );
    }
  }

  const dataRoot = parsedAnswers.data || parsedAnswers;
  const metadata = dataRoot.metadata || parsedAnswers.metadata || {};

  const contractorOrg =
    inspection.contract?.organization ||
    inspection.site?.organization ||
    null;

  const signatureInspector = extractSignatureImage(
    parsedAnswers.signatures?.inspector
  );

  // Extract FTP image (same structure as signature image)
  const ftpImage = extractSignatureImage(
    parsedAnswers.ftp_image || parsedAnswers.ftp_data
  );

  const images = answer
    ? await loadImagesForAnswer(prisma, answer.id)
    : [];

  // Extract platform dimensions from device model specs or metadata
  const deviceModel = inspection.device?.model;
  const modelSpecs = deviceModel?.specs || {};
  
  // Parse platform_size if it exists (format: "3*1.5" or "3 x 1.5")
  let parsedLength = '';
  let parsedWidth = '';
  if (modelSpecs.platform_size) {
    const sizeStr = modelSpecs.platform_size.toString();
    const parts = sizeStr.split(/[*x×]/).map(p => p.trim());
    if (parts.length === 2) {
      parsedLength = parts[0];
      parsedWidth = parts[1];
    }
  }
  
  const platformLength = metadata.platformLength || metadata.platform_length || modelSpecs.platformLength || modelSpecs.platform_length || parsedLength || '';
  const platformWidth = metadata.platformWidth || metadata.platform_width || modelSpecs.platformWidth || modelSpecs.platform_width || parsedWidth || '';
  const platformCount = metadata.platformCount || metadata.platform_count || modelSpecs.platformCount || modelSpecs.platform_count || '';

  // Build model string with platform dimensions and count
  // Format: "D2008 40М*3,4М 7"
  const baseModel = metadata.model || inspection.device?.model?.model || '';
  const modelParts = [];
  if (baseModel) {
    modelParts.push(baseModel);
  }
  
  // Add platform dimensions: lengthМ*widthМ
  if (platformLength && platformWidth) {
    const lengthStr = typeof platformLength === 'number' 
      ? `${platformLength}М` 
      : platformLength.toString().trim().replace(/\s*м\s*$/i, '') + 'М';
    const widthStr = typeof platformWidth === 'number' 
      ? `${platformWidth}М` 
      : platformWidth.toString().trim().replace(/\s*м\s*$/i, '') + 'М';
    modelParts.push(`${lengthStr}*${widthStr}`);
  }
  
  // Add count
  if (platformCount) {
    modelParts.push(platformCount.toString());
  }
  
  const modelString = modelParts.join(' ');

  const d = {
    contractor: {
      company: contractorOrg?.name || '',
      contract_no: inspection.contract?.contractNumber || '',
      contact: contractorOrg?.contactPhone || '',
    },
    metadata: {
      date: metadata.date || '',
      inspector: metadata.inspector || '',
      location: metadata.location || '',
      scale_id_serial_no: metadata.scale_id_serial_no || '',
      model: modelString,
      platformLength: platformLength,
      platformWidth: platformWidth,
      platformCount: platformCount,
    },
    exterior: mapExteriorSection(dataRoot.exterior),
    indicator: mapIndicatorSection(dataRoot.indicator),
    jbox: mapJboxSection(dataRoot.jbox),
    sensor: mapSensorSection(dataRoot.sensor),
    foundation: mapFoundationSection(dataRoot.foundation),
    cleanliness: mapCleanlinessSection(dataRoot.cleanliness),
    remarks: parsedAnswers.remarks || '',
    signatures: {
      inspector: signatureInspector,
    },
    ftp_image: ftpImage,
    images,
  };

  return {
    inspection: {
      id: inspection.id.toString(),
      title: inspection.title,
      status: inspection.status,
      type: inspection.type,
    },
    answer: answer
      ? {
          id: answer.id.toString(),
          answeredAt: answer.answeredAt,
        }
      : null,
    d,
  };
}

module.exports = {
  buildInspectionReportData,
  mapExteriorSection,
  mapIndicatorSection,
  mapJboxSection,
  mapSensorSection,
  mapFoundationSection,
  mapCleanlinessSection,
  formatStatusForTemplate,
};

