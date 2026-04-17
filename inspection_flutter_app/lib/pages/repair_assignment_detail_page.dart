import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:app/services/api.dart';
import 'package:app/utils/error_handler.dart';

class RepairAssignmentDetailPage extends StatefulWidget {
  final String inspectionId;
  final Map<String, dynamic> assignment;

  const RepairAssignmentDetailPage({
    super.key,
    required this.inspectionId,
    required this.assignment,
  });

  @override
  State<RepairAssignmentDetailPage> createState() => _RepairAssignmentDetailPageState();
}

class _RepairAssignmentDetailPageState extends State<RepairAssignmentDetailPage> {
  final _formKey = GlobalKey<FormState>();
  bool _saving = false;
  String? _error;

  // Form fields
  final _manufacturerController = TextEditingController();
  final _modelController = TextEditingController();
  String? _selectedType; // ANALOG or DIGITAL
  String? _platformLength;
  String? _platformWidth;
  String? _platformCount; // Тавцангын тоо

  bool _loadingData = true;

  @override
  void initState() {
    super.initState();
    _loadData();
    _initializeForm();
  }

  void _initializeForm() {
    // Initialize form with existing data
    final device = widget.assignment['device'] as Map<String, dynamic>?;
    
    // Get device model from device
    if (device != null) {
      final model = device['model'] as Map<String, dynamic>?;
      if (model != null) {
        _manufacturerController.text = model['manufacturer']?.toString() ?? '';
        _modelController.text = model['model']?.toString() ?? '';
      }

      // Check if device has metadata with type, platform length/width/count
      final metadata = device['metadata'];
      if (metadata != null) {
        Map<String, dynamic> metadataMap = {};
        if (metadata is String) {
          try {
            metadataMap = Map<String, dynamic>.from(
              jsonDecode(metadata) as Map,
            );
          } catch (e) {
            debugPrint('Error parsing metadata: $e');
          }
        } else if (metadata is Map) {
          metadataMap = Map<String, dynamic>.from(metadata);
        }

        _selectedType = metadataMap['type']?.toString();
        _platformLength = metadataMap['platformLength']?.toString();
        _platformWidth = metadataMap['platformWidth']?.toString();
        _platformCount = metadataMap['platformCount']?.toString();
      }
    }
  }

