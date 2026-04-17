import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/services/api.dart';
import 'package:app/config/app_config.dart';

class InstallFieldPage extends StatefulWidget {
  final Map<String, dynamic> section;
  final Map<String, dynamic> template;
  final Map<String, dynamic>? field;
  final String? assignmentId; // Assignment ID for saving data

  const InstallFieldPage({
    super.key,
    required this.section,
    required this.template,
    this.field,
    this.assignmentId,
  });

  @override
  State<InstallFieldPage> createState() => _InstallFieldPageState();
}

class _InstallFieldPageState extends State<InstallFieldPage> {
  final TextEditingController _commentController = TextEditingController();
  List<File> _selectedImages = [];
  List<File> _verificationImages = []; // 2 зураг баталгаажуулалтын хувьд
  List<Map<String, String>> _existingImages = []; // Existing images from server: [{id, url}]
  final ImagePicker _imagePicker = ImagePicker();
  bool _isLoading = false;
  bool _isSaving = false;
  
  // Check if this is a verification section
  bool get _isVerificationSection {
    final sectionTitle = widget.section['title']?.toString().toLowerCase() ?? '';
    final sectionId = widget.section['section']?.toString().toLowerCase() ?? '';
    return sectionTitle.contains('баталгаажуулалт') || 
           sectionId.contains('verification');
  }

