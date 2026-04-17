/**
 * Суурьлуулалтын тайлангийн өгөгдөл бэлтгэх
 * Template: d.contractor, d.installationItems[] (metadata, acts[], sections[] with titles[])
 */

function parseSettlementQuestions(questions) {
  if (!questions) return [];
  try {
    const raw = typeof questions === 'string' ? JSON.parse(questions) : questions;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && Array.isArray(raw.sections)) return raw.sections;
    if (raw && typeof raw === 'object' && Array.isArray(raw.data)) return raw.data;
    return [];
  } catch (e) {
    console.warn('[installation-report] parseSettlementQuestions error:', e.message);
    return [];
  }
}

/**
 * @param {object} prisma - PrismaClient
 * @param {string} contractId - Гэрээний ID
 * @returns {Promise<{ d: object }>} - Template-д өгөх өгөгдөл
 */
async function buildInstallationReportData(prisma, contractId) {
  const cId = BigInt(contractId);

  // Гэрээ + байгууллага (contractor)
  const contractRows = await prisma.$queryRawUnsafe(`
    SELECT c.id, c.contract_name, c.contract_number, c.org_id,
           o.name as org_name, o.contact_phone, o.contact_email
    FROM contracts c
    LEFT JOIN organizations o ON c.org_id = o.id
    WHERE c.id = ?
    LIMIT 1
  `, cId);

  const contract = contractRows?.[0];
  if (!contract) {
    throw new Error('Гэрээ олдсонгүй');
  }

  const contractor = {
    company: contract.org_name || contract.contract_name || '',
    contract_no: contract.contract_number || '',
    contact: [contract.contact_phone, contract.contact_email].filter(Boolean).join(', ') || '',
  };

  // Тухайн гэрээний бүх installation_assignments (давталт бүр нэг "суурьлуулалт")
  const assignments = await prisma.$queryRawUnsafe(`
    SELECT ia.id,
           ia.contract_id,
           ia.template_id,
           ia.title,
           ia.status,
           ia.created_at,
           ia.extra_info,
           st.name as template_name,
           st.questions as template_questions,
           st.device_type
    FROM installation_assignments ia
    LEFT JOIN settlement_template st ON ia.template_id = st.id
    WHERE ia.contract_id = ?
    ORDER BY ia.title, ia.id
  `, cId);

  const safeParseExtraInfo = (raw, assignmentIdForLog) => {
    if (!raw) return {};
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn(
        '[installation-report] extra_info parse error for assignment',
        assignmentIdForLog,
        ':',
        e.message
      );
      return {};
    }
  };

  const buildMetadataFromGroup = (rows) => {
    const rowWithExtra = rows.find((r) => !!r.extra_info) || rows[0];
    const extraInfo = safeParseExtraInfo(rowWithExtra?.extra_info, rowWithExtra?.id);

    const earliestCreated = rows
      .map((r) => (r.created_at ? new Date(r.created_at) : null))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];

    const deviceTypes = Array.from(
      new Set(rows.map((r) => String(r.device_type || '').trim()).filter(Boolean))
    );

    return {
      date: earliestCreated ? earliestCreated.toISOString().slice(0, 10) : '',
      inspector: '',
      location: '',
      scale_id_serial_no: '',
      model: deviceTypes.join(', '),
      truck_total_length_m: extraInfo.truck_total_length_m ?? null,
      platform: {
        length_m: extraInfo.platform?.length_m ?? null,
        width_m: extraInfo.platform?.width_m ?? null,
        count: extraInfo.platform?.count ?? null,
      },
      capacity_kg: extraInfo.capacity_kg ?? null,
      indicator: {
        type: extraInfo.indicator?.type ?? null,
        model: extraInfo.indicator?.model ?? '',
      },
      manufacturer_model: extraInfo.manufacturer_model ?? '',
      load_cell: {
        count: extraInfo.load_cell?.count ?? null,
      },
      junction_box: {
        count: extraInfo.junction_box?.count ?? null,
      },
    };
  };

  const mergeSections = (sectionsList) => {
    const byTitle = new Map();
    for (const sec of sectionsList || []) {
      const sTitle = String(sec?.title || '').trim();
      if (!sTitle) continue;
      if (!byTitle.has(sTitle)) {
        byTitle.set(sTitle, { title: sTitle, titles: [] });
      }
      const target = byTitle.get(sTitle);
      const existingKey = new Set(
        (target.titles || []).map((t) => `${String(t.titleName || '').trim()}||${String(t.question || '').trim()}`)
      );
      for (const t of sec?.titles || []) {
        const key = `${String(t.titleName || '').trim()}||${String(t.question || '').trim()}`;
        if (existingKey.has(key)) {
          // merge into existing
          const idx = (target.titles || []).findIndex(
            (x) =>
              `${String(x.titleName || '').trim()}||${String(x.question || '').trim()}` === key
          );
          if (idx >= 0) {
            const prev = target.titles[idx];
            const nextComment = prev.comment ? prev.comment : t.comment;
            const prevImgs = Array.isArray(prev.images) ? prev.images : [];
            const nextImgs = Array.isArray(t.images) ? t.images : [];
            target.titles[idx] = {
              ...prev,
              comment: nextComment,
              images: [...prevImgs, ...nextImgs],
            };
          }
          continue;
        }
        existingKey.add(key);
        target.titles.push(t);
      }
    }
    return Array.from(byTitle.values()).filter((s) => (s.titles || []).length > 0);
  };

  const buildActsForRow = async (row) => {
    const actsRows = await prisma.$queryRawUnsafe(`
      SELECT id, act_title, comment, image_url, file_name, created_at
      FROM installation_acts
      WHERE installation_assignment_id = ? AND template_id = ?
      ORDER BY created_at ASC
    `, row.id, row.template_id);

    return (actsRows || []).map((a) => ({
      actTitle: a.act_title || '',
      actComment: a.comment || '',
      actImage: a.image_url || null,
    }));
  };

  const buildSectionsForRow = async (row) => {
    const templateId = row.template_id?.toString();
    const sectionsFromTemplate = parseSettlementQuestions(row.template_questions);

    const sections = [];
    let answersBySection = {};
    let imagesBySectionField = [];

    if (templateId) {
      const answerRows = await prisma.$queryRawUnsafe(`
        SELECT id, answers FROM installation_answers
        WHERE installation_assignment_id = ? AND template_id = ?
        LIMIT 1
      `, row.id, row.template_id);
      if (answerRows?.[0]?.answers) {
        const raw = answerRows[0].answers;
        try {
          answersBySection = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (_) {}
      }

      const imageRows = await prisma.$queryRawUnsafe(`
        SELECT id, section, field_id, image_order, image_url, template_id
        FROM installation_answer_images
        WHERE installation_assignment_id = ?
        ORDER BY section, field_id, image_order, id
      `, row.id);

      imagesBySectionField = imageRows || [];
    }

    const buildSectionsFromImages = () => {
      const sectionMap = {};
      for (const img of imagesBySectionField) {
        const sTitle = String(img.section || '').trim();
        const fId = String(img.field_id ?? '').trim();
        if (!sTitle) continue;
        if (!sectionMap[sTitle]) sectionMap[sTitle] = {};
        if (!sectionMap[sTitle][fId]) sectionMap[sTitle][fId] = { fieldId: fId, question: fId };
      }
      const result = [];
      for (const [sTitle, fieldsMap] of Object.entries(sectionMap)) {
        result.push({
          title: sTitle,
          section: sTitle,
          fields: Object.values(fieldsMap).map((f) => ({ id: f.fieldId, question: f.question })),
        });
      }
      return result;
    };

    let sectionsToUse = sectionsFromTemplate;
    if (imagesBySectionField.length > 0) {
      if (sectionsFromTemplate.length === 0) {
        sectionsToUse = buildSectionsFromImages();
      } else {
        const imageSections = new Set(imagesBySectionField.map((i) => String(i.section || '').trim()));
        const templateSections = new Set(sectionsFromTemplate.map((s) => String(s.title || s.section || '').trim()));
        const hasMatch = [...imageSections].some((s) => s && templateSections.has(s));
        if (!hasMatch) {
          sectionsToUse = buildSectionsFromImages();
        }
      }
    }

    const imagesIndex = {};
    for (const img of imagesBySectionField || []) {
      const sTitle = String(img.section || '').trim();
      const fId = String(img.field_id ?? '').trim();
      if (!sTitle || !fId) continue;
      if (!imagesIndex[sTitle]) imagesIndex[sTitle] = {};
      if (!imagesIndex[sTitle][fId]) imagesIndex[sTitle][fId] = [];
      imagesIndex[sTitle][fId].push(img);
    }

    for (const sec of sectionsToUse) {
      const sectionTitle = String(sec.title || sec.section || '').trim();
      const templateFields = sec.fields || [];
      const titles = [];

      const sectionAnswers = answersBySection?.[sectionTitle] || {};
      const imageFieldIds = new Set(Object.keys(imagesIndex[sectionTitle] || {}));
      const answerFieldIds = new Set(Object.keys(sectionAnswers || {}));

      const orderedFieldIds = [];
      const seen = new Set();
      for (const f of templateFields) {
        const fid = String(f?.id ?? '').trim();
        if (!fid || seen.has(fid)) continue;
        orderedFieldIds.push(fid);
        seen.add(fid);
      }
      for (const fid of [...imageFieldIds, ...answerFieldIds]) {
        if (!fid || seen.has(fid)) continue;
        orderedFieldIds.push(fid);
        seen.add(fid);
      }

      const questionById = {};
      for (const f of templateFields) {
        const fid = String(f?.id ?? '').trim();
        if (!fid) continue;
        questionById[fid] = f?.question || '';
      }

      for (const fieldId of orderedFieldIds) {
        const question = questionById[fieldId] || '';
        const fieldData = sectionAnswers?.[fieldId] || {};
        const comment = (fieldData.comment || '').trim();

        const imgs = (imagesIndex[sectionTitle]?.[fieldId] || [])
          .sort((a, b) => {
            const ao = Number(a.image_order || 0);
            const bo = Number(b.image_order || 0);
            if (ao !== bo) return ao - bo;
            const aid = a.id == null ? null : BigInt(a.id);
            const bid = b.id == null ? null : BigInt(b.id);
            if (aid == null && bid == null) return 0;
            if (aid == null) return 1;
            if (bid == null) return -1;
            return aid < bid ? -1 : aid > bid ? 1 : 0;
          })
          .map((img) => ({ imageUrl: img.image_url }));

        if (comment === '' && imgs.length === 0) continue;

        titles.push({
          titleName: question || fieldId,
          question: question || fieldId,
          comment,
          images: imgs,
        });
      }

      if (titles.length > 0) {
        sections.push({
          title: sectionTitle,
          titles,
        });
      }
    }

    return sections;
  };

  // Group by "суурьлуулалтын ажил" (ихэвчлэн title нь нэг ажилд нийтлэг байдаг)
  const grouped = new Map();
  for (const row of assignments || []) {
    const key = String(row.title || '').trim() || `assignment:${row.id?.toString?.() || row.id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const installationItems = [];

  for (const [groupTitle, rows] of grouped.entries()) {
    const metadata = buildMetadataFromGroup(rows);

    // Debug: group metadata once
    console.log('[installation-report] Metadata for group', groupTitle, ':', {
      truck_total_length_m: metadata.truck_total_length_m,
      platform: metadata.platform,
      capacity_kg: metadata.capacity_kg,
      indicator: metadata.indicator,
      manufacturer_model: metadata.manufacturer_model,
      load_cell: metadata.load_cell,
      junction_box: metadata.junction_box,
    });

    // Build acts/sections from each template row and merge
    const actsNested = await Promise.all(rows.map(buildActsForRow));
    const acts = actsNested.flat();

    const sectionsNested = await Promise.all(rows.map(buildSectionsForRow));
    const sections = mergeSections(sectionsNested.flat());

    const hasMetadata =
      metadata.truck_total_length_m != null ||
      metadata.capacity_kg != null ||
      (metadata.platform &&
        (metadata.platform.length_m != null ||
          metadata.platform.width_m != null ||
          metadata.platform.count != null)) ||
      (metadata.load_cell && metadata.load_cell.count != null) ||
      (metadata.junction_box && metadata.junction_box.count != null) ||
      (metadata.indicator &&
        (metadata.indicator.type != null || metadata.indicator.model));

    const hasContent =
      hasMetadata || (acts && acts.length > 0) || (sections && sections.length > 0);

    if (!hasContent) continue;

    installationItems.push({
      metadata,
      acts,
      sections,
      // Flattened fields for template convenience
      truck_total_length_m: metadata.truck_total_length_m ?? null,
      platform_length_m: metadata.platform?.length_m ?? null,
      platform_width_m: metadata.platform?.width_m ?? null,
      platform_count: metadata.platform?.count ?? null,
      capacity_kg: metadata.capacity_kg ?? null,
      indicator_type: metadata.indicator?.type ?? null,
      indicator_model: metadata.indicator?.model ?? '',
      manufacturer_model: metadata.manufacturer_model ?? '',
      load_cell_count: metadata.load_cell?.count ?? null,
      junction_box_count: metadata.junction_box?.count ?? null,
    });
  }

  return {
    d: {
      contractor,
      installationItems,
    },
  };
}

module.exports = {
  buildInstallationReportData,
  parseSettlementQuestions,
};
