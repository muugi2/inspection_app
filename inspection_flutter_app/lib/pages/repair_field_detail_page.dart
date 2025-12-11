import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/config/app_config.dart';
import 'package:app/pages/repair_edit_page.dart';

class RepairFieldDetailPage extends StatefulWidget {
  final String inspectionId;
  final String fieldId;
  final String section;
  final Map<String, dynamic> field;
  final Map<String, dynamic>? inspectionData;
  final Map<String, dynamic>? deviceInfo;

  const RepairFieldDetailPage({
    super.key,
    required this.inspectionId,
    required this.fieldId,
    required this.section,
    required this.field,
    this.inspectionData,
    this.deviceInfo,
  });

  @override
  State<RepairFieldDetailPage> createState() => _RepairFieldDetailPageState();
}

class _RepairFieldDetailPageState extends State<RepairFieldDetailPage> {
  bool _loading = true;
  List<Map<String, dynamic>> _images = [];

  @override
  void initState() {
    super.initState();
    _loadImages();
  }

  Future<void> _loadImages() async {
    setState(() {
      _loading = true;
    });

    try {
      debugPrint('🔍 Loading question images for field: ${widget.fieldId}');
      
      final response = await InspectionAPI.getQuestionImages(
        widget.inspectionId,
        fieldId: widget.fieldId,
        section: widget.section,
      );

      debugPrint('📦 Response structure: ${response.keys}');
      
      // Response structure: { data: { inspectionId: "42", images: [...] } }
      final dataMap = response['data'] as Map<String, dynamic>?;
      
      if (dataMap == null) {
        debugPrint('⚠️ No data map in response');
        setState(() {
          _images = [];
          _loading = false;
        });
        return;
      }
      
      final imagesData = dataMap['images'] as List<dynamic>? ?? [];
      debugPrint('📸 Found ${imagesData.length} image(s) in response');
      
      setState(() {
        _images = imagesData.cast<Map<String, dynamic>>();
        _loading = false;
      });

      debugPrint('✅ Loaded ${_images.length} image(s)');
    } catch (e) {
      debugPrint('❌ Error loading images: $e');
      setState(() {
        _loading = false;
      });
    }
  }

