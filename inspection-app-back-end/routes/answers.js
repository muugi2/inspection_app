const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

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
      select: {
        id: true,
        inspectionId: true,
        answers: true,
        answeredBy: true,
        answeredAt: true,
        createdAt: true,
        updatedAt: true,
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
      data: {
        id: answer.id.toString(),
        inspectionId: answer.inspectionId.toString(),
        answers: answer.answers,
        answeredBy: answer.answeredBy ? answer.answeredBy.toString() : null,
        answeredAt: answer.answeredAt,
        createdAt: answer.createdAt,
        updatedAt: answer.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error getting inspection answer:', error);
    return res.status(500).json({
      error: 'Failed to get inspection answer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

module.exports = router;










