const {
  loadImagePayload,
  inferMimeType,
  normalizeRelativePath,
  buildPublicUrl,
} = require('../utils/imageStorage');

function safeField(section = {}, key) {
  const item = section?.[key] || {};
  return {
    status: item.status || '',
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
  console.log(`[report-service] Loading ${rows.length} images for answer ${answerId}`);
  
  for (const row of rows) {
    console.log(`[report-service] Processing image:`, {
      id: row.id?.toString(),
      image_url: row.image_url,
      section: row.section,
      field_id: row.field_id,
      image_order: row.image_order,
    });

    const normalizedPath = normalizeRelativePath(row.image_url);
    console.log(`[report-service] Normalized path: ${normalizedPath} (from: ${row.image_url})`);

    if (!normalizedPath) {
      console.warn(`[report-service] ❌ Failed to normalize path: ${row.image_url}`);
      continue;
    }

    const payload = await loadImagePayload(normalizedPath);
    console.log(`[report-service] Image payload loaded:`, {
      hasBuffer: !!payload.buffer,
      bufferLength: payload.buffer?.length,
      hasBase64: !!payload.base64,
      base64Length: payload.base64?.length,
      size: payload.size,
      localPath: payload.localPath,
      error: payload.error,
    });

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
    console.log(`[report-service] Inferred MIME type: ${mimeType} (from: ${normalizedPath})`);

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

    console.log(`[report-service] Created image object:`, {
      id: imageObj.id,
      section: imageObj.section,
      fieldId: imageObj.fieldId,
      hasBuffer: !!imageObj.buffer,
      hasBase64: !!imageObj.base64,
      mimeType: imageObj.mimeType,
    });

    images.push(imageObj);
  }

  console.log(
    `[report-service] ✅ Loaded ${images.length} images (${images.filter(img => img.buffer).length} with buffer, ${images.filter(img => img.base64).length} with base64)`
  );
  return images;
}

function mapIndicatorSection(section = {}) {
  // Template-defined fields for indicator section
  const allowedFields = ['led_display', 'power_plug', 'seal_bolt', 'buttons', 'junction_wiring', 'serial_converter', 'battery'];
  
  // Debug: Check serial_converter data
  console.log('[report-service] mapIndicatorSection - serial_converter data:', {
    hasSerialConverter: !!section.serial_converter,
    serialConverterValue: section.serial_converter,
    sectionKeys: Object.keys(section),
  });
  
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
      console.log('[report-service] mapIndicatorSection - mapped serial_converter (both names):', serialConverterData);
    } else {
      mapped[field] = safeField(section, field);
    }
  });
  
  // Include any other fields from database
  const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
  Object.keys(section).forEach(key => {
    if (!excludedKeys.includes(key) && !allowedFields.includes(key)) {
      const value = section[key];
      if (value !== null && value !== undefined) {
        mapped[key] = safeField(section, key);
      }
    }
  });
  
  console.log('[report-service] mapIndicatorSection - final mapped keys:', Object.keys(mapped));
  console.log('[report-service] mapIndicatorSection - serial_converter in mapped:', mapped.serial_converter);
  console.log('[report-service] mapIndicatorSection - serial_converter_plug in mapped:', mapped.serial_converter_plug);
  
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
  const allowedFields = ['box_integrity', 'collector_board', 'wire_tightener', 'resistor_element', 'protective_box'];
  
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

  const d = {
    contractor: {
      company: contractorOrg?.name || '',
      contract_no: inspection.contract?.contractNumber || '',
      contact: contractorOrg?.code || '',
    },
    metadata: {
      date: metadata.date || '',
      inspector: metadata.inspector || '',
      location: metadata.location || '',
      scale_id_serial_no: metadata.scale_id_serial_no || '',
      model: metadata.model || inspection.device?.model?.model || '',
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
};