  void _navigateToRepairEdit() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RepairEditPage(
          inspectionId: widget.inspectionId,
          fieldId: widget.fieldId,
          section: widget.section,
          field: widget.field,
          inspectionData: widget.inspectionData,
        ),
      ),
    ).then((result) {
      if (result == true) {
        // Repair was saved, go back to list
        Navigator.of(context).pop(true);
      }
    });
  }

  void _showFullScreenImage(int initialIndex, String? initialImageUrl, Map<String, dynamic> initialImage) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _FullScreenImageViewer(
          images: _images,
          initialIndex: initialIndex,
          getImageUrl: _getImageUrl,
        ),
      ),
    );
  }

  String? _getImageUrl(Map<String, dynamic> image) {
    // Priority 1: Use base64 data if available (most reliable)
    final imageData = image['imageData'] as String?;
    if (imageData != null && imageData.isNotEmpty) {
      final mimeType = image['mimeType'] as String? ?? 'image/jpeg';
      return 'data:$mimeType;base64,$imageData';
    }
    
    // Priority 2: Use HTTP/HTTPS URL from backend (buildPublicUrl)
    final imageUrl = image['imageUrl'] as String? ?? '';
    if (imageUrl.isNotEmpty) {
      // If already full HTTP/HTTPS URL, return as is
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return imageUrl;
      }
      
      // If relative path, construct public URL using AppConfig
      if (!imageUrl.startsWith('ftp://')) {
        // Use public base URL for image serving
        final baseUrl = AppConfig.ftpPublicBaseUrl.replaceAll(RegExp(r'/$'), '');
        final cleanPath = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
        return '$baseUrl/$cleanPath';
      }
    }
    
    // Priority 3: Fallback - construct from storage path if available
    final storagePath = image['storagePath'] as String?;
    if (storagePath != null && storagePath.isNotEmpty) {
      final baseUrl = AppConfig.ftpPublicBaseUrl.replaceAll(RegExp(r'/$'), '');
      final cleanPath = storagePath.startsWith('/') ? storagePath.substring(1) : storagePath;
      return '$baseUrl/$cleanPath';
    }
    
    return null;
  }

  Widget _buildImageGallery() {
    if (_images.isEmpty) {
      return Card(
        margin: const EdgeInsets.all(16),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Column(
              children: const [
                Icon(
                  Icons.image_not_supported,
                  size: 48,
                  color: AppColors.textSecondary,
                ),
                SizedBox(height: 8),
                Text(
                  'Зураг байхгүй',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            'Зургууд',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        SizedBox(
          height: 200,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: _images.length,
            itemBuilder: (context, index) {
              final image = _images[index];
              debugPrint('🖼️ Image $index: ${image.keys}');
              debugPrint('   imageData: ${image['imageData'] != null ? '${image['imageData'].toString().substring(0, 50)}...' : 'null'}');
              debugPrint('   imageUrl: ${image['imageUrl']}');
              
              final imageUrl = _getImageUrl(image);
              if (imageUrl != null) {
                debugPrint('   Final imageUrl: ${imageUrl.length > 100 ? imageUrl.substring(0, 100) + '...' : imageUrl}');
              } else {
                debugPrint('   Final imageUrl: null');
              }
              
              if (imageUrl == null) {
                debugPrint('   ❌ No image URL available');
                return Container(
                  width: 200,
                  margin: const EdgeInsets.only(right: 12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFE6E6E6)),
                    color: Colors.grey[200],
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.broken_image,
                      size: 48,
                      color: AppColors.textSecondary,
                    ),
                  ),
                );
              }
              
              return Container(
                width: 200,
                margin: const EdgeInsets.only(right: 12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE6E6E6)),
                ),
                child: InkWell(
                  onTap: () => _showFullScreenImage(index, imageUrl, image),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: imageUrl.startsWith('data:')
                      ? Builder(
                          builder: (context) {
                            try {
                              debugPrint('   📸 Decoding base64 data URI');
                              
                              // Extract base64 string from data URI
                              // Format: "data:image/jpeg;base64,/9j/4QGCRXhpZg..."
                              final base64String = imageUrl.contains(',') 
                                  ? imageUrl.split(',').last 
                                  : imageUrl.replaceFirst(RegExp(r'^data:[^;]+;base64,'), '');
                              
                              debugPrint('   📝 Base64 string length: ${base64String.length}');
                              debugPrint('   📝 First 50 chars: ${base64String.substring(0, base64String.length > 50 ? 50 : base64String.length)}');
                              
                              // Decode base64 to bytes
                              final bytes = base64Decode(base64String);
                              
                              if (bytes.isEmpty) {
                                debugPrint('   ❌ Decoded bytes is empty');
                                throw Exception('Empty decoded bytes');
                              }
                              
                              debugPrint('   ✅ Decoded ${bytes.length} bytes from base64');
                              debugPrint('   📊 First 10 bytes: ${bytes.take(10).toList()}');
                              
                              return Image.memory(
                                bytes,
                                fit: BoxFit.cover,
                                errorBuilder: (context, error, stackTrace) {
                                  debugPrint('   ❌ Image.memory error: $error');
                                  debugPrint('   Stack: $stackTrace');
                                  // Fallback to network URL if base64 fails
                                  final networkUrl = image['imageUrl'] as String?;
                                  if (networkUrl != null && !networkUrl.startsWith('ftp://')) {
                                    debugPrint('   🔄 Falling back to network URL: $networkUrl');
                                    return Image.network(
                                      networkUrl,
                                      fit: BoxFit.cover,
                                      errorBuilder: (context, err, stack) {
                                        return Container(
                                          color: Colors.grey[200],
                                          child: const Center(
                                            child: Icon(
                                              Icons.broken_image,
                                              size: 48,
                                              color: AppColors.textSecondary,
                                            ),
                                          ),
                                        );
                                      },
                                    );
                                  }
                                  return Container(
                                    color: Colors.grey[200],
                                    child: const Center(
                                      child: Icon(
                                        Icons.broken_image,
                                        size: 48,
                                        color: AppColors.textSecondary,
                                      ),
                                    ),
                                  );
                                },
                              );
                            } catch (e) {
                              debugPrint('   ❌ Error decoding base64 image: $e');
                              debugPrint('   Stack trace: ${StackTrace.current}');
                              
                              // Fallback to HTTP URL
                              final storagePath = image['storagePath'] as String?;
                              if (storagePath != null) {
                                final baseUrl = AppConfig.ftpPublicBaseUrl.replaceAll(RegExp(r'/$'), '');
                                final cleanPath = storagePath.startsWith('/') ? storagePath.substring(1) : storagePath;
                                final fallbackUrl = '$baseUrl/$cleanPath';
                                debugPrint('   🔄 Falling back to HTTP URL: $fallbackUrl');
                                
                                return Image.network(
                                  fallbackUrl,
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) {
                                    return Container(
                                      color: Colors.grey[200],
                                      child: const Center(
                                        child: Icon(
                                          Icons.broken_image,
                                          size: 48,
                                          color: AppColors.textSecondary,
                                        ),
                                      ),
                                    );
                                  },
                                );
                              }
                              
                              return Container(
                                color: Colors.grey[200],
                                child: const Center(
                                  child: Icon(
                                    Icons.broken_image,
                                    size: 48,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              );
                            }
                          },
                        )
                      : Builder(
                          builder: (context) {
                            debugPrint('   🌐 Loading image from network: $imageUrl');
                            return Image.network(
                              imageUrl,
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) {
                                debugPrint('   ❌ Error loading network image: $error');
                                debugPrint('   URL: $imageUrl');
                                return Container(
                                  color: Colors.grey[200],
                                  child: const Center(
                                    child: Icon(
                                      Icons.broken_image,
                                      size: 48,
                                      color: AppColors.textSecondary,
                                    ),
                                  ),
                                );
                              },
                              loadingBuilder: (context, child, loadingProgress) {
                                if (loadingProgress == null) {
                                  debugPrint('   ✅ Image loaded successfully');
                                  return child;
                                }
                                debugPrint('   ⏳ Loading progress: ${loadingProgress.cumulativeBytesLoaded}/${loadingProgress.expectedTotalBytes}');
                                return Container(
                                  color: Colors.grey[200],
                                  child: const Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final questionText = widget.field['questionText'] ?? 'Асуулт';
    final originalStatus = widget.field['originalStatus'] ?? '';
    final description = widget.field['description'] ?? '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Засварын дэлгэрэнгүй'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.only(bottom: 100),
              children: [
                const SizedBox(height: 16),
                
                // Question and status
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        questionText,
                        style: const TextStyle(
                          fontSize: 20,
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
                          originalStatus,
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
                
                const SizedBox(height: 24),
                
                // Description section
                Card(
                  margin: const EdgeInsets.symmetric(horizontal: 16),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: const [
                            Icon(
                              Icons.description,
                              size: 20,
                              color: AppColors.primary,
                            ),
                            SizedBox(width: 8),
                            Text(
                              'Тайлбар',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          description.isEmpty ? 'Тайлбар байхгүй' : description,
                          style: TextStyle(
                            fontSize: 14,
                            color: description.isEmpty 
                                ? AppColors.textSecondary 
                                : AppColors.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                
                const SizedBox(height: 16),
                
                // Images section
                _buildImageGallery(),
                
                const SizedBox(height: 24),
                
                // Repair action button
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: _navigateToRepairEdit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        elevation: 2,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.build_circle, size: 24),
                          SizedBox(width: 12),
                          Text(
                            'Засвар хийх',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

// Full screen image viewer
class _FullScreenImageViewer extends StatefulWidget {
  final List<Map<String, dynamic>> images;
  final int initialIndex;
  final String? Function(Map<String, dynamic>) getImageUrl;

  const _FullScreenImageViewer({
    required this.images,
    required this.initialIndex,
    required this.getImageUrl,
  });

  @override
  State<_FullScreenImageViewer> createState() => _FullScreenImageViewerState();
}

class _FullScreenImageViewerState extends State<_FullScreenImageViewer> {
  late PageController _pageController;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Widget _buildImageWidget(String? imageUrl, Map<String, dynamic> image) {
    if (imageUrl == null) {
      return const Center(
        child: Icon(Icons.broken_image, size: 64, color: Colors.grey),
      );
    }

    if (imageUrl.startsWith('data:')) {
      try {
        final base64String = imageUrl.contains(',') 
            ? imageUrl.split(',').last 
            : imageUrl.replaceFirst(RegExp(r'^data:[^;]+;base64,'), '');
        final bytes = base64Decode(base64String);
        
        return InteractiveViewer(
          minScale: 0.5,
          maxScale: 4.0,
          child: Image.memory(
            bytes,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) {
              return const Center(
                child: Icon(Icons.broken_image, size: 64, color: Colors.grey),
              );
            },
          ),
        );
      } catch (e) {
        return const Center(
          child: Icon(Icons.broken_image, size: 64, color: Colors.grey),
        );
      }
    } else {
      return InteractiveViewer(
        minScale: 0.5,
        maxScale: 4.0,
        child: Image.network(
          imageUrl,
          fit: BoxFit.contain,
          loadingBuilder: (context, child, loadingProgress) {
            if (loadingProgress == null) return child;
            return const Center(child: CircularProgressIndicator());
          },
          errorBuilder: (context, error, stackTrace) {
            return const Center(
              child: Icon(Icons.broken_image, size: 64, color: Colors.grey),
            );
          },
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text(
          '${_currentIndex + 1} / ${widget.images.length}',
          style: const TextStyle(color: Colors.white),
        ),
      ),
      body: PageView.builder(
        controller: _pageController,
        itemCount: widget.images.length,
        onPageChanged: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        itemBuilder: (context, index) {
          final image = widget.images[index];
          final imageUrl = widget.getImageUrl(image);
          return Center(
            child: _buildImageWidget(imageUrl, image),
          );
        },
      ),
    );
  }
}