  @override
  void dispose() {
    _manufacturerController.dispose();
    _modelController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loadingData = false; // No need to load data, using text fields
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      // Get assignment orgId and siteId
      final assignmentOrgId = widget.assignment['orgId']?.toString() ?? 
                              widget.assignment['organization']?['id']?.toString();
      final assignmentSiteId = widget.assignment['siteId']?.toString() ?? 
                                widget.assignment['site']?['id']?.toString();

      // Get manufacturer and model from text fields
      final manufacturer = _manufacturerController.text.trim();
      final modelName = _modelController.text.trim();

      if (manufacturer.isEmpty || modelName.isEmpty) {
        throw Exception('Үйлдвэрлэгч болон загвар оруулна уу');
      }

      // Prepare metadata
      final metadata = <String, dynamic>{};
      if (_selectedType != null) {
        metadata['type'] = _selectedType;
      }
      if (_platformLength != null && _platformLength!.isNotEmpty) {
        metadata['platformLength'] = double.tryParse(_platformLength!) ?? _platformLength;
      }
      if (_platformWidth != null && _platformWidth!.isNotEmpty) {
        metadata['platformWidth'] = double.tryParse(_platformWidth!) ?? _platformWidth;
      }
      if (_platformCount != null && _platformCount!.isNotEmpty) {
        metadata['platformCount'] = int.tryParse(_platformCount!) ?? _platformCount;
      }

      // Find or create device model
      String? modelId;
      try {
        // Try to find existing model
        final modelsResponse = await InspectionAPI.getDeviceModels();
        final models = List<Map<String, dynamic>>.from(modelsResponse['data'] ?? []);
        final existingModel = models.firstWhere(
          (m) => m['manufacturer']?.toString().toLowerCase() == manufacturer.toLowerCase() &&
                 m['model']?.toString().toLowerCase() == modelName.toLowerCase(),
          orElse: () => {},
        );

        if (existingModel.isNotEmpty && existingModel['id'] != null) {
          modelId = existingModel['id'].toString();
        } else {
          // Create new device model - use selected type or default to ANALOG
          final modelResponse = await DeviceModelAPI.create({
            'manufacturer': manufacturer,
            'model': modelName,
            'deviceType': _selectedType ?? 'ANALOG',
          });
          modelId = modelResponse['data']?['id']?.toString();
        }
      } catch (e) {
        debugPrint('Error finding/creating device model: $e');
        throw Exception('Төхөөрөмжийн загвар үүсгэхэд алдаа гарлаа: ${e.toString()}');
      }

      if (modelId == null) {
        throw Exception('Төхөөрөмжийн загвар үүсгэхэд алдаа гарлаа');
      }

      // Check if device already exists for this inspection
      final existingDevice = widget.assignment['device'] as Map<String, dynamic>?;
      String? deviceId;

      if (existingDevice != null && existingDevice['id'] != null) {
        // Update existing device
        deviceId = existingDevice['id'].toString();
        try {
          await DeviceAPI.update(deviceId, {
            'modelId': modelId,
            'metadata': metadata.isNotEmpty ? metadata : null,
          });
        } catch (e) {
          debugPrint('Error updating device: $e');
          throw Exception('Төхөөрөмж шинэчлэхэд алдаа гарлаа: ${e.toString()}');
        }
      } else {
        // Create new device
        final deviceData = {
          'modelId': modelId,
          'metadata': metadata.isNotEmpty ? metadata : null,
          if (assignmentOrgId != null) 'orgId': assignmentOrgId,
          if (assignmentSiteId != null) 'siteId': assignmentSiteId,
        };

        try {
          final response = await DeviceAPI.create(deviceData);
          final newDevice = response['data'];
          if (newDevice != null && newDevice['id'] != null) {
            deviceId = newDevice['id'].toString();
          }
        } catch (e) {
          debugPrint('Error creating device: $e');
          throw Exception('Төхөөрөмж үүсгэхэд алдаа гарлаа: ${e.toString()}');
        }
      }

      // Update inspection with deviceId
      if (deviceId != null) {
        await InspectionAPI.update(widget.inspectionId, {
          'deviceId': deviceId,
        });
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Мэдээлэл амжилттай хадгалагдлаа'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      debugPrint('Error saving: $e');
      setState(() {
        _error = ErrorHandler.handleApiError(e);
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingData) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Засварын томилолт'),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Засварын томилолт'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.all(16.0),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            IconButton(
              icon: const Icon(Icons.save),
              onPressed: _save,
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, color: Colors.red.shade700),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _error!,
                          style: TextStyle(color: Colors.red.shade700),
                        ),
                      ),
                    ],
                  ),
                ),
              
              // Title
              Text(
                widget.assignment['title']?.toString() ?? 'Засварын томилолт',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 24),

              // Manufacturer
              const Text(
                'Үйлдвэрлэгч *',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _manufacturerController,
                decoration: InputDecoration(
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  hintText: 'Үйлдвэрлэгчийн нэр',
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Үйлдвэрлэгчийн нэр оруулна уу';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 24),

              // Model
              const Text(
                'Загвар *',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _modelController,
                decoration: InputDecoration(
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  hintText: 'Загварын нэр',
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Загварын нэр оруулна уу';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 24),

              // Type selection (ANALOG/DIGITAL)
              const Text(
                'Төрөл',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _selectedType,
                decoration: InputDecoration(
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  hintText: 'Аналог эсвэл Дижитал',
                ),
                items: const [
                  DropdownMenuItem(value: 'ANALOG', child: Text('Аналог')),
                  DropdownMenuItem(value: 'DIGITAL', child: Text('Дижитал')),
                ],
                onChanged: (value) {
                  setState(() {
                    _selectedType = value;
                  });
                },
              ),
              const SizedBox(height: 24),

              // Platform dimensions
              const Text(
                'Тавцан',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Урт (м)',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey,
                          ),
                        ),
                        const SizedBox(height: 4),
                        TextFormField(
                          initialValue: _platformLength,
                          decoration: InputDecoration(
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            hintText: '0.00',
                          ),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(RegExp(r'^\d+\.?\d{0,2}')),
                          ],
                          onChanged: (value) {
                            _platformLength = value;
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Өргөн (м)',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey,
                          ),
                        ),
                        const SizedBox(height: 4),
                        TextFormField(
                          initialValue: _platformWidth,
                          decoration: InputDecoration(
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            hintText: '0.00',
                          ),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(RegExp(r'^\d+\.?\d{0,2}')),
                          ],
                          onChanged: (value) {
                            _platformWidth = value;
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Тоо',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey,
                          ),
                        ),
                        const SizedBox(height: 4),
                        TextFormField(
                          initialValue: _platformCount,
                          decoration: InputDecoration(
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            hintText: '0',
                          ),
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(RegExp(r'^\d+')),
                          ],
                          onChanged: (value) {
                            _platformCount = value;
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),

              // Save button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _saving ? null : _save,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _saving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text(
                          'Хадгалах',
                          style: TextStyle(fontSize: 16),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

}
