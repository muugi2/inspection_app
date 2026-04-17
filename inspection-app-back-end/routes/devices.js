const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { serializeBigInt, handleError, parseBigIntId } = require('../utils/routeHelpers');

const router = express.Router();
const prisma = new PrismaClient();

// GET devices by organization
router.get('/organization/:orgId', authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.params;

    const devices = await prisma.Device.findMany({
      where: {
        orgId: BigInt(orgId),
        deletedAt: null,
      },
      include: {
        model: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
            deviceType: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
          },
        },
      },
      orderBy: {
        serialNumber: 'asc',
      },
    });

    // Format response
    const formattedDevices = devices.map(device => ({
      id: device.id.toString(),
      serialNumber: device.serialNumber,
      assetTag: device.assetTag,
      status: device.status,
      model: device.model ? {
        id: device.model.id.toString(),
        manufacturer: device.model.manufacturer,
        model: device.model.model,
        deviceType: device.model.deviceType,
      } : null,
      site: device.site ? {
        id: device.site.id.toString(),
        name: device.site.name,
      } : null,
      installedAt: device.installedAt,
      createdAt: device.createdAt,
    }));

    res.json({
      message: 'Devices retrieved successfully',
      data: formattedDevices,
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({
      error: 'Failed to fetch devices',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// POST create new device
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      orgId,
      siteId,
      contractId,
      modelId,
      serialNumber,
      assetTag,
      status,
      installedAt,
      metadata,
    } = req.body;

    // Validation - only modelId is required for repair assignment
    if (!modelId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Device model is required',
      });
    }

    // Check if serial number already exists (if provided)
    if (serialNumber) {
    const existingDevice = await prisma.Device.findFirst({
      where: { serialNumber },
    });

    if (existingDevice) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Serial number already exists',
      });
    }
    }

    // Check if related records exist (only if provided)
    const checks = [];
    if (orgId) {
      checks.push(
        prisma.Organization.findUnique({ where: { id: BigInt(orgId) } })
          .then(org => ({ type: 'organization', data: org }))
      );
    }
    if (siteId) {
      checks.push(
        prisma.Site.findUnique({ where: { id: BigInt(siteId) } })
          .then(site => ({ type: 'site', data: site }))
      );
    }
    if (contractId) {
      checks.push(
        prisma.Contract.findUnique({ where: { id: BigInt(contractId) } })
          .then(contract => ({ type: 'contract', data: contract }))
      );
    }
    checks.push(
      prisma.DeviceModel.findUnique({ where: { id: BigInt(modelId) } })
        .then(model => ({ type: 'model', data: model }))
    );

    const results = await Promise.all(checks);

    // Verify all provided records exist
    for (const result of results) {
      if (!result.data) {
      return res.status(404).json({
        error: 'Not found',
          message: `${result.type.charAt(0).toUpperCase() + result.type.slice(1)} not found`,
      });
      }
    }

    // Get model (required)
    const model = results.find(r => r.type === 'model')?.data;
    if (!model) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Device model not found',
      });
    }

    // Verify relationships if provided
    const organization = results.find(r => r.type === 'organization')?.data;
    const site = results.find(r => r.type === 'site')?.data;
    const contract = results.find(r => r.type === 'contract')?.data;

    if (site && organization && site.orgId.toString() !== orgId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Site does not belong to the specified organization',
      });
    }

    if (contract && organization && contract.orgId.toString() !== orgId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Contract does not belong to the specified organization',
      });
    }

    // If orgId not provided, use assignment's orgId or get from user's orgId
    const finalOrgId = orgId || req.user.orgId?.toString();
    if (!finalOrgId) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Organization ID is required (either provide orgId or user must have orgId)',
      });
    }

    // Create device - allow null values for optional fields
    const device = await prisma.Device.create({
      data: {
        orgId: BigInt(finalOrgId),
        siteId: siteId ? BigInt(siteId) : null,
        contractId: contractId ? BigInt(contractId) : null,
        modelId: BigInt(modelId),
        serialNumber: serialNumber || `TEMP-${Date.now()}`, // Generate temp serial if not provided
        assetTag: assetTag || null,
        status: status || 'IN_STOCK',
        installedAt: installedAt ? new Date(installedAt) : null,
        metadata: metadata || {},
      },
      include: {
        model: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
          },
        },
      },
    });

    res.status(201).json({
      message: 'Device created successfully',
      data: {
        id: device.id.toString(),
        serialNumber: device.serialNumber,
        assetTag: device.assetTag,
        status: device.status,
        installedAt: device.installedAt,
        metadata: device.metadata,
        model: device.model ? {
          id: device.model.id.toString(),
          manufacturer: device.model.manufacturer,
          model: device.model.model,
        } : null,
        site: device.site ? {
          id: device.site.id.toString(),
          name: device.site.name,
        } : null,
        contract: device.contract ? {
          id: device.contract.id.toString(),
          contractName: device.contract.contractName,
          contractNumber: device.contract.contractNumber,
        } : null,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error creating device:', error);
    res.status(500).json({
      error: 'Failed to create device',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// PUT update device
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      orgId,
      siteId,
      contractId,
      modelId,
      serialNumber,
      assetTag,
      status,
      installedAt,
      metadata,
    } = req.body;

    // Check if device exists
    const existingDevice = await prisma.Device.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingDevice) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Device not found',
      });
    }

    // Check if serial number is being changed and if it already exists
    if (serialNumber && serialNumber !== existingDevice.serialNumber) {
      const duplicateSerial = await prisma.Device.findFirst({
        where: {
          serialNumber,
          id: { not: BigInt(id) },
        },
      });

      if (duplicateSerial) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Serial number already exists',
        });
      }
    }

    // Check if related records exist (if being changed)
    if (orgId || siteId || contractId || modelId) {
      const checks = [];
      
      if (orgId && orgId !== existingDevice.orgId.toString()) {
        checks.push(
          prisma.Organization.findUnique({ where: { id: BigInt(orgId) } })
            .then(org => ({ type: 'org', data: org }))
        );
      }
      
      if (siteId && siteId !== existingDevice.siteId?.toString()) {
        checks.push(
          prisma.Site.findUnique({ where: { id: BigInt(siteId) } })
            .then(site => ({ type: 'site', data: site }))
        );
      }
      
      if (contractId && contractId !== existingDevice.contractId?.toString()) {
        checks.push(
          prisma.Contract.findUnique({ where: { id: BigInt(contractId) } })
            .then(contract => ({ type: 'contract', data: contract }))
        );
      }
      
      if (modelId && modelId !== existingDevice.modelId?.toString()) {
        checks.push(
          prisma.DeviceModel.findUnique({ where: { id: BigInt(modelId) } })
            .then(model => ({ type: 'model', data: model }))
        );
      }

      const results = await Promise.all(checks);
      
      for (const result of results) {
        if (!result.data) {
          return res.status(404).json({
            error: 'Not found',
            message: `${result.type.charAt(0).toUpperCase() + result.type.slice(1)} not found`,
          });
        }
      }

      // Verify relationships
      const finalOrgId = orgId || existingDevice.orgId.toString();
      const finalSiteId = siteId || existingDevice.siteId.toString();
      const finalContractId = contractId || existingDevice.contractId.toString();

      if (siteId) {
        const site = await prisma.Site.findUnique({ where: { id: BigInt(finalSiteId) } });
        if (site && site.orgId.toString() !== finalOrgId) {
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Site does not belong to the specified organization',
          });
        }
      }

      if (contractId) {
        const contract = await prisma.Contract.findUnique({ where: { id: BigInt(finalContractId) } });
        if (contract && contract.orgId.toString() !== finalOrgId) {
          return res.status(400).json({
            error: 'Validation failed',
            message: 'Contract does not belong to the specified organization',
          });
        }
      }
    }

    // Update device
    const device = await prisma.Device.update({
      where: { id: BigInt(id) },
      data: {
        ...(orgId && { orgId: BigInt(orgId) }),
        ...(siteId && { siteId: BigInt(siteId) }),
        ...(contractId && { contractId: BigInt(contractId) }),
        ...(modelId && { modelId: BigInt(modelId) }),
        ...(serialNumber && { serialNumber }),
        ...(assetTag && { assetTag }),
        ...(status && { status }),
        ...(installedAt && { installedAt: new Date(installedAt) }),
        ...(metadata !== undefined && { metadata }),
      },
      include: {
        model: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractName: true,
            contractNumber: true,
          },
        },
      },
    });

    res.json({
      message: 'Device updated successfully',
      data: {
        id: device.id.toString(),
        serialNumber: device.serialNumber,
        assetTag: device.assetTag,
        status: device.status,
        installedAt: device.installedAt,
        metadata: device.metadata,
        model: device.model ? {
          id: device.model.id.toString(),
          manufacturer: device.model.manufacturer,
          model: device.model.model,
        } : null,
        site: device.site ? {
          id: device.site.id.toString(),
          name: device.site.name,
        } : null,
        contract: device.contract ? {
          id: device.contract.id.toString(),
          contractName: device.contract.contractName,
          contractNumber: device.contract.contractNumber,
        } : null,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({
      error: 'Failed to update device',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// DELETE device
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ DELETE device request: ID=${id}, User=${req.user.id}`);

    // Check if device exists
    const existingDevice = await prisma.Device.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingDevice) {
      console.log(`❌ Device not found: ID=${id}`);
      return res.status(404).json({
        error: 'Not found',
        message: 'Device not found',
      });
    }

    console.log(`✅ Device found: ${existingDevice.serialNumber} (ID=${id})`);

    // Check if device has related inspections - get total count first
    const totalInspections = await prisma.Inspection.count({
      where: { deviceId: BigInt(id) },
    });

    if (totalInspections > 0) {
      // Get sample inspections for display
      const relatedInspections = await prisma.Inspection.findMany({
        where: { deviceId: BigInt(id) },
        select: {
          id: true,
          title: true,
          status: true,
          type: true,
          scheduledAt: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      const inspectionList = relatedInspections
        .map(i => `${i.title} (${i.status}) - ${i.type}`)
        .join('\n• ');
      
      const moreText = totalInspections > 10 ? `\n...болон ${totalInspections - 10} бусад үзлэг` : '';
      
      return res.status(400).json({
        error: 'Cannot delete',
        message: `Энэ төхөөрөмжтэй холбоотой үзлэг байна (Нийт: ${totalInspections}):\n\n• ${inspectionList}${moreText}\n\nЭхлээд эдгээр үзлэгүүдийг устгана уу.`,
        inspections: { 
          total: totalInspections,
          items: relatedInspections.map(i => ({
            id: i.id.toString(),
            title: i.title,
            status: i.status,
            type: i.type,
            scheduledAt: i.scheduledAt,
          }))
        },
      });
    }

    // Hard delete - permanently remove from database
    console.log(`🗑️ Attempting to delete device: ${existingDevice.serialNumber} (ID=${id})`);
    const deletedDevice = await prisma.Device.delete({
      where: { id: BigInt(id) },
    });

    console.log(`✅ Device deleted successfully: ${deletedDevice.serialNumber} (ID=${id})`);
    res.json({
      message: 'Device deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting device:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      deviceId: id,
    });
    res.status(500).json({
      error: 'Failed to delete device',
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


