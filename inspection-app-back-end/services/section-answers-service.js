const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Advanced service for handling section answers JSON processing and database operations
 */
class SectionAnswersService {
  
  /**
   * Process and save section answers to database
   * @param {Object} requestData - The processed request data
   * @param {Object} user - User information from auth middleware
   * @returns {Object} Result with section answer and metadata
   */
  async saveSectionAnswers(requestData, user) {
    try {
      console.log('=== SAVE SECTION ANSWERS START ===');
      console.log('Request data:', JSON.stringify(requestData, null, 2));
      console.log('User:', user);

      const {
        section,
        answers,
        progress,
        status,
        sectionStatus,
        data,
        answerId,
        sectionIndex,
        isFirstSection
      } = requestData;

      // Validation and setup
      this.validateRequest(requestData, user);
      const inspectionId = BigInt(requestData.inspectionId);
      const userId = BigInt(user.id);
      const normalizedSectionStatus = this.normalizeSectionStatus(sectionStatus);
      
      // Verify access and get inspection
      const inspection = await this.verifyInspectionAccess(inspectionId, userId, user.orgId, user.id);
      const statusValidation = this.validateStatus(status);
      
      if (!statusValidation.isValid) {
        throw new Error(`Status must be one of ${statusValidation.allowedStatuses.join(', ')}`);
      }

      // Get template information
      const templateInfo = await this.getTemplateInfo(inspection, requestData);
      const { template, sections, sectionOrder, currentSectionIndex, isLastSection } = templateInfo;

      // Check if this is completion
      // Don't mark as completion if it's remarks or signatures section
      const isCompletion = (statusValidation.normalizedStatus === 'SUBMITTED' || 
                          (normalizedSectionStatus === 'COMPLETED' && isLastSection)) &&
                          section !== 'remarks' && section !== 'signatures';
      
      console.log(`Processing section '${section}' for inspection ${inspectionId}:`, {
        section, currentIndex: currentSectionIndex, totalSections: sectionOrder.length,
        isLastSection, sectionStatus: normalizedSectionStatus, isCompletion, status: statusValidation.normalizedStatus
      });

      // Process and save to database
      const result = await this.processSectionData({
        inspectionId, userId, section, answers, data, answerId, sectionIndex, isFirstSection,
        isCompletion, sections, sectionOrder, currentSectionIndex, isLastSection,
        progress, statusValidation, normalizedSectionStatus, inspection
      });

      console.log('✅ Section answers saved successfully');
      return {
        result,
        nextSection: this.getNextSection(sectionOrder, currentSectionIndex),
        sectionOrder,
        currentSectionIndex,
        isLastSection,
        isCompletion,
        template: !!template
      };
    } catch (error) {
      console.error('❌ Error in saveSectionAnswers:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Validate request data
   */
  validateRequest(requestData, user) {
    try {
      console.log('=== VALIDATING REQUEST ===');
      console.log('Request data keys:', Object.keys(requestData));
      console.log('Section:', requestData.section);
      console.log('Answers type:', typeof requestData.answers);
      console.log('Answers:', requestData.answers);

      const required = ['inspectionId', 'section', 'answers'];
      const missing = required.filter(field => !requestData[field]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }

      if (typeof requestData.answers !== 'object' || Array.isArray(requestData.answers)) {
        throw new Error('answers must be a non-array object');
      }

      // Validate section data structure
      this.validateSectionData(requestData.section, requestData.answers);
      
      console.log('✅ Request validation passed');
    } catch (error) {
      console.error('❌ Request validation failed:', error.message);
      throw error;
    }
  }

  /**
   * Validate section data structure
   */
  validateSectionData(sectionName, answers) {
    // Skip validation for metadata, remarks, and signatures sections
    if (sectionName === 'metadata' || sectionName === 'remarks' || sectionName === 'signatures') {
      return;
    }

    // Validate that each field has proper structure
    Object.keys(answers).forEach(fieldKey => {
      if (fieldKey === 'metadata' || fieldKey === 'remarks' || fieldKey === 'signatures') return;
      
      const fieldData = answers[fieldKey];
      if (typeof fieldData === 'object' && fieldData !== null) {
        // Check if field has status
        if (!fieldData.status) {
          console.warn(`Field ${fieldKey} in section ${sectionName} missing status`);
        }
        
        // Validate comment if status indicates issues
        const problemStatuses = [
          'Сайжруулах шаардлагатай',
          'Солих шаардлагатай', 
          'Цэвэрлэх шаардлагатай',
          'Засварлах шаардлагатай'
        ];
        
        if (problemStatuses.includes(fieldData.status)) {
          if (!fieldData.comment || fieldData.comment.trim().length < 3) {
            console.warn(`Field ${fieldKey} in section ${sectionName} has problem status but missing or too short comment`);
          }
        }
      }
    });
  }

  /**
   * Normalize section status
   */
  normalizeSectionStatus(sectionStatus) {
    const validStatuses = ['IN_PROGRESS', 'COMPLETED', 'SKIPPED'];
    return sectionStatus && validStatuses.includes(sectionStatus.toUpperCase()) 
      ? sectionStatus.toUpperCase() 
      : 'IN_PROGRESS';
  }

  /**
   * Verify inspection exists and user has access
   */
  async verifyInspectionAccess(inspectionId, userId, orgIdFromToken, userStringId) {
    console.log('Looking for inspection with ID:', inspectionId.toString());
    
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        assignments: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!inspection) {
      console.error('❌ Inspection not found in database');
      throw new Error(`Inspection with ID ${inspectionId} does not exist`);
    }

    console.log('✅ Inspection found:', {
      id: inspection.id.toString(), orgId: inspection.orgId.toString(),
      assignedTo: inspection.assignedTo?.toString(), createdBy: inspection.createdBy.toString(),
      templateId: inspection.templateId?.toString(), status: inspection.status,
      assignmentsCount: inspection.assignments?.length || 0
    });

    // Check access
    // Check both assignedTo (legacy single assignment) and assignments (multiple assignments)
    const sameOrg = inspection.orgId.toString() === orgIdFromToken;
    const isAssignee = inspection.assignedTo?.toString() === userStringId;
    const isInAssignments = inspection.assignments?.some(
      assignment => assignment.userId?.toString() === userStringId
    ) || false;
    const isCreator = inspection.createdBy.toString() === userStringId;
    const hasAccess = sameOrg || isAssignee || isInAssignments || isCreator;

    console.log('Access check:', { 
      hasAccess, sameOrg, isAssignee, isInAssignments, isCreator,
      assignments: inspection.assignments?.map(a => a.userId.toString()) || []
    });
    
    if (!hasAccess) {
      console.error('❌ Access denied');
      throw new Error('You do not have access to this inspection');
    }

    return inspection;
  }

  /**
   * Validate status
   */
  validateStatus(status) {
    const allowedStatuses = ['DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELED'];
    const normalizedStatus = typeof status === 'string' && status.length > 0 ? status.toUpperCase() : undefined;

    return {
      normalizedStatus,
      isValid: !normalizedStatus || allowedStatuses.includes(normalizedStatus),
      allowedStatuses
    };
  }

  /**
   * Get template information
   */
  async getTemplateInfo(inspection, requestData) {
    console.log('Looking for template with ID:', inspection.templateId?.toString());
    let template = null;
    let sections = {};
    let sectionOrder = [];
    let currentSectionIndex = -1;
    let isLastSection = false;
    
    if (inspection.templateId) {
      template = await prisma.inspectionTemplate.findUnique({
        where: { id: inspection.templateId },
        select: { questions: true },
      });
      
      if (template) {
        console.log('✅ Template found - using for validation');
        const questions = typeof template.questions === 'string' ? JSON.parse(template.questions) : template.questions;
        sections = this.getTemplateSections(questions);
        sectionOrder = Object.keys(sections).sort((a, b) => sections[a].order - sections[b].order);
        currentSectionIndex = sectionOrder.indexOf(requestData.section || '');
        isLastSection = currentSectionIndex === sectionOrder.length - 1;
        
        console.log('Section info:', {
          requestedSection: requestData.section, availableSections: sectionOrder,
          currentSectionIndex, isLastSection, totalSections: sectionOrder.length
        });
      } else {
        console.warn('⚠️ Template not found - proceeding without template validation');
      }
    } else {
      console.log('ℹ️ No template assigned - proceeding without template validation');
    }

    return { template, sections, sectionOrder, currentSectionIndex, isLastSection };
  }

  /**
   * Get inspection template sections from test data structure
   */
  getTemplateSections(templateQuestions) {
    if (!templateQuestions || !Array.isArray(templateQuestions)) return {};

    const sections = {};
    templateQuestions.forEach((section, index) => {
      if (section.section && section.title && section.fields) {
        sections[section.section] = {
          name: section.section, title: section.title, order: index + 1,
          questions: section.fields.map(field => ({
            id: field.id, question: field.question, type: field.type,
            options: field.options || [], textRequired: field.text_required || false,
            imageRequired: field.image_required || false,
            required: field.text_required || field.image_required || false
          }))
        };
      }
    });

    return sections;
  }

  /**
   * Sort section data according to template field order
   */
  sortSectionDataByTemplate(sectionData, sectionName, sections) {
    if (!sectionData || !sections[sectionName]) return sectionData;

    const templateSection = sections[sectionName];
    const sortedData = {};

    templateSection.questions.forEach(question => {
      const fieldId = question.id;
      const possibleKeys = [
        fieldId, `field_${fieldId}`, fieldId.replace(/_/g, ''),
        fieldId.replace(/_status$/, ''), fieldId.replace(/_status$/, '').replace(/_/g, ''),
        fieldId.replace(/_status$/, '').replace(/_([a-z])/g, (match, letter) => letter.toUpperCase())
      ];

      for (const key of possibleKeys) {
        if (sectionData[key]) {
          sortedData[key] = sectionData[key];
          break;
        }
      }
    });

    // Add remaining fields
    Object.keys(sectionData).forEach(key => {
      if (!sortedData[key]) sortedData[key] = sectionData[key];
    });

    return sortedData;
  }

  /**
   * Process section data and save to database
   */
  async processSectionData(params) {
    return await prisma.$transaction(async (tx) => {
      try {
        const extractedMetadata = this.extractMetadata(params);
        const extractedRemarks = this.extractRemarks(params);
        const extractedSignatures = this.extractSignatures(params);
        
        return await this.handleDatabaseOperation({ tx, ...params, extractedMetadata, extractedRemarks, extractedSignatures });
      } catch (transactionError) {
        console.error('Transaction error:', transactionError);
        throw transactionError;
      }
    });
  }

  /**
   * Unified database operation handler
   */
  async handleDatabaseOperation(params) {
    const { tx, inspectionId, userId, section, answers, data, answerId, sections, extractedMetadata, extractedRemarks, extractedSignatures, isCompletion } = params;

    // Special handling for remarks section
    if (section === 'remarks' && extractedRemarks) {
      return await this.handleRemarksOperation({ tx, inspectionId, userId, extractedRemarks, answerId });
    }

    // Special handling for signatures section
    if (section === 'signatures' && extractedSignatures) {
      return await this.handleSignaturesOperation({ tx, inspectionId, userId, extractedSignatures, answerId });
    }

    // Handle completion - merge all sections
    if (isCompletion) {
      return await this.handleCompletionOperation({ tx, inspectionId, userId, section, answers, data, sections, extractedMetadata, extractedRemarks, extractedSignatures });
    }

    // Handle regular section save
    return await this.handleRegularOperation({ tx, inspectionId, userId, section, answers, data, answerId, sections, extractedMetadata, extractedRemarks, extractedSignatures });
  }

  /**
   * Extract metadata from first section
   */
  extractMetadata(params) {
    if (params.isFirstSection !== true) return null;
    
    const metadataFields = ['date', 'inspector', 'location', 'scale_id_serial_no', 'model'];
    const extractedMetadata = {};
    
    metadataFields.forEach(field => {
      if (params.answers[field] !== undefined) {
        extractedMetadata[field] = params.answers[field];
      }
    });
    
    // Extract remarks from remarks_field if present
    if (params.answers.remarks_field?.comment) {
      extractedMetadata.remarks = params.answers.remarks_field.comment;
    }
    
    // Extract remarks directly if present
    if (params.answers.remarks) {
      extractedMetadata.remarks = params.answers.remarks;
    }
    
    // Extract signatures if present
    if (params.answers.signatures) {
      extractedMetadata.signatures = params.answers.signatures;
    }
    
    console.log('Extracted metadata from first section:', extractedMetadata);
    return Object.keys(extractedMetadata).length > 0 ? extractedMetadata : null;
  }

  /**
   * Extract remarks from any section (including remarks section)
   */
  extractRemarks(params) {
    // Check if this is a remarks section
    if (params.section === 'remarks') {
      // Try different possible structures
      if (params.answers.remarks_field?.comment) {
        return params.answers.remarks_field.comment;
      }
      if (params.answers.remarks) {
        return params.answers.remarks;
      }
      if (typeof params.answers === 'string') {
        return params.answers;
      }
    }
    
    // Check if remarks_field exists in any section
    if (params.answers.remarks_field?.comment) {
      return params.answers.remarks_field.comment;
    }
    
    // Check if remarks exists directly in answers
    if (params.answers.remarks) {
      return params.answers.remarks;
    }
    
    return null;
  }

  /**
   * Extract signatures from any section
   */
  extractSignatures(params) {
    // Check if this is a signatures section
    if (params.section === 'signatures') {
      // If answers object contains signature data directly (e.g., {inspector: "...", ...})
      // Treat the entire answers object as signatures
      if (params.answers && typeof params.answers === 'object') {
        // Check if it's already a signatures object
      if (params.answers.signatures && typeof params.answers.signatures === 'object') {
        return params.answers.signatures;
      }
      if (params.answers.signature) {
        return params.answers.signature;
        }
        // If answers contains signature fields directly (e.g., inspector, etc.)
        // Return the entire answers object as signatures
        if (Object.keys(params.answers).length > 0) {
          return params.answers;
        }
      }
    }
    
    // Check if signatures exist in answers
    if (params.answers && params.answers.signatures && typeof params.answers.signatures === 'object') {
      return params.answers.signatures;
    }
    
    // Check if signature exists in answers
    if (params.answers && params.answers.signature) {
      return params.answers.signature;
    }
    
    return null;
  }

  /**
   * Unified database operation - create or update record
   */
  async performDatabaseOperation({ tx, operation, inspectionId, userId, answers, targetId = null, status = null }) {
    const baseData = { answeredBy: userId, answeredAt: new Date() };
    
    // For create operation, always set status (default to IN_PROGRESS if not provided)
    if (operation === 'create') {
      if (status) {
        baseData.status = status;
      } else {
        baseData.status = 'IN_PROGRESS'; // Default for new records
      }
      return await tx.inspectionAnswer.create({
        data: { inspectionId, answers, ...baseData }
      });
    } else if (operation === 'update' && targetId) {
      // For update operation, only update status if explicitly provided
      // This preserves existing status (e.g., IN_PROGRESS) when resuming
      if (status !== null && status !== undefined) {
        baseData.status = status;
      }
      // If status is null/undefined, don't include it in update (preserves existing status)
      return await tx.inspectionAnswer.update({
        where: { id: targetId },
        data: { answers, ...baseData }
      });
    }
    
    throw new Error(`Invalid database operation: ${operation}`);
  }

  /**
   * Merge remarks data with existing remarks
   */
  mergeRemarksData(currentRemarks, existingRemarks) {
    if (currentRemarks === undefined && existingRemarks === undefined) {
      return null;
    }

    if (typeof currentRemarks === 'string' && typeof existingRemarks === 'string') {
      // Both are strings - use current remarks (overwrite previous)
      return currentRemarks || existingRemarks;
    } else if (typeof currentRemarks === 'object' && typeof existingRemarks === 'object') {
      // Both are objects - deep merge
      return this.deepMerge(existingRemarks || {}, currentRemarks || {});
    } else {
      // One is string, one is object - use current or existing
      return currentRemarks !== undefined ? currentRemarks : existingRemarks;
    }
  }

  /**
   * Deep merge two objects
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Handle completion operation - merge all sections into final record
   */
  async handleCompletionOperation(params) {
    const { tx, inspectionId, userId, section, answers, data, sections, extractedMetadata, extractedRemarks, extractedSignatures } = params;

    // Get all previous section answers
    const allPreviousAnswers = await tx.inspectionAnswer.findMany({
      where: { inspectionId },
      orderBy: { answeredAt: 'asc' }
    });
    
    console.log(`Merging ${allPreviousAnswers.length} previous section records`);
    
    // Merge all previous answers
    let mergedData = {};
    let storedMetadata = null;
    let storedRemarks = null;
    let storedSignatures = null;
    
    allPreviousAnswers.forEach(prevAnswer => {
      const prevData = prevAnswer.answers || {};
      
      if (prevData.metadata) {
        storedMetadata = storedMetadata ? this.deepMerge(storedMetadata, prevData.metadata) : prevData.metadata;
      }
      
      if (prevData.remarks !== undefined) {
        // Handle both string and object remarks
        if (typeof prevData.remarks === 'string') {
          storedRemarks = prevData.remarks;
        } else if (typeof prevData.remarks === 'object') {
          storedRemarks = storedRemarks ? this.deepMerge(storedRemarks, prevData.remarks) : prevData.remarks;
        }
      }
      
      if (prevData.signatures !== undefined) {
        // Handle signatures object
        if (typeof prevData.signatures === 'object') {
          storedSignatures = storedSignatures ? this.deepMerge(storedSignatures, prevData.signatures) : prevData.signatures;
        }
      }
      
      const sectionData = prevData.data || prevData;
      if (sectionData && typeof sectionData === 'object') {
        Object.keys(sectionData).forEach(sectionName => {
          if (sectionName === 'metadata' || sectionName === 'remarks' || sectionName === 'signatures') return;
          
          if (!mergedData[sectionName]) mergedData[sectionName] = {};
          mergedData[sectionName] = this.deepMerge(mergedData[sectionName], sectionData[sectionName]);
        });
      }
    });
    
    // Add current section
    const finalMetadata = extractedMetadata ? this.deepMerge(storedMetadata || {}, extractedMetadata) : storedMetadata;
    let rawSectionData = data?.[section] || { ...answers };
    
    // Remove metadata fields from section data
    if (finalMetadata) {
      Object.keys(finalMetadata).forEach(key => delete rawSectionData[key]);
    }
    
    const sectionData = Object.keys(sections).length > 0 
      ? this.sortSectionDataByTemplate(rawSectionData, section, sections)
      : rawSectionData;
    
    mergedData[section] = sectionData;
    
    // Build final answers without data wrapper
    const finalAnswers = { ...mergedData };
    if (finalMetadata && Object.keys(finalMetadata).length > 0) {
      finalAnswers.metadata = finalMetadata;
    }
    
    // Merge remarks data - handle both string and object values
    const currentRemarks = extractedRemarks || data?.remarks || answers?.remarks;
    if (currentRemarks !== undefined || storedRemarks !== undefined) {
      const mergedRemarks = this.mergeRemarksData(currentRemarks, storedRemarks);
      if (mergedRemarks !== null) {
        finalAnswers.remarks = mergedRemarks;
        console.log('Merged remarks data:', finalAnswers.remarks);
      }
    }
    
    // Merge signatures data
    const currentSignatures = extractedSignatures || data?.signatures || answers?.signatures;
    if (currentSignatures !== undefined || storedSignatures !== undefined) {
      const mergedSignatures = storedSignatures ? this.deepMerge(storedSignatures, currentSignatures || {}) : currentSignatures;
      if (mergedSignatures !== null) {
        finalAnswers.signatures = mergedSignatures;
        console.log('Merged signatures data:', finalAnswers.signatures);
      }
    }
    
    console.log(`Merged ${Object.keys(mergedData).length} sections for final record`);
    
    // Delete all previous records and create final merged record
    const deleteResult = await tx.inspectionAnswer.deleteMany({ where: { inspectionId } });
    console.log(`Deleted ${deleteResult.count} previous section records`);
    
    const sectionAnswer = await this.performDatabaseOperation({
      tx,
      operation: 'create',
      inspectionId,
      userId,
      answers: finalAnswers,
      status: 'COMPLETED'
    });
    
    console.log(`Created final merged record ${sectionAnswer.id} (status: COMPLETED)`);
    return { sectionAnswer, didCreate: true, extractedMetadata };
  }

  /**
   * Handle regular section operation
   */
  async handleRegularOperation(params) {
    const { tx, inspectionId, userId, section, answers, data, answerId, sections, extractedMetadata, extractedRemarks, extractedSignatures } = params;


    // Process section data
    let rawSectionData = data?.[section] || { ...answers };
    
    if (extractedMetadata) {
      Object.keys(extractedMetadata).forEach(key => delete rawSectionData[key]);
    }

    const sectionData = Object.keys(sections).length > 0 
      ? this.sortSectionDataByTemplate(rawSectionData, section, sections)
      : rawSectionData;

    // Find target answer row
    let targetAnswer = null;
    if (answerId) {
      try {
        const found = await tx.inspectionAnswer.findUnique({ where: { id: BigInt(answerId) } });
        if (found && found.inspectionId === inspectionId) targetAnswer = found;
      } catch (e) {
        console.warn('Invalid answerId provided. A new row will be created.');
      }
    }

    let sectionAnswer;
    let didCreate = false;

    if (!targetAnswer) {
      // Create new record
      const sectionAnswers = { [section]: sectionData };
      if (extractedMetadata) sectionAnswers.metadata = extractedMetadata;
      
      // Add remarks data if present
      if (extractedRemarks) {
        sectionAnswers.remarks = extractedRemarks;
      } else {
        const currentRemarks = data?.remarks || answers?.remarks;
        if (currentRemarks) sectionAnswers.remarks = currentRemarks;
      }
      
      // Add signatures data if present
      if (extractedSignatures) {
        sectionAnswers.signatures = extractedSignatures;
      } else {
        const currentSignatures = data?.signatures || answers?.signatures;
        if (currentSignatures) sectionAnswers.signatures = currentSignatures;
      }
      
      sectionAnswer = await this.performDatabaseOperation({
        tx,
        operation: 'create',
        inspectionId,
        userId,
        answers: sectionAnswers,
        status: 'IN_PROGRESS' // New record should be IN_PROGRESS
      });
      didCreate = true;
      console.log(`Created initial answer record ${sectionAnswer.id} for section '${section}' with status IN_PROGRESS`);
    } else {
      // Update existing record - preserve IN_PROGRESS status if it exists
      const existing = targetAnswer.answers || {};
      const existingData = existing.data || existing;
      
      const mergedData = { 
        ...existingData, 
        [section]: { ...(existingData[section] || {}), ...sectionData } 
      };
      
      const merged = { ...mergedData };
      if (extractedMetadata) {
        merged.metadata = { ...(existing.metadata || {}), ...extractedMetadata };
      } else if (existing.metadata) {
        merged.metadata = existing.metadata;
      }
      
      // Merge remarks data - handle both string and object values
      const currentRemarks = extractedRemarks || data?.remarks || answers?.remarks;
      const mergedRemarks = this.mergeRemarksData(currentRemarks, existing.remarks);
      if (mergedRemarks !== null) {
        merged.remarks = mergedRemarks;
        console.log('Merged remarks data:', merged.remarks);
      }
      
      // Merge signatures data
      const currentSignatures = extractedSignatures || data?.signatures || answers?.signatures;
      if (currentSignatures !== undefined || existing.signatures !== undefined) {
        const mergedSignatures = existing.signatures ? this.deepMerge(existing.signatures, currentSignatures || {}) : currentSignatures;
        if (mergedSignatures !== null) {
          merged.signatures = mergedSignatures;
          console.log('Merged signatures data:', merged.signatures);
        }
      }
      
      // Preserve IN_PROGRESS status when updating existing record (resume scenario)
      // If the existing record has IN_PROGRESS status, keep it as IN_PROGRESS
      // Otherwise, don't change the status (pass null to preserve existing)
      const currentStatus = targetAnswer.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : null;
      
      sectionAnswer = await this.performDatabaseOperation({
        tx,
        operation: 'update',
        inspectionId,
        userId,
        answers: merged,
        targetId: targetAnswer.id,
        status: currentStatus // Preserve IN_PROGRESS status when resuming
      });
      console.log(`Updated answer record ${sectionAnswer.id} by merging section '${section}' with status ${currentStatus || 'unchanged (preserved existing)'}`);
    }

    return { sectionAnswer, didCreate, extractedMetadata };
  }

  /**
   * Handle remarks operation
   */
  async handleRemarksOperation({ tx, inspectionId, userId, extractedRemarks, answerId }) {
    console.log('🔍 Looking for main inspection record for inspectionId:', inspectionId.toString());
    console.log('🔍 Provided answerId:', answerId);
    
    // If answerId is provided, use that specific record
    if (answerId) {
      const targetAnswer = await tx.inspectionAnswer.findFirst({
        where: { 
          id: BigInt(answerId),
          inspectionId
        }
      });
      
      if (targetAnswer) {
        console.log('🔍 Found target answer record:', targetAnswer.id.toString());
        
        const existingAnswers = targetAnswer.answers || {};
        const updatedAnswers = {
          ...existingAnswers,
          remarks: extractedRemarks
        };
        
        const updatedAnswer = await this.performDatabaseOperation({
          tx,
          operation: 'update',
          inspectionId,
          userId,
          answers: updatedAnswers,
          targetId: targetAnswer.id
        });
        
        console.log(`✅ Updated target record ${updatedAnswer.id} with remarks:`, extractedRemarks);
        return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
      } else {
        console.log('⚠️ Target answer record not found, falling back to main record search');
      }
    }
    
    // Find the main inspection answer record (the one with all sections)
    // First try to find record with data field
    let mainAnswer = await tx.inspectionAnswer.findFirst({
      where: { 
        inspectionId,
        answers: {
          path: '$.data',
          not: null
        }
      },
      orderBy: { answeredAt: 'asc' }
    });

    // If not found, try to find record with multiple sections (jbox, sensor, exterior, etc.)
    if (!mainAnswer) {
      const sectionPaths = ['$.jbox', '$.sensor', '$.exterior', '$.indicator', '$.foundation', '$.cleanliness'];
      
      for (const path of sectionPaths) {
        mainAnswer = await tx.inspectionAnswer.findFirst({
          where: { 
            inspectionId,
            answers: {
              path: path,
              not: null
            }
          },
          orderBy: { answeredAt: 'asc' }
        });
        
        if (mainAnswer) {
          console.log(`🔍 Found main record with ${path} section`);
          break;
        }
      }
    }

    // If still not found, try to find record with metadata
    if (!mainAnswer) {
      mainAnswer = await tx.inspectionAnswer.findFirst({
        where: { 
          inspectionId,
          answers: {
            path: '$.metadata',
            not: null
          }
        },
        orderBy: { answeredAt: 'asc' }
      });
    }

    console.log('🔍 Found main answer record:', mainAnswer ? mainAnswer.id.toString() : 'NOT FOUND');

    if (!mainAnswer) {
      // Try to find any record for this inspection
      const anyAnswer = await tx.inspectionAnswer.findFirst({
        where: { inspectionId },
        orderBy: { answeredAt: 'asc' }
      });
      
      console.log('🔍 Any answer record found:', anyAnswer ? anyAnswer.id.toString() : 'NOT FOUND');
      
      if (!anyAnswer) {
        throw new Error('No inspection record found for this inspection ID. Please save sections first.');
      }
      
      // Use the first available record
      const updatedAnswers = {
        ...anyAnswer.answers,
        remarks: extractedRemarks
      };
      
      const updatedAnswer = await this.performDatabaseOperation({
        tx,
        operation: 'update',
        inspectionId,
        userId,
        answers: updatedAnswers,
        targetId: anyAnswer.id
      });
      
      console.log(`✅ Updated record ${updatedAnswer.id} with remarks:`, extractedRemarks);
      return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
    }

    // Clean up any existing separate remarks records
    await tx.inspectionAnswer.deleteMany({
      where: {
        inspectionId,
        answers: {
          path: '$.remarks',
          not: null
        },
        id: {
          not: mainAnswer.id
        }
      }
    });

    const existingAnswers = mainAnswer.answers || {};
    console.log('🔍 Existing answers before update:', JSON.stringify(existingAnswers, null, 2));
    
    const updatedAnswers = {
      ...existingAnswers,
      remarks: extractedRemarks
    };
    
    console.log('🔍 Updated answers with remarks:', JSON.stringify(updatedAnswers, null, 2));

    const updatedAnswer = await this.performDatabaseOperation({
      tx,
      operation: 'update',
      inspectionId,
      userId,
      answers: updatedAnswers,
      targetId: mainAnswer.id
    });

    console.log(`✅ Updated main record ${updatedAnswer.id} with remarks:`, extractedRemarks);
    console.log('🔍 Final saved answers:', JSON.stringify(updatedAnswer.answers, null, 2));
    return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
  }

  /**
   * Handle signatures operation
   */
  async handleSignaturesOperation({ tx, inspectionId, userId, extractedSignatures, answerId }) {
    console.log('🔍 Looking for main inspection record for signatures, inspectionId:', inspectionId.toString());
    console.log('🔍 Provided answerId:', answerId);
    
    // If answerId is provided, use that specific record
    if (answerId) {
      const targetAnswer = await tx.inspectionAnswer.findFirst({
        where: { 
          id: BigInt(answerId),
          inspectionId
        }
      });
      
      if (targetAnswer) {
        console.log('🔍 Found target answer record:', targetAnswer.id.toString());
        
        const existingAnswers = targetAnswer.answers || {};
        const updatedAnswers = {
          ...existingAnswers,
          signatures: extractedSignatures
        };
        
        const updatedAnswer = await this.performDatabaseOperation({
          tx,
          operation: 'update',
          inspectionId,
          userId,
          answers: updatedAnswers,
          targetId: targetAnswer.id,
          status: 'COMPLETED'
        });
        
        console.log(`✅ Updated target record ${updatedAnswer.id} with signatures:`, extractedSignatures);
        return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
      } else {
        console.log('⚠️ Target answer record not found, falling back to main record search');
      }
    }
    
    // Find the main inspection answer record (the one with all sections)
    // First try to find record with data field
    let mainAnswer = await tx.inspectionAnswer.findFirst({
      where: { 
        inspectionId,
        answers: {
          path: '$.data',
          not: null
        }
      },
      orderBy: { answeredAt: 'asc' }
    });

    // If not found, try to find record with multiple sections (jbox, sensor, exterior, etc.)
    if (!mainAnswer) {
      const sectionPaths = ['$.jbox', '$.sensor', '$.exterior', '$.indicator', '$.foundation', '$.cleanliness'];
      
      for (const path of sectionPaths) {
        mainAnswer = await tx.inspectionAnswer.findFirst({
          where: { 
            inspectionId,
            answers: {
              path: path,
              not: null
            }
          },
          orderBy: { answeredAt: 'asc' }
        });
        
        if (mainAnswer) {
          console.log(`🔍 Found main record with ${path} section`);
          break;
        }
      }
    }

    // If still not found, try to find record with metadata
    if (!mainAnswer) {
      mainAnswer = await tx.inspectionAnswer.findFirst({
        where: { 
          inspectionId,
          answers: {
            path: '$.metadata',
            not: null
          }
        },
        orderBy: { answeredAt: 'asc' }
      });
    }

    console.log('🔍 Found main answer record for signatures:', mainAnswer ? mainAnswer.id.toString() : 'NOT FOUND');

    if (!mainAnswer) {
      // Try to find any record for this inspection
      const anyAnswer = await tx.inspectionAnswer.findFirst({
        where: { inspectionId },
        orderBy: { answeredAt: 'asc' }
      });
      
      console.log('🔍 Any answer record found for signatures:', anyAnswer ? anyAnswer.id.toString() : 'NOT FOUND');
      
      if (!anyAnswer) {
        throw new Error('No inspection record found for this inspection ID. Please save sections first.');
      }
      
      // Use the first available record
      const updatedAnswers = {
        ...anyAnswer.answers,
        signatures: extractedSignatures
      };
      
      const updatedAnswer = await this.performDatabaseOperation({
        tx,
        operation: 'update',
        inspectionId,
        userId,
        answers: updatedAnswers,
        targetId: anyAnswer.id,
        status: 'COMPLETED'
      });
      
      console.log(`✅ Updated record ${updatedAnswer.id} with signatures:`, extractedSignatures);
      return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
    }

    // Clean up any existing separate signatures records
    await tx.inspectionAnswer.deleteMany({
      where: {
        inspectionId,
        answers: {
          path: '$.signatures',
          not: null
        },
        id: {
          not: mainAnswer.id
        }
      }
    });

    const existingAnswers = mainAnswer.answers || {};
    console.log('🔍 Existing answers before update:', JSON.stringify(existingAnswers, null, 2));
    
    const updatedAnswers = {
      ...existingAnswers,
      signatures: extractedSignatures
    };
    
    console.log('🔍 Updated answers with signatures:', JSON.stringify(updatedAnswers, null, 2));

    const updatedAnswer = await this.performDatabaseOperation({
      tx,
      operation: 'update',
      inspectionId,
      userId,
      answers: updatedAnswers,
      targetId: mainAnswer.id,
      status: 'COMPLETED'
    });

    console.log(`✅ Updated main record ${updatedAnswer.id} with signatures (status: COMPLETED):`, extractedSignatures);
    console.log('🔍 Final saved answers:', JSON.stringify(updatedAnswer.answers, null, 2));
    return { sectionAnswer: updatedAnswer, didCreate: false, extractedMetadata: null };
  }

  /**
   * Get next section information
   */
  getNextSection(sectionOrder, currentSectionIndex) {
    return sectionOrder.length > 0 && currentSectionIndex >= 0 && currentSectionIndex < sectionOrder.length - 1 
      ? sectionOrder[currentSectionIndex + 1] 
      : null;
  }
}

module.exports = new SectionAnswersService();