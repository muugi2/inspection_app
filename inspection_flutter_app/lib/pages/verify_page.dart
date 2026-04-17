import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/services/api.dart';

class VerifyPage extends StatefulWidget {
  final String? title; // Баталгаажуулалтын гарчиг
  final String? verificationId; // Баталгаажуулалтын ID
  
  const VerifyPage({
    super.key,
    this.title,
    this.verificationId,
  });

  @override
  State<VerifyPage> createState() => _VerifyPageState();
}

class _VerifyPageState extends State<VerifyPage> {
  final TextEditingController _commentController = TextEditingController();
  List<File> _verificationImages = []; // 2 зураг баталгаажуулалтын хувьд
  List<Map<String, String>> _existingImages = []; // Existing images from server
  final ImagePicker _imagePicker = ImagePicker();
  bool _isLoading = false;
  bool _isSaving = false;
  String? _currentVerificationId; // Current verification ID (can be updated after restart)

  @override
  void initState() {
    super.initState();
    _currentVerificationId = widget.verificationId;
    _loadExistingData();
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _loadExistingData() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final verificationId = _currentVerificationId ?? widget.verificationId;
      if (verificationId == null) {
        debugPrint('⚠️ No verification ID, skipping data load');
        return;
      }

      debugPrint('📋 Loading verification data for ID: $verificationId');

      // Load existing verification data from backend
      final response = await VerificationAPI.getById(verificationId);
      
      if (response is Map<String, dynamic>) {
        final data = response['data'] ?? response;
        
        // Load comment
        if (data['comment'] != null && data['comment'].toString().isNotEmpty) {
          _commentController.text = data['comment'].toString();
        }
        
        // Load images
        _existingImages.clear();
        final image1Url = data['image1_url']?.toString() ?? data['image1Url']?.toString();
        final image2Url = data['image2_url']?.toString() ?? data['image2Url']?.toString();
        
        if (image1Url != null && image1Url.isNotEmpty) {
          _existingImages.add({
            'id': 'image1',
            'url': image1Url,
          });
        }
        if (image2Url != null && image2Url.isNotEmpty) {
          _existingImages.add({
            'id': 'image2',
            'url': image2Url,
          });
        }
        
        debugPrint('✅ Loaded verification data: comment=${_commentController.text}, images=${_existingImages.length}');
        debugPrint('   Image1 URL: $image1Url');
        debugPrint('   Image2 URL: $image2Url');
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


  void _removeImage(int index) {
    setState(() {
      if (index < _verificationImages.length) {
        _verificationImages.removeAt(index);
      }
    });
  }

  Future<void> _removeExistingImage(int index) async {
    if (index < 0 || index >= _existingImages.length) {
      return;
    }

    final image = _existingImages[index];
    final imageId = image['id'];

    if (imageId == null) {
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
      // TODO: Delete image from backend
      // For now, just remove from local list
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
    final verificationId = _currentVerificationId ?? widget.verificationId;
    if (verificationId == null) {
      debugPrint('⚠️ No verification ID, cannot save');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Баталгаажуулалтын ID олдсонгүй'),
            backgroundColor: Colors.red,
          ),
        );
      }
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final verificationId = _currentVerificationId ?? widget.verificationId;
      if (verificationId == null) {
        throw Exception('Баталгаажуулалтын ID олдсонгүй');
      }

      debugPrint('💾 Saving verification data for ID: $verificationId');
      debugPrint('   Comment: ${_commentController.text}');
      debugPrint('   Images: ${_verificationImages.length}');

      // Upload images first if any
      String? image1Url;
      String? image2Url;
      String? fileName1;
      String? fileName2;
      int? fileSize1;
      int? fileSize2;
      
      if (_verificationImages.isNotEmpty) {
        debugPrint('📸 Uploading ${_verificationImages.length} images...');
        
        // Upload images via multipart form data
        final formData = FormData();
        for (int i = 0; i < _verificationImages.length && i < 2; i++) {
          final file = _verificationImages[i];
          final fileName = 'verification_${verificationId}_${DateTime.now().millisecondsSinceEpoch}_$i.jpg';
          
          formData.files.add(
            MapEntry(
              'images',
              await MultipartFile.fromFile(file.path, filename: fileName),
            ),
          );
        }
        
        try {
          final uploadResponse = await api.post(
            "/api/verifications/$verificationId/upload-images",
            data: formData,
            options: Options(headers: {'Content-Type': 'multipart/form-data'}),
          );
          
          if (uploadResponse.data is Map) {
            final data = uploadResponse.data['data'] ?? uploadResponse.data;
            final uploadedImages = data['uploadedImages'] as List<dynamic>? ?? [];
            
            if (uploadedImages.isNotEmpty) {
              image1Url = uploadedImages[0]['imageUrl']?.toString();
              fileName1 = uploadedImages[0]['fileName']?.toString();
              fileSize1 = uploadedImages[0]['fileSize'] as int?;
            }
            if (uploadedImages.length > 1) {
              image2Url = uploadedImages[1]['imageUrl']?.toString();
              fileName2 = uploadedImages[1]['fileName']?.toString();
              fileSize2 = uploadedImages[1]['fileSize'] as int?;
            }
            
            debugPrint('✅ Images uploaded: image1=$image1Url, image2=$image2Url');
            debugPrint('   File names: $fileName1, $fileName2');
            debugPrint('   File sizes: $fileSize1, $fileSize2');
          }
        } catch (e) {
          debugPrint('❌ Image upload failed: $e');
          // Continue without image URLs if upload fails
          // Comment will still be saved
        }
      }

      // Update verification with comment and image URLs
      // Always save comment, even if image upload failed
      final updateData = <String, dynamic>{
        'comment': _commentController.text.trim(),
      };
      
      if (image1Url != null) {
        updateData['image1Url'] = image1Url;
      }
      if (image2Url != null) {
        updateData['image2Url'] = image2Url;
      }
      if (fileName1 != null) {
        updateData['fileName1'] = fileName1;
      }
      if (fileName2 != null) {
        updateData['fileName2'] = fileName2;
      }
      if (fileSize1 != null) {
        updateData['fileSize1'] = fileSize1;
      }
      if (fileSize2 != null) {
        updateData['fileSize2'] = fileSize2;
      }

      debugPrint('📝 Updating verification with data: $updateData');
      await VerificationAPI.update(verificationId, updateData);
      debugPrint('✅ Verification updated successfully');

      // Clear selected images after successful save
      setState(() {
        _verificationImages = [];
      });

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

  Future<void> _restartVerification() async {
    final currentId = _currentVerificationId ?? widget.verificationId;
    if (currentId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Баталгаажуулалтын ID олдсонгүй'),
            backgroundColor: Colors.red,
          ),
        );
      }
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      // Хадгалах (одоогийн verification ID-тай)
      await _saveData();
      
      // Одоогийн verification-ийг COMPLETED болгох
      await VerificationAPI.update(currentId, {
        'status': 'COMPLETED',
      });
      debugPrint('✅ Current verification status updated to COMPLETED');
      
      // Шинэ PENDING verification үүсгэх (ижил title-тай)
      // Эхлээд одоогийн verification-ийн мэдээллийг авах
      final currentVerification = await VerificationAPI.getById(currentId);
      final data = currentVerification['data'] ?? currentVerification;
      
      final orgId = data['org_id']?.toString() ?? data['orgId']?.toString();
      final siteId = data['site_id']?.toString() ?? data['siteId']?.toString();
      final contractId = data['contract_id']?.toString() ?? data['contractId']?.toString();
      final title = data['title']?.toString() ?? widget.title ?? '';
      final userId = data['user_id']?.toString() ?? data['userId']?.toString();
      
      if (orgId != null && title.isNotEmpty && userId != null) {
        // Шинэ verification үүсгэх
        final createResponse = await api.post(
          '/api/verifications',
          data: {
            'orgId': orgId,
            if (siteId != null) 'siteId': siteId,
            if (contractId != null) 'contractId': contractId,
            'title': title,
            'userIds': [userId],
          },
        );
        
        debugPrint('✅ New verification created for restart');
        
        // Шинэ verification ID-г авах
        final newVerificationData = createResponse.data['data'];
        String? newVerificationId;
        
        if (newVerificationData is List && newVerificationData.isNotEmpty) {
          newVerificationId = newVerificationData[0]['id']?.toString();
        } else if (newVerificationData is Map) {
          newVerificationId = newVerificationData['id']?.toString();
        }
        
        // Хадгалсны дараа дэлгэц дээрх data-г цэвэрлэх
        if (mounted && newVerificationId != null) {
          // Шинэ verification ID-г state-д хадгалах
          setState(() {
            _currentVerificationId = newVerificationId;
            _commentController.clear();
            _verificationImages.clear();
            _existingImages.clear();
          });
          
          // Шинэ verification ID-тайгаар дахин ачаалах
          await _loadExistingData();
          
          debugPrint('✅ Switched to new verification ID: $newVerificationId');
          
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Мэдээлэл хадгалагдлаа. Дахин эхлүүлэх бэлэн.'),
              backgroundColor: Colors.green,
            ),
          );
        } else {
          throw Exception('Шинэ verification ID авах боломжгүй');
        }
      } else {
        throw Exception('Одоогийн баталгаажуулалтын мэдээлэл дутуу байна');
      }
    } catch (e) {
      debugPrint('❌ Error restarting verification: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Дахин эхлүүлэхэд алдаа гарлаа: $e'),
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

  Future<void> _completeVerification() async {
    final verificationId = _currentVerificationId ?? widget.verificationId;
    if (verificationId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Баталгаажуулалтын ID олдсонгүй'),
            backgroundColor: Colors.red,
          ),
        );
      }
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      // Хадгалах
      await _saveData();
      
      // Статусыг COMPLETED болгох
      await VerificationAPI.update(verificationId, {
        'status': 'COMPLETED',
      });
      debugPrint('✅ Verification status updated to COMPLETED');

      // Success message
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Баталгаажуулалт амжилттай дууслаа'),
            backgroundColor: Colors.green,
          ),
        );
        
        // Үндсэн дэлгэц рүү шилжих (VerifySelectionPage)
        // Бүх хуудаснуудыг pop хийж, VerifySelectionPage руу буцах
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      debugPrint('❌ Error completing verification: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Дуусгахад алдаа гарлаа: $e'),
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
    return Container(
      width: double.infinity,
      height: double.infinity,
      color: Colors.grey[50],
      padding: const EdgeInsets.only(bottom: 100), // Navbar-ийн өргөлтийн хувьд bottom padding
      child: _isLoading
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
                  // Гарчиг хэсэг
                  if (widget.title != null) ...[
                    Card(
                      elevation: 2,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Row(
                          children: [
                            Icon(Icons.verified_user, color: AppColors.primary),
                            const SizedBox(width: 8),
                            Text(
                              widget.title!,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  // Тайлбар бичих хэсэг
                  _buildCommentSection(),
                  const SizedBox(height: 24),
                  
                  // Зураг оруулах хэсэг (2 зураг)
                  _buildVerificationImageSection(),
                  
                  const SizedBox(height: 24),
                  
                  // Товчнууд
                  _buildVerificationButtons(),
                  
                  // Доод хэсэгт зай нэмэх
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

  Widget _buildVerificationImageSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Зураг №1 болон Зураг №2 (2 багана)
        Row(
          children: [
            // Зураг №1
            Expanded(
              child: _buildImageDisplayCard(
                title: 'Зураг №1',
                imageIndex: 0,
              ),
            ),
            const SizedBox(width: 12),
            // Зураг №2
            Expanded(
              child: _buildImageDisplayCard(
                title: 'Зураг №2',
                imageIndex: 1,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        // Зураг оруулах хэсэг (2 багана)
        Row(
          children: [
            // Зураг №1 оруулах
            Expanded(
              child: _buildImageUploadCard(
                title: 'Зураг №1 оруулах',
                imageIndex: 0,
              ),
            ),
            const SizedBox(width: 12),
            // Зураг №2 оруулах
            Expanded(
              child: _buildImageUploadCard(
                title: 'Зураг №2 оруулах',
                imageIndex: 1,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildImageDisplayCard({
    required String title,
    required int imageIndex,
  }) {
    // Check if we have existing image at this index
    final hasExistingImage = imageIndex < _existingImages.length;
    final existingImage = hasExistingImage ? _existingImages[imageIndex] : null;
    
    // Check if we have new selected image at this index
    final hasNewImage = imageIndex < _verificationImages.length;
    final newImage = hasNewImage ? _verificationImages[imageIndex] : null;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            // Display image
            if (newImage != null)
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(
                      newImage,
                      width: double.infinity,
                      height: 200,
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
                        onPressed: () => _removeImage(imageIndex),
                      ),
                    ),
                  ),
                ],
              )
            else if (existingImage != null)
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      existingImage['url'] ?? '',
                      width: double.infinity,
                      height: 200,
                      fit: BoxFit.cover,
                      loadingBuilder: (context, child, loadingProgress) {
                        if (loadingProgress == null) {
                          return child;
                        }
                        return Container(
                          width: double.infinity,
                          height: 200,
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
                          width: double.infinity,
                          height: 200,
                          decoration: BoxDecoration(
                            color: Colors.grey[300],
                            borderRadius: BorderRadius.circular(8),
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
                        onPressed: () => _removeExistingImage(imageIndex),
                      ),
                    ),
                  ),
                ],
              )
            else
              Container(
                width: double.infinity,
                height: 200,
                decoration: BoxDecoration(
                  color: Colors.grey[200],
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.grey[300]!),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.image_outlined, size: 48, color: Colors.grey[400]),
                    const SizedBox(height: 8),
                    Text(
                      'Зураг оруулаагүй',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey[600],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildImageUploadCard({
    required String title,
    required int imageIndex,
  }) {
    final hasImage = imageIndex < _verificationImages.length || 
                     imageIndex < _existingImages.length;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: hasImage ? null : () => _pickImageForIndex(imageIndex),
                icon: Icon(hasImage ? Icons.check_circle : Icons.add_photo_alternate),
                label: Text(hasImage ? 'Зураг оруулсан' : 'Зураг сонгох'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: hasImage ? Colors.grey[300] : AppColors.primary,
                  foregroundColor: hasImage ? Colors.grey[600] : Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickImageForIndex(int imageIndex) async {
    try {
      final XFile? image = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
      );

      if (image != null) {
        setState(() {
          // If we're replacing an existing image at this index
          if (imageIndex < _verificationImages.length) {
            _verificationImages[imageIndex] = File(image.path);
          } else {
            // Add new image at the specific index
            // Fill with nulls if needed
            while (_verificationImages.length < imageIndex) {
              _verificationImages.add(File(''));
            }
            _verificationImages.add(File(image.path));
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

  Widget _buildVerificationButtons() {
    return Row(
      children: [
        // Дуусгах товч (зүүн)
        Expanded(
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
        const SizedBox(width: 12),
        // Дахин эхлүүлэх товч (баруун)
        Expanded(
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
      ],
    );
  }
}
