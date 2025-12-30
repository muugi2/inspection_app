const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { handleError } = require('../utils/routeHelpers');

const router = express.Router();
const prisma = new PrismaClient();

// GET all device models
router.get('/', authMiddleware, async (req, res) => {
  try {
    const models = await prisma.DeviceModel.findMany({
      orderBy: [
        { manufacturer: 'asc' },
        { model: 'asc' },
      ],
    });

    const formattedModels = models.map(model => ({
      id: model.id.toString(),
      manufacturer: model.manufacturer,
      model: model.model,
      deviceType: model.deviceType,
      specs: model.specs,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    }));

    res.json({
      message: 'Device models retrieved successfully',
      data: formattedModels,
    });
  } catch (error) {
    console.error('Error fetching device models:', error);
    res.status(500).json({
      error: 'Failed to fetch device models',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// POST create new device model
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { manufacturer, model, deviceType, specs } = req.body;

    // Validation
    if (!manufacturer || !model || !deviceType) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Manufacturer, model, and device type are required',
      });
    }

    // Validate deviceType
    if (deviceType && !['ANALOG', 'DIGITAL'].includes(deviceType)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device type must be either ANALOG or DIGITAL',
      });
    }

    // Check if model already exists
    const existingModel = await prisma.DeviceModel.findFirst({
      where: {
        manufacturer,
        model,
      },
    });

    if (existingModel) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device model already exists',
      });
    }

    // Validate specs is valid JSON if provided
    if (specs && typeof specs !== 'object') {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Specs must be a valid JSON object',
      });
    }

    // Create device model
    const deviceModel = await prisma.DeviceModel.create({
      data: {
        manufacturer,
        model,
        deviceType: deviceType,
        specs: specs || {},
      },
    });

    res.status(201).json({
      message: 'Device model created successfully',
      data: {
        id: deviceModel.id.toString(),
        manufacturer: deviceModel.manufacturer,
        model: deviceModel.model,
        deviceType: deviceModel.deviceType,
        specs: deviceModel.specs,
        createdAt: deviceModel.createdAt,
        updatedAt: deviceModel.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error creating device model:', error);
    res.status(500).json({
      error: 'Failed to create device model',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// PUT update device model
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { manufacturer, model, deviceType, specs } = req.body;

    // Check if device model exists
    const existingModel = await prisma.DeviceModel.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingModel) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Device model not found',
      });
    }

    // Check if updated model name already exists
    if ((manufacturer || model) &&
        (manufacturer !== existingModel.manufacturer || model !== existingModel.model)) {
      const duplicateModel = await prisma.DeviceModel.findFirst({
        where: {
          manufacturer: manufacturer || existingModel.manufacturer,
          model: model || existingModel.model,
          id: { not: BigInt(id) },
        },
      });

      if (duplicateModel) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Device model already exists',
        });
      }
    }

    // Validate deviceType
    if (deviceType && !['ANALOG', 'DIGITAL'].includes(deviceType)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device type must be either ANALOG or DIGITAL',
      });
    }

    // Validate specs is valid JSON if provided
    if (specs && typeof specs !== 'object') {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Specs must be a valid JSON object',
      });
    }

    // Update device model
    const deviceModel = await prisma.DeviceModel.update({
      where: { id: BigInt(id) },
      data: {
        ...(manufacturer && { manufacturer }),
        ...(model && { model }),
        ...(deviceType && { deviceType }),
        ...(specs !== undefined && { specs }),
      },
    });

    res.json({
      message: 'Device model updated successfully',
      data: {
        id: deviceModel.id.toString(),
        manufacturer: deviceModel.manufacturer,
        model: deviceModel.model,
        deviceType: deviceModel.deviceType,
        specs: deviceModel.specs,
        createdAt: deviceModel.createdAt,
        updatedAt: deviceModel.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating device model:', error);
    res.status(500).json({
      error: 'Failed to update device model',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// DELETE device model
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ DELETE device model request: ID=${id}, User=${req.user.id}`);

    // Check if device model exists
    const existingModel = await prisma.DeviceModel.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingModel) {
      console.log(`❌ Device model not found: ID=${id}`);
      return res.status(404).json({
        error: 'Not found',
        message: 'Device model not found',
      });
    }

    console.log(`✅ Device model found: ${existingModel.manufacturer} ${existingModel.model} (ID=${id})`);

    // Check if model has related devices - get total count first
    const totalDevices = await prisma.Device.count({
      where: { modelId: BigInt(id) },
    });

    if (totalDevices > 0) {
      // Get sample devices for display
      const relatedDevices = await prisma.Device.findMany({
        where: { modelId: BigInt(id) },
        select: {
          id: true,
          serialNumber: true,
          assetTag: true,
          organization: {
            select: {
              name: true,
              code: true,
            },
          },
        },
        take: 10,
      });

      const deviceList = relatedDevices
        .map(d => `${d.serialNumber} (${d.assetTag}) - ${d.organization.name} (${d.organization.code})`)
        .join('\n• ');
      
      const moreText = totalDevices > 10 ? `\n...болон ${totalDevices - 10} бусад төхөөрөмж` : '';
      
      return res.status(400).json({
        error: 'Cannot delete',
        message: `Энэ загварыг ашиглаж байгаа төхөөрөмж байна (Нийт: ${totalDevices}):\n\n• ${deviceList}${moreText}\n\nЭхлээд эдгээр төхөөрөмжүүдийг устгана уу.`,
        devices: { 
          total: totalDevices,
          items: relatedDevices.map(d => ({
            id: d.id.toString(),
            serialNumber: d.serialNumber,
            assetTag: d.assetTag,
            organization: d.organization.name,
            orgCode: d.organization.code,
          }))
        },
      });
    }

    // Delete device model
    console.log(`🗑️ Attempting to delete device model: ${existingModel.manufacturer} ${existingModel.model} (ID=${id})`);
    const deletedModel = await prisma.DeviceModel.delete({
      where: { id: BigInt(id) },
    });

    console.log(`✅ Device model deleted successfully: ${deletedModel.manufacturer} ${deletedModel.model} (ID=${id})`);
    res.json({
      message: 'Device model deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting device model:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      modelId: id,
    });
    res.status(500).json({
      error: 'Failed to delete device model',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        stack: error.stack,
      } : undefined,
    });
  }
});

module.exports = router;

