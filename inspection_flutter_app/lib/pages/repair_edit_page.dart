import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';

class RepairEditPage extends StatefulWidget {
  final String inspectionId;
  final String fieldId;
  final String section;
  final Map<String, dynamic> field;
  final Map<String, dynamic>? inspectionData;

  const RepairEditPage({
    super.key,
    required this.inspectionId,
    required this.fieldId,
    required this.section,
    required this.field,
    this.inspectionData,
  });

  @override
  State<RepairEditPage> createState() => _RepairEditPageState();
}

class _RepairEditPageState extends State<RepairEditPage> {
  final _formKey = GlobalKey<FormState>();
  final _descriptionController = TextEditingController();
  final List<File> _selectedImages = [];
  bool _saving = false;
  String? _repairId;

  @override
  void initState() {
    super.initState();
    // Тайлбар хоосон байх ёстой - засварын шинэ тайлбар бичих
    _descriptionController.text = '';
    _checkExistingRepair();
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _checkExistingRepair() async {
    try {
      debugPrint('🔍 Checking for existing repair...');
      
      // Try to get existing repair for this inspection/field
      final response = await RepairAPI.getAll(
        inspectionId: widget.inspectionId,
      );
      
      final repairs = response['data'] as List<dynamic>? ?? [];
      
      for (var repair in repairs) {
        if (repair['fieldId'] == widget.fieldId && 
            repair['section'] == widget.section) {
          setState(() {
            _repairId = repair['id'].toString();
            // Тайлбар хоосон байх ёстой - засварын шинэ тайлбар бичих
            _descriptionController.text = '';
          });
          debugPrint('✅ Found existing repair: $_repairId');
          debugPrint('   Existing repair description (not loading): ${repair['repairDescription'] ?? 'null'}');
          break;
        }
      }
    } catch (e) {
      debugPrint('❌ Error checking existing repair: $e');
    }
  }

  Future<void> _pickImages() async {
    final ImagePicker picker = ImagePicker();
    
    try {
      final List<XFile> images = await picker.pickMultiImage(
        imageQuality: 85,
      );
      
      if (images.isNotEmpty) {
        setState(() {
          for (var image in images) {
            if (_selectedImages.length < 10) {
              _selectedImages.add(File(image.path));
            }
          }
        });
        
        debugPrint('✅ Selected ${images.length} image(s)');
      }
    } catch (e) {
      debugPrint('❌ Error picking images: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Зураг сонгохот алдаа гарлаа: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  Future<void> _takePhoto() async {
    final ImagePicker picker = ImagePicker();
    
    try {
      final XFile? photo = await picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 85,
      );
      
      if (photo != null) {
        setState(() {
          if (_selectedImages.length < 10) {
            _selectedImages.add(File(photo.path));
          }
        });
        
        debugPrint('✅ Took photo');
      }
    } catch (e) {
      debugPrint('❌ Error taking photo: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Зураг авахад алдаа гарлаа: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  void _removeImage(int index) {
    setState(() {
      _selectedImages.removeAt(index);
    });
  }

  Future<void> _saveRepair() async {
    if (!_formKey.currentState!.validate()) {
      debugPrint('❌ Form validation failed');
      return;
    }

    setState(() {
      _saving = true;
    });

    try {
      debugPrint('💾 Saving repair...');
      debugPrint('   Inspection ID: ${widget.inspectionId}');
      debugPrint('   Field ID: ${widget.fieldId}');
      debugPrint('   Section: ${widget.section}');
      debugPrint('   Description: ${_descriptionController.text.trim()}');
      debugPrint('   Selected images: ${_selectedImages.length}');
      debugPrint('   Existing repair ID: $_repairId');
      
      String repairId;
      
      if (_repairId != null) {
        // Update existing repair
        debugPrint('   📝 Updating existing repair: $_repairId');
        
        final updateData = {
          'repairDescription': _descriptionController.text.trim(),
          'repairStatus': 'COMPLETED',
          'repairedAt': DateTime.now().toIso8601String(),
        };
        
        debugPrint('   📦 Update data: $updateData');
        
        try {
          await RepairAPI.update(_repairId!, updateData);
          repairId = _repairId!;
          debugPrint('   ✅ Updated repair: $repairId');
        } catch (updateError) {
          debugPrint('   ❌ Error updating repair: $updateError');
          rethrow;
        }
      } else {
        // Create new repair by analyzing inspection
        debugPrint('   🔍 Analyzing inspection to create repair...');
        debugPrint('   Request URL: /api/repairs/analyze/${widget.inspectionId}');
        
        try {
          final analyzeResponse = await RepairAPI.analyzeRepairs(widget.inspectionId);
          debugPrint('   📦 Analyze response received');
          debugPrint('   Response keys: ${analyzeResponse.keys}');
          
          final data = analyzeResponse['data'];
          if (data == null) {
            debugPrint('   ❌ No data in analyze response');
            throw Exception('No data in analyze response');
          }
          
          debugPrint('   Data keys: ${data.keys}');
          final repairs = data['repairs'] as List<dynamic>? ?? [];
          debugPrint('   Found ${repairs.length} repair(s) from analyze');
          
          // Find the repair that matches our field
          Map<String, dynamic>? matchingRepair;
          for (var repair in repairs) {
            debugPrint('   Checking repair: fieldId=${repair['fieldId']}, section=${repair['section']}');
            if (repair['fieldId'] == widget.fieldId && 
                repair['section'] == widget.section) {
              matchingRepair = repair;
              debugPrint('   ✅ Found matching repair: ${repair['id']}');
              break;
            }
          }
          
          if (matchingRepair == null) {
            debugPrint('   ❌ No matching repair found for fieldId=${widget.fieldId}, section=${widget.section}');
            debugPrint('   Available repairs:');
            for (var repair in repairs) {
              debugPrint('     - fieldId=${repair['fieldId']}, section=${repair['section']}, id=${repair['id']}');
            }
            throw Exception('Failed to create repair - no matching repair found');
          }
          
          repairId = matchingRepair['id'].toString();
          debugPrint('   📝 Using repair ID: $repairId');
          
          // Update it with our description
          final updateData = {
            'repairDescription': _descriptionController.text.trim(),
            'repairStatus': 'COMPLETED',
            'repairedAt': DateTime.now().toIso8601String(),
          };
          
          debugPrint('   📦 Update data: $updateData');
          
          try {
            await RepairAPI.update(repairId, updateData);
            debugPrint('   ✅ Created and updated repair: $repairId');
          } catch (updateError) {
            debugPrint('   ❌ Error updating newly created repair: $updateError');
            rethrow;
          }
        } catch (analyzeError) {
          debugPrint('   ❌ Error analyzing inspection: $analyzeError');
          rethrow;
        }
      }
      
      // Upload images if any
      if (_selectedImages.isNotEmpty) {
        debugPrint('📸 Uploading ${_selectedImages.length} image(s) to repair $repairId...');
        
        try {
          await RepairAPI.uploadImages(
            repairId: repairId,
            images: _selectedImages,
          );
          
          debugPrint('✅ Uploaded ${_selectedImages.length} image(s) successfully');
        } catch (uploadError) {
          debugPrint('❌ Error uploading images: $uploadError');
          // Don't throw - repair is saved, images can be uploaded later
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Засвар хадгалагдлаа, гэхдээ зургийг хадгалахад алдаа гарлаа: $uploadError'),
                backgroundColor: Colors.orange,
              ),
            );
          }
        }
      }
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Засвар амжилттай хадгалагдлаа'),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 2),
          ),
        );
        
        // Pop back multiple times to return to RepairPage
        // Navigation stack: RepairPage -> RepairDetailPage -> RepairFieldDetailPage -> RepairEditPage
        // We need to pop 3 times: RepairEditPage, RepairFieldDetailPage, RepairDetailPage
        // So we end up back at RepairPage
        int popCount = 0;
        Navigator.of(context).popUntil((route) {
          if (route.isFirst) return true; // Stop at first route
          popCount++;
          // Pop 3 times to go back to RepairPage
          return popCount >= 3;
        });
      }
    } catch (e, stackTrace) {
      debugPrint('❌ Error saving repair: $e');
      debugPrint('❌ Stack trace: $stackTrace');
      
      String errorMessage = 'Хадгалахад алдаа гарлаа';
      if (e is DioException) {
        debugPrint('   DioException details:');
        debugPrint('     Type: ${e.type}');
        debugPrint('     Message: ${e.message}');
        debugPrint('     Response: ${e.response}');
        if (e.response != null) {
          debugPrint('     Status code: ${e.response!.statusCode}');
          debugPrint('     Response data: ${e.response!.data}');
          errorMessage = 'Алдаа: ${e.response!.data?['message'] ?? e.message}';
        }
      }
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMessage),
            backgroundColor: Colors.redAccent,
            duration: const Duration(seconds: 5),
          ),
        );
      }
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
    final questionText = widget.field['questionText'] ?? 'Асуулт';
    final originalStatus = widget.field['originalStatus'] ?? '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Засвар хийх'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Question info
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      questionText,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Анхны байдал: $originalStatus',
                        style: const TextStyle(
                          fontSize: 14,
                          color: Colors.orange,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            
            const SizedBox(height: 24),
            
            // Description field
            const Text(
              'Засварын тайлбар',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _descriptionController,
              maxLines: 5,
              decoration: InputDecoration(
                hintText: 'Засварын талаар дэлгэрэнгүй тайлбар бичнэ үү...',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                filled: true,
                fillColor: AppColors.surface,
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Тайлбар оруулна уу';
                }
                return null;
              },
            ),
            
            const SizedBox(height: 24),
            
            // Images section
            const Text(
              'Засварын зургууд',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            
            // Image picker buttons
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickImages,
                    icon: const Icon(Icons.photo_library),
                    label: const Text('Зураг сонгох'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _takePhoto,
                    icon: const Icon(Icons.camera_alt),
                    label: const Text('Зураг авах'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            // Selected images preview
            if (_selectedImages.isNotEmpty) ...[
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: _selectedImages.asMap().entries.map((entry) {
                  final index = entry.key;
                  final image = entry.value;
                  
                  return Stack(
                    children: [
                      Container(
                        width: 100,
                        height: 100,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFE6E6E6)),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Image.file(
                            image,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      Positioned(
                        top: 4,
                        right: 4,
                        child: GestureDetector(
                          onTap: () => _removeImage(index),
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: const BoxDecoration(
                              color: Colors.redAccent,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.close,
                              color: Colors.white,
                              size: 16,
                            ),
                          ),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
              const SizedBox(height: 8),
              Text(
                '${_selectedImages.length} зураг сонгогдсон (Max: 10)',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
            
            const SizedBox(height: 32),
            
            // Save button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: _saving ? null : _saveRepair,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.save, size: 24),
                          SizedBox(width: 12),
                          Text(
                            'Хадгалах',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

