const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs').promises;
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const FTP_STORAGE_PATH = process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
};

// GET /api/inspection-answers - Fetch all inspection answers
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 50, inspectionId, answeredBy } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = {};
    if (inspectionId) {
      where.inspectionId = BigInt(inspectionId);
    }
    if (answeredBy) {
      where.answeredBy = BigInt(answeredBy);
    }

    const [answers, total] = await Promise.all([
      prisma.InspectionAnswer.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { answeredAt: 'desc' },
        include: {
          inspection: {
            include: {
              device: {
                include: {
                  model: true,
                  site: {
                    include: {
                      organization: true
                    }
                  }
                }
              },
              assignee: {
                include: {
                  organization: true
                }
              }
            }
          },
          user: {
            include: {
              organization: true
            }
          }
        }
      }),
      prisma.InspectionAnswer.count({ where })
    ]);

    return res.json({
      message: 'Inspection answers retrieved successfully',
      data: serializeBigInt(answers),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error getting inspection answers:', error);
    return res.status(500).json({
      error: 'Failed to get inspection answers',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// GET /api/inspection-answers/:id - Fetch inspection answer by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    let answerId;
    try {
      answerId = BigInt(id);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid id',
        message: 'id must be a numeric identifier'
      });
    }

    const answer = await prisma.InspectionAnswer.findUnique({
      where: { id: answerId },
      include: {
        inspection: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            progress: true,
            scheduledAt: true,
            startedAt: true,
            completedAt: true,
          }
        },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            organization: {
              select: {
                id: true,
                name: true,
                code: true,
              }
            }
          }
        }
      }
    });

    if (!answer) {
      return res.status(404).json({
        error: 'Not found',
        message: `Inspection answer with ID ${id} does not exist`
      });
    }

    return res.json({
      message: 'Inspection answer retrieved successfully',
      data: serializeBigInt({
        id: answer.id.toString(),
        inspectionId: answer.inspectionId.toString(),
        answers: answer.answers,
        answeredBy: answer.answeredBy ? answer.answeredBy.toString() : null,
        answeredAt: answer.answeredAt,
        createdAt: answer.createdAt,
        updatedAt: answer.updatedAt,
        inspection: answer.inspection ? {
          id: answer.inspection.id.toString(),
          title: answer.inspection.title,
          type: answer.inspection.type,
          status: answer.inspection.status,
          progress: answer.inspection.progress,
          scheduledAt: answer.inspection.scheduledAt,
          startedAt: answer.inspection.startedAt,
          completedAt: answer.inspection.completedAt,
        } : null,
        user: answer.user ? {
          id: answer.user.id.toString(),
          fullName: answer.user.fullName,
          email: answer.user.email,
          organization: answer.user.organization ? {
            id: answer.user.organization.id.toString(),
            name: answer.user.organization.name,
            code: answer.user.organization.code,
          } : null,
        } : null,
      })
    });
  } catch (error) {
    console.error('Error getting inspection answer:', error);
    return res.status(500).json({
      error: 'Failed to get inspection answer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// PUT /api/inspection-answers/:id - Update inspection answer (date, remarks, or comment)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, remarks, section, fieldId, comment } = req.body;

    let answerId;
    try {
      answerId = BigInt(id);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid id',
        message: 'id must be a numeric identifier'
      });
    }

    // Validate that at least one field is provided
    if (date === undefined && remarks === undefined && comment === undefined) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'At least one field (date, remarks, or comment) must be provided'
      });
    }

    // Validate comment fields
    if (comment !== undefined) {
      if (!section || !fieldId) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'section and fieldId are required when updating comment'
        });
      }
    }

    // Get existing answer
    const existingAnswer = await prisma.InspectionAnswer.findUnique({
      where: { id: answerId }
    });

    if (!existingAnswer) {
      return res.status(404).json({
        error: 'Not found',
        message: `Inspection answer with ID ${id} does not exist`
      });
    }

    // Parse existing answers JSON - IMPORTANT: Deep clone to avoid mutating original
    let parsedAnswers = {};
    try {
      const originalAnswers = typeof existingAnswer.answers === 'string'
        ? JSON.parse(existingAnswer.answers)
        : existingAnswer.answers || {};
      // Deep clone to preserve all existing data
      parsedAnswers = JSON.parse(JSON.stringify(originalAnswers));
      
      // CRITICAL: Preserve existing structure - do NOT add data wrapper if it doesn't exist
      // Only normalize if data wrapper already exists
      const sectionsToNormalize = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
      
      // Only normalize if data wrapper already exists
      // If data wrapper doesn't exist, preserve the original structure (sections at top level)
      if (parsedAnswers.data) {
        // Data wrapper exists - normalize by moving top-level sections into data
        for (const sec of sectionsToNormalize) {
          if (parsedAnswers[sec]) {
            console.log(`[PUT /api/inspection-answers/:id] Normalizing: Moving ${sec} from top level to data`);
            // If section exists in both, merge them (data takes precedence, but merge top-level into it)
            if (parsedAnswers.data[sec]) {
              // Deep merge: preserve data version but add any missing fields from top-level
              parsedAnswers.data[sec] = {
                ...parsedAnswers[sec],
                ...parsedAnswers.data[sec]
              };
            } else {
              parsedAnswers.data[sec] = parsedAnswers[sec];
            }
            // Always delete from top-level after moving
            delete parsedAnswers[sec];
          }
        }
      } else {
        // Data wrapper doesn't exist - preserve original structure
        // Do NOT create data wrapper - keep sections at top level
        console.log(`[PUT /api/inspection-answers/:id] No data wrapper found - preserving original structure`);
      }
      
      // Debug: Log structure to verify we're preserving all sections
      const sections = parsedAnswers.data ? Object.keys(parsedAnswers.data).filter(k => k !== 'metadata') : [];
      console.log(`[PUT /api/inspection-answers/:id] After initial normalization, ${sections.length} sections in data:`, sections);
    } catch (error) {
      console.warn('[PUT /api/inspection-answers/:id] Failed to parse existing answers:', error.message);
      parsedAnswers = {};
    }

    // Update metadata.date if provided
    // Support both formats: answers.metadata.date and answers.data.metadata.date
    // IMPORTANT: Only update specific fields, preserve all other data
    if (date !== undefined) {
      // Update top-level metadata if it exists, otherwise create it
      // But preserve all other metadata fields
      if (parsedAnswers.metadata) {
        // Preserve existing metadata fields, only update date
        parsedAnswers.metadata = {
          ...parsedAnswers.metadata,
          date: date
        };
      } else {
        // Create new metadata object with only date
        parsedAnswers.metadata = { date };
      }
      
      // CRITICAL: Do NOT update data.metadata - metadata should only be at top level
      // This prevents duplication and ensures consistent structure
      // If data.metadata exists, it will be removed in final validation
    }

    // Update remarks if provided
    // remarks is at top level: answers.remarks
    // This does not affect any other fields
    if (remarks !== undefined) {
      parsedAnswers.remarks = remarks;
    }

    // Update comment if provided
    // comment location depends on structure: answers.data[section][fieldId].comment OR answers[section][fieldId].comment
    // IMPORTANT: Only update comment, preserve status and question
    // CRITICAL: Preserve existing structure - do NOT add data wrapper if it doesn't exist
    if (comment !== undefined && section && fieldId) {
      // Determine if data wrapper exists
      const hasDataWrapper = !!parsedAnswers.data;
      
      if (hasDataWrapper) {
        // Structure has data wrapper - use data[section][fieldId]
        if (!parsedAnswers.data[section]) {
          parsedAnswers.data[section] = {};
        }
        
        // Ensure field exists, preserve status and question
        if (!parsedAnswers.data[section][fieldId]) {
          parsedAnswers.data[section][fieldId] = {
            status: '',
            comment: '',
            question: ''
          };
        } else {
          // Preserve existing status and question, only update comment
          parsedAnswers.data[section][fieldId] = {
            ...parsedAnswers.data[section][fieldId],
            comment: comment
          };
        }
      } else {
        // Structure does NOT have data wrapper - use top-level [section][fieldId]
        if (!parsedAnswers[section]) {
          parsedAnswers[section] = {};
        }
        
        // Ensure field exists, preserve status and question
        if (!parsedAnswers[section][fieldId]) {
          parsedAnswers[section][fieldId] = {
            status: '',
            comment: '',
            question: ''
          };
        } else {
          // Preserve existing status and question, only update comment
          parsedAnswers[section][fieldId] = {
            ...parsedAnswers[section][fieldId],
            comment: comment
          };
        }
      }
      
      console.log(`[PUT /api/inspection-answers/:id] Updated comment for ${section}.${fieldId} (hasDataWrapper: ${hasDataWrapper})`);
    }
    
    // Final structure validation: Preserve existing structure
    // CRITICAL: Do NOT add data wrapper if it doesn't exist
    // Only normalize if data wrapper already exists
    const sectionsToMove = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
    
    if (parsedAnswers.data) {
      // Data wrapper exists - normalize by moving top-level sections into data
      for (const sec of sectionsToMove) {
        if (parsedAnswers[sec]) {
          console.log(`[PUT /api/inspection-answers/:id] Final validation: Moving ${sec} from top level to data`);
          // If section exists in both, merge them (data takes precedence, but merge top-level into it)
          if (parsedAnswers.data[sec]) {
            // Deep merge: preserve data version but add any missing fields from top-level
            parsedAnswers.data[sec] = {
              ...parsedAnswers[sec],
              ...parsedAnswers.data[sec]
            };
          } else {
            parsedAnswers.data[sec] = parsedAnswers[sec];
          }
          // ALWAYS delete from top-level after moving
          delete parsedAnswers[sec];
        }
      }
      
      // CRITICAL: Ensure metadata is NOT inside data (it should be at top level)
      // Remove data.metadata if it exists to avoid duplication
      // Top-level metadata is the source of truth
      if (parsedAnswers.data.metadata) {
        // If we have top-level metadata, remove data.metadata to avoid confusion
        if (parsedAnswers.metadata) {
          delete parsedAnswers.data.metadata;
          console.log(`[PUT /api/inspection-answers/:id] Removed duplicate data.metadata, keeping top-level metadata`);
        } else {
          // If only data.metadata exists, move it to top level
          parsedAnswers.metadata = parsedAnswers.data.metadata;
          delete parsedAnswers.data.metadata;
          console.log(`[PUT /api/inspection-answers/:id] Moved metadata from data to top level`);
        }
      }
    } else {
      // Data wrapper does NOT exist - preserve original structure
      // Do NOT create data wrapper - keep sections at top level
      console.log(`[PUT /api/inspection-answers/:id] Final validation: No data wrapper - preserving original structure`);
    }

    // Debug: Verify all sections are still present after update
    const sectionsAfter = parsedAnswers.data ? Object.keys(parsedAnswers.data).filter(k => k !== 'metadata') : [];
    console.log(`[PUT /api/inspection-answers/:id] After update, ${sectionsAfter.length} sections preserved:`, sectionsAfter);
    console.log(`[PUT /api/inspection-answers/:id] Final structure:`, {
      hasData: !!parsedAnswers.data,
      sectionsInData: sectionsAfter,
      hasMetadata: !!parsedAnswers.metadata,
      hasRemarks: parsedAnswers.remarks !== undefined,
      hasSignatures: !!parsedAnswers.signatures,
      topLevelKeys: Object.keys(parsedAnswers).filter(k => !['data'].includes(k))
    });

    // Update the answer in database
    const updatedAnswer = await prisma.InspectionAnswer.update({
      where: { id: answerId },
      data: {
        answers: parsedAnswers,
        updatedAt: new Date()
      },
      include: {
        inspection: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
          }
        },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          }
        }
      }
    });

    return res.json({
      message: 'Inspection answer updated successfully',
      data: serializeBigInt({
        id: updatedAnswer.id.toString(),
        inspectionId: updatedAnswer.inspectionId.toString(),
        answers: updatedAnswer.answers,
        answeredBy: updatedAnswer.answeredBy ? updatedAnswer.answeredBy.toString() : null,
        answeredAt: updatedAnswer.answeredAt,
        createdAt: updatedAnswer.createdAt,
        updatedAt: updatedAnswer.updatedAt,
        inspection: updatedAnswer.inspection ? {
          id: updatedAnswer.inspection.id.toString(),
          title: updatedAnswer.inspection.title,
          type: updatedAnswer.inspection.type,
          status: updatedAnswer.inspection.status,
        } : null,
        user: updatedAnswer.user ? {
          id: updatedAnswer.user.id.toString(),
          fullName: updatedAnswer.user.fullName,
          email: updatedAnswer.user.email,
        } : null,
      })
    });
  } catch (error) {
    console.error('Error updating inspection answer:', error);
    return res.status(500).json({
      error: 'Failed to update inspection answer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

/**
 * DELETE /api/inspection-answers/:id
 * Delete only this inspection answer and its related data (inspection_question_images, repairs, repair_images).
 * Does NOT delete the inspection from inspections table.
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let answerId;
    try {
      answerId = BigInt(id);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid id',
        message: 'id must be a numeric identifier',
      });
    }

    const answer = await prisma.InspectionAnswer.findUnique({
      where: { id: answerId },
      select: { id: true, inspectionId: true },
    });

    if (!answer) {
      return res.status(404).json({
        error: 'Not found',
        message: `Inspection answer with ID ${id} does not exist`,
      });
    }

    const inspectionIdStr = answer.inspectionId.toString();
    const answerIdStr = answer.id.toString();

    // 1. Delete RepairImage for repairs linked to this answer
    const repairsForAnswer = await prisma.Repair.findMany({
      where: { inspectionAnswerId: answerId },
      select: { id: true },
    });
    const repairIds = repairsForAnswer.map((r) => r.id);
    if (repairIds.length > 0) {
      await prisma.RepairImage.deleteMany({
        where: { repairId: { in: repairIds } },
      });
    }

    // 2. Delete Repairs for this answer
    await prisma.Repair.deleteMany({
      where: { inspectionAnswerId: answerId },
    });

    // 3. Delete inspection_question_images for this answer
    await prisma.InspectionQuestionImage.deleteMany({
      where: { answerId },
    });

    // 4. Delete FTP storage files for this answer (inspection_*_ans_{answerId}_*)
    try {
      const files = await fs.readdir(FTP_STORAGE_PATH).catch(() => []);
      const suffix = `_ans_${answerIdStr}_`;
      const toDelete = files.filter((f) => f.includes(suffix));
      for (const file of toDelete) {
        const filePath = path.join(FTP_STORAGE_PATH, file);
        await fs.unlink(filePath).catch((err) => console.warn('FTP unlink:', file, err.message));
      }
    } catch (ftpErr) {
      console.warn('FTP cleanup (non-critical):', ftpErr.message);
    }

    // 5. Delete the inspection answer (do NOT delete Inspection)
    await prisma.InspectionAnswer.delete({
      where: { id: answerId },
    });

    return res.json({
      message: 'Inspection answer and related data deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting inspection answer:', error);
    return res.status(500).json({
      error: 'Failed to delete inspection answer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

module.exports = router;










