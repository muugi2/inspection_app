import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';

class RepairWorkPage extends StatefulWidget {
  final String repairId;
  final String? inspectionId;
  final String? fieldId;

  const RepairWorkPage({
    super.key,
    required this.repairId,
    this.inspectionId,
    this.fieldId,
  });

  @override
  State<RepairWorkPage> createState() => _RepairWorkPageState();
}

class _RepairWorkPageState extends State<RepairWorkPage> {
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _repairedStatusController = TextEditingController();
  final ImagePicker _imagePicker = ImagePicker();
  List<File> _selectedImages = [];
  bool _saving = false;

  @override
  void dispose() {
    _descriptionController.dispose();
    _repairedStatusController.dispose();
    super.dispose();
  }

  Future<void> _pickImages() async {
    try {
      final List<XFile> images = await _imagePicker.pickMultiImage();
      if (images.isNotEmpty) {
        setState(() {
          _selectedImages = images.map((xfile) => File(xfile.path)).toList();
        });
      }
    } catch (e) {
      debugPrint('Error picking images: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Зургийг сонгоход алдаа гарлаа: $e')),
      );
    }
  }

  Future<void> _saveRepairWork() async {
    if (_descriptionController.text.trim().isEmpty &&
        _repairedStatusController.text.trim().isEmpty &&
        _selectedImages.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Хадгалах мэдээлэл оруулна уу'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() {
      _saving = true;
    });

    try {
      // If repair record doesn't exist yet, create it first
      if (widget.inspectionId != null) {
        // First, analyze repairs to create repair records in database
        await RepairAPI.analyzeRepairs(widget.inspectionId!);

        // Wait a bit for database to update
        await Future.delayed(const Duration(milliseconds: 500));

        // Now get the repair ID from database
        final repairsResponse = await RepairAPI.getByInspection(
          widget.inspectionId!,
        );
        final repairs = repairsResponse['data'] as List<dynamic>? ?? [];

        // Find the repair with matching fieldId
        Map<String, dynamic>? repairRecord;
        for (var repair in repairs) {
          final repairMap = repair as Map<String, dynamic>;
          if (repairMap['fieldId']?.toString() == widget.fieldId) {
            repairRecord = repairMap;
            break;
          }
        }

        if (repairRecord != null) {
          final repairId = repairRecord['id']?.toString();
          if (repairId != null) {
            // Update description and repaired status
            if (_descriptionController.text.trim().isNotEmpty ||
                _repairedStatusController.text.trim().isNotEmpty) {
              await RepairAPI.update(repairId, {
                'description': _descriptionController.text.trim(),
                'repairedStatus': _repairedStatusController.text.trim(),
              });
            }

            // Upload images if any
            if (_selectedImages.isNotEmpty) {
              await RepairAPI.uploadImages(
                repairId: repairId,
                images: _selectedImages,
              );
            }
          }
        } else {
          throw Exception('Repair record not found after creation');
        }
      } else {
        // Update existing repair record
        if (_descriptionController.text.trim().isNotEmpty ||
            _repairedStatusController.text.trim().isNotEmpty) {
          await RepairAPI.update(widget.repairId, {
            'description': _descriptionController.text.trim(),
            'repairedStatus': _repairedStatusController.text.trim(),
          });
        }

        // Upload images if any
        if (_selectedImages.isNotEmpty) {
          await RepairAPI.uploadImages(
            repairId: widget.repairId,
            images: _selectedImages,
          );
        }
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Засварын мэдээлэл амжилттай хадгалагдлаа'),
          backgroundColor: Colors.green,
        ),
      );

      // Navigate back
      Navigator.of(context).pop(true); // Return true to indicate success
    } catch (e) {
      debugPrint('❌ Error saving repair work: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Хадгалахад алдаа гарлаа: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Засварласан байдал'),
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
              onPressed: _saveRepairWork,
              tooltip: 'Хадгалах',
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Тайлбар
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Тайлбар:',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _descriptionController,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        hintText: 'Засварын тайлбараа оруулна уу...',
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Засварласан байдал
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Засварласан байдал:',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _repairedStatusController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        hintText:
                            'Засварласан байдлыг оруулна уу (жишээ: Хэвийн болсон, Сольсон, Зассан гэх мэт)...',
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Засвар хийсэн зураг
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Засвар хийсэн зураг:',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _pickImages,
                          icon: const Icon(Icons.add_photo_alternate, size: 18),
                          label: const Text('Зураг нэмэх'),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Selected images
                    if (_selectedImages.isNotEmpty) ...[
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 3,
                              crossAxisSpacing: 8,
                              mainAxisSpacing: 8,
                            ),
                        itemCount: _selectedImages.length,
                        itemBuilder: (context, index) {
                          return Stack(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image.file(
                                  _selectedImages[index],
                                  fit: BoxFit.cover,
                                  width: double.infinity,
                                  height: double.infinity,
                                ),
                              ),
                              Positioned(
                                top: 4,
                                right: 4,
                                child: Material(
                                  color: Colors.black54,
                                  borderRadius: BorderRadius.circular(12),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(12),
                                    onTap: () {
                                      setState(() {
                                        _selectedImages.removeAt(index);
                                      });
                                    },
                                    child: const Padding(
                                      padding: EdgeInsets.all(4),
                                      child: Icon(
                                        Icons.close,
                                        color: Colors.white,
                                        size: 16,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ] else
                      Container(
                        padding: const EdgeInsets.all(32),
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: AppColors.textSecondary.withOpacity(0.2),
                            style: BorderStyle.solid,
                            width: 1,
                          ),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.add_photo_alternate,
                                size: 48,
                                color: AppColors.textSecondary.withOpacity(0.5),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Зураг нэмэх',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: AppColors.textSecondary.withOpacity(0.7),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}