  @override
  void initState() {
    super.initState();
    _loadExistingData();
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _loadExistingData() async {
    if (widget.assignmentId == null) {
      debugPrint('⚠️ No assignment ID provided, skipping data load');
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final templateId = widget.template['id']?.toString();
      final section = widget.section['title']?.toString();
      final fieldId = widget.field?['id']?.toString();

      if (templateId == null || section == null || fieldId == null) {
        debugPrint('⚠️ Missing required data for loading');
        return;
      }

      // Load existing comment
      try {
        final answerResponse = await InstallationAnswerAPI.getAnswers(
          assignmentId: widget.assignmentId!,
          templateId: templateId,
        );

        if (answerResponse != null && answerResponse['data'] != null) {
          final answers = answerResponse['data']['answers'];
          if (answers != null && answers[section] != null && answers[section][fieldId] != null) {
            final fieldData = answers[section][fieldId];
            _commentController.text = fieldData['comment'] ?? '';
            debugPrint('✅ Loaded existing comment: ${fieldData['comment']}');
          }
        }
      } catch (answerError) {
        debugPrint('⚠️ Error loading answers (non-critical): $answerError');
        // Continue to load images even if answers fail
      }

      // Load existing images
      try {
        final imagesResponse = await InstallationAnswerAPI.getImages(
          assignmentId: widget.assignmentId!,
          templateId: templateId,
          section: section,
          fieldId: fieldId,
        );

        debugPrint('📸 Images response: $imagesResponse');
        
        if (imagesResponse != null && imagesResponse['data'] != null) {
          final imagesList = imagesResponse['data'] as List;
          debugPrint('📸 Found ${imagesList.length} images');
          
          _existingImages = imagesList
              .map((img) {
                final imageId = img['id']?.toString();
                var url = img['imageUrl'] as String?;
                debugPrint('📸 Original Image URL: $url');
                
                // Convert local IP URL to ngrok URL if ngrok is configured
                if (url != null && url.isNotEmpty) {
                  // If URL contains local IP and ngrok is configured, replace with ngrok URL
                  if (url.contains('192.168.1.35:4555') && AppConfig.apiBaseUrl.contains('ngrok')) {
                    // Extract the path after /uploads/
                    final pathMatch = RegExp(r'/uploads/(.+)$').firstMatch(url);
                    if (pathMatch != null) {
                      final imagePath = pathMatch.group(1);
                      url = '${AppConfig.apiBaseUrl}/uploads/$imagePath';
                      debugPrint('📸 Converted to ngrok URL: $url');
                    }
                  }
                }
                
                if (imageId != null && url != null && url.isNotEmpty) {
                  return {'id': imageId, 'url': url};
                }
                return null;
              })
              .where((img) => img != null)
              .cast<Map<String, String>>()
              .toList();
          
          debugPrint('✅ Loaded ${_existingImages.length} existing images');
          for (var img in _existingImages) {
            debugPrint('   - ID: ${img['id']}, URL: ${img['url']}');
          }
        } else {
          debugPrint('⚠️ No images data in response');
        }
      } catch (imageError) {
        debugPrint('⚠️ Error loading images (non-critical): $imageError');
        // Continue even if images fail to load
      }
    } catch (e) {
      debugPrint('❌ Error loading existing data: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _pickImage() async {
    try {
      final XFile? image = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
      );

      if (image != null) {
        setState(() {
          if (_isVerificationSection) {
            // Баталгаажуулалтын хувьд 2 зураг хадгална
            if (_verificationImages.length < 2) {
              _verificationImages.add(File(image.path));
            } else {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Зөвхөн 2 зураг оруулах боломжтой')),
              );
            }
          } else {
            _selectedImages.add(File(image.path));
          }
        });
      }
    } catch (e) {
      debugPrint('Error picking image: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Зураг сонгох үед алдаа гарлаа: $e')),
        );
      }
    }
  }

  void _removeImage(int index) {
    setState(() {
      if (_isVerificationSection) {
        if (index < _verificationImages.length) {
          _verificationImages.removeAt(index);
        }
      } else {
        _selectedImages.removeAt(index);
      }
    });
  }

  Future<void> _removeExistingImage(int index) async {
    if (index < 0 || index >= _existingImages.length) {
      return;
    }

    final image = _existingImages[index];
    final imageId = image['id'];

    if (imageId == null || widget.assignmentId == null) {
      return;
    }

    // Show confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Зураг устгах'),
          content: const Text('Та энэ зургийг устгахдаа итгэлтэй байна уу?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Цуцлах'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: TextButton.styleFrom(
                foregroundColor: Colors.red,
              ),
              child: const Text('Устгах'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    try {
      // Delete image from backend
      await InstallationAnswerAPI.deleteImage(
        assignmentId: widget.assignmentId!,
        imageId: imageId,
      );

      // Remove from local list
      if (mounted) {
        setState(() {
          _existingImages.removeAt(index);
        });

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Зураг амжилттай устгалаа'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      debugPrint('❌ Error deleting image: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Зураг устгахад алдаа гарлаа: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _saveData() async {
    if (widget.assignmentId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Томилолтын ID олдсонгүй')),
      );
      return;
    }

    final templateId = widget.template['id']?.toString();
    final section = widget.section['title']?.toString();
    final fieldId = widget.field?['id']?.toString();
    final question = widget.field?['question']?.toString() ?? '';

    if (templateId == null || section == null || fieldId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Шаардлагатай мэдээлэл дутуу байна')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      // Save comment
      if (_commentController.text.trim().isNotEmpty) {
        await InstallationAnswerAPI.saveFieldAnswer(
          assignmentId: widget.assignmentId!,
          templateId: templateId,
          section: section,
          fieldId: fieldId,
          question: question,
          comment: _commentController.text.trim(),
        );
        debugPrint('✅ Comment saved successfully');
      }

      // Upload images
      final imagesToUpload = _isVerificationSection ? _verificationImages : _selectedImages;
      if (imagesToUpload.isNotEmpty) {
        await InstallationAnswerAPI.uploadImages(
          assignmentId: widget.assignmentId!,
          templateId: templateId,
          section: section,
          fieldId: fieldId,
          images: imagesToUpload,
        );
        debugPrint('✅ Images uploaded successfully');
        
        // Clear selected images after successful upload
        setState(() {
          if (_isVerificationSection) {
            _verificationImages = [];
          } else {
            _selectedImages = [];
          }
        });
      }

      // Reload existing data to show uploaded images
      await _loadExistingData();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Амжилттай хадгаллаа'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      debugPrint('❌ Error saving data: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Хадгалахад алдаа гарлаа: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final sectionTitle = widget.section['title']?.toString() ?? 'Тодорхойгүй';
    final fieldQuestion = widget.field?['question']?.toString() ?? sectionTitle;

    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(fieldQuestion),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _isLoading
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Ачаалж байна...'),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Тайлбар бичих хэсэг
                  _buildCommentSection(),
                  const SizedBox(height: 24),
                  
                  // Зураг оруулах хэсэг
                  _isVerificationSection 
                      ? _buildVerificationImageSection()
                      : _buildImageSection(),
                  
                  const SizedBox(height: 24),
                  
                  // Товчнууд
                  _isVerificationSection
                      ? _buildVerificationButtons()
                      : _buildSaveButton(),
                  
                  // Доод хэсэгт зай нэмэх (navbar-тай ижил түвшинд)
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _buildCommentSection() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.comment, color: AppColors.primary),
                const SizedBox(width: 8),
                const Text(
                  'Тайлбар',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _commentController,
              maxLines: 5,
              decoration: InputDecoration(
                hintText: 'Тайлбар оруулах...',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                filled: true,
                fillColor: Colors.grey[50],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildImageSection() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.image, color: AppColors.primary),
                const SizedBox(width: 8),
                const Text(
                  'Зураг оруулах',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            
            // Existing images from server
            if (_existingImages.isNotEmpty) ...[
              const Text(
                'Одоогийн зургууд:',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: List.generate(_existingImages.length, (index) {
                  final image = _existingImages[index];
                  final imageUrl = image['url'] ?? '';
                  
                  return Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(
                          imageUrl,
                          width: 150,
                          height: 150,
                          fit: BoxFit.cover,
                          loadingBuilder: (context, child, loadingProgress) {
                            if (loadingProgress == null) {
                              return child;
                            }
                            return Container(
                              width: 150,
                              height: 150,
                              color: Colors.grey[200],
                              child: Center(
                                child: CircularProgressIndicator(
                                  value: loadingProgress.expectedTotalBytes != null
                                      ? loadingProgress.cumulativeBytesLoaded /
                                          loadingProgress.expectedTotalBytes!
                                      : null,
                                ),
                              ),
                            );
                          },
                          errorBuilder: (context, error, stackTrace) {
                            debugPrint('❌ Image load error: $error');
                            debugPrint('   URL: $imageUrl');
                            return Container(
                              width: 150,
                              height: 150,
                              decoration: BoxDecoration(
                                color: Colors.grey[300],
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.broken_image, size: 40, color: Colors.grey),
                                  const SizedBox(height: 8),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    child: Text(
                                      'Зураг ачаалахгүй',
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: Colors.grey[600],
                                      ),
                                      textAlign: TextAlign.center,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.close, color: Colors.white, size: 18),
                            padding: const EdgeInsets.all(4),
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () => _removeExistingImage(index),
                          ),
                        ),
                      ),
                    ],
                  );
                }),
              ),
              const SizedBox(height: 16),
            ],
            
            // New selected images
            if (_selectedImages.isNotEmpty) ...[
              const Text(
                'Шинэ зургууд:',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: List.generate(_selectedImages.length, (index) {
                  return Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.file(
                          _selectedImages[index],
                          width: 150,
                          height: 150,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.close, color: Colors.white, size: 18),
                            padding: const EdgeInsets.all(4),
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () => _removeImage(index),
                          ),
                        ),
                      ),
                    ],
                  );
                }),
              ),
              const SizedBox(height: 16),
            ],
            
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _pickImage,
                icon: const Icon(Icons.add_photo_alternate),
                label: const Text('Зураг нэмэх'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSaveButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _isSaving ? null : _saveData,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: _isSaving
            ? const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  ),
                  SizedBox(width: 12),
                  Text('Хадгалж байна...'),
                ],
              )
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.save),
                  SizedBox(width: 8),
                  Text(
                    'Хадгалах',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildVerificationImageSection() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.image, color: AppColors.primary),
                const SizedBox(width: 8),
                const Text(
                  'Зураг оруулах (2 зураг)',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            
            // Existing images from server
            if (_existingImages.isNotEmpty) ...[
              const Text(
                'Одоогийн зургууд:',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: List.generate(_existingImages.length, (index) {
                  final image = _existingImages[index];
                  final imageUrl = image['url'] ?? '';
                  
                  return Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(
                          imageUrl,
                          width: 150,
                          height: 150,
                          fit: BoxFit.cover,
                          loadingBuilder: (context, child, loadingProgress) {
                            if (loadingProgress == null) {
                              return child;
                            }
                            return Container(
                              width: 150,
                              height: 150,
                              color: Colors.grey[200],
                              child: Center(
                                child: CircularProgressIndicator(
                                  value: loadingProgress.expectedTotalBytes != null
                                      ? loadingProgress.cumulativeBytesLoaded /
                                          loadingProgress.expectedTotalBytes!
                                      : null,
                                ),
                              ),
                            );
                          },
                          errorBuilder: (context, error, stackTrace) {
                            return Container(
                              width: 150,
                              height: 150,
                              decoration: BoxDecoration(
                                color: Colors.grey[300],
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.broken_image, size: 40, color: Colors.grey),
                                  const SizedBox(height: 8),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    child: Text(
                                      'Зураг ачаалахгүй',
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: Colors.grey[600],
                                      ),
                                      textAlign: TextAlign.center,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.close, color: Colors.white, size: 18),
                            padding: const EdgeInsets.all(4),
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () => _removeExistingImage(index),
                          ),
                        ),
                      ),
                    ],
                  );
                }),
              ),
              const SizedBox(height: 16),
            ],
            
            // New selected images (2 зураг)
            if (_verificationImages.isNotEmpty) ...[
              const Text(
                'Шинэ зургууд:',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: List.generate(_verificationImages.length, (index) {
                  return Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.file(
                          _verificationImages[index],
                          width: 150,
                          height: 150,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.close, color: Colors.white, size: 18),
                            padding: const EdgeInsets.all(4),
                            constraints: const BoxConstraints(
                              minWidth: 28,
                              minHeight: 28,
                            ),
                            onPressed: () => _removeImage(index),
                          ),
                        ),
                      ),
                    ],
                  );
                }),
              ),
              const SizedBox(height: 16),
            ],
            
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _verificationImages.length >= 2 ? null : _pickImage,
                icon: const Icon(Icons.add_photo_alternate),
                label: Text(_verificationImages.length >= 2 
                    ? '2 зураг оруулсан' 
                    : 'Зураг нэмэх (${_verificationImages.length}/2)'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVerificationButtons() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Дахин эхлүүлэх товч
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _isSaving ? null : _restartVerification,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.orange,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: _isSaving
                ? const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      ),
                      SizedBox(width: 12),
                      Text('Хадгалж байна...'),
                    ],
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.refresh),
                      SizedBox(width: 8),
                      Text(
                        'Дахин эхлүүлэх',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
        const SizedBox(height: 12),
        // Дуусгах товч
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _isSaving ? null : _completeVerification,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: _isSaving
                ? const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      ),
                      SizedBox(width: 12),
                      Text('Хадгалж байна...'),
                    ],
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle),
                      SizedBox(width: 8),
                      Text(
                        'Дуусгах',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }

  Future<void> _restartVerification() async {
    // Хадгалах
    await _saveData();
    
    // Хадгалсны дараа дэлгэц дээрх data-г цэвэрлэх
    if (mounted) {
      setState(() {
        _commentController.clear();
        _verificationImages.clear();
        _existingImages.clear();
      });
      
      // Дахин эхлүүлэх үеийг бэлтгэх - дахин ачаалах
      await _loadExistingData();
      
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✅ Мэдээлэл хадгалагдлаа. Дахин эхлүүлэх бэлэн.'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  Future<void> _completeVerification() async {
    // Хадгалах
    await _saveData();
    
    // Тухайн хэсгээс шууд гарах
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

}
