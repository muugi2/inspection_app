import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/services/api.dart';
import 'package:app/config/app_config.dart';

class InstallActPage extends StatefulWidget {
  final String? assignmentId;
  final String? orgId;
  final String? title;
  final String? templateId;

  const InstallActPage({
    super.key,
    this.assignmentId,
    this.orgId,
    this.title,
    this.templateId,
  });

  @override
  State<InstallActPage> createState() => _InstallActPageState();
}

class _InstallActPageState extends State<InstallActPage> {
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _commentController = TextEditingController();
  File? _selectedFile;
  final ImagePicker _imagePicker = ImagePicker();
  bool _isLoading = false;
  bool _isSaving = false;
  bool _isAddingNew = false; // Track if adding new act
  List<Map<String, dynamic>> _existingActs = [];
  Map<String, dynamic>? _editingAct; // Currently editing act
  Map<String, dynamic>? _selectedAct; // Currently selected act for detail view

  @override
  void initState() {
    super.initState();
    _loadExistingActs();
  }

  @override
  void dispose() {
    _titleController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _loadExistingActs() async {
    if (widget.assignmentId == null || widget.templateId == null) {
      debugPrint('⚠️ Missing assignment ID or template ID');
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final response = await InstallationActAPI.getByAssignmentAndTemplate(
        assignmentId: widget.assignmentId!,
        templateId: widget.templateId!,
      );

      final data = response['data'] ?? response;
      if (data is List) {
        // Convert image URLs to ngrok URLs if needed
        final acts = data.cast<Map<String, dynamic>>().map((act) {
          var imageUrl = act['image_url']?.toString();
          if (imageUrl != null && imageUrl.isNotEmpty) {
            // Convert local IP URL to ngrok URL if ngrok is configured
            if (imageUrl.contains('192.168.1.54:4555') && AppConfig.apiBaseUrl.contains('ngrok')) {
              final pathMatch = RegExp(r'/uploads/(.+)$').firstMatch(imageUrl);
              if (pathMatch != null) {
                final imagePath = pathMatch.group(1);
                imageUrl = '${AppConfig.apiBaseUrl}/uploads/$imagePath';
                debugPrint('📸 Converted act image URL to ngrok: $imageUrl');
              }
            }
            act['image_url'] = imageUrl;
          }
          return act;
        }).toList();
        
        setState(() {
          _existingActs = acts;
        });
        debugPrint('✅ Loaded ${_existingActs.length} existing acts');
      }
    } catch (e) {
      debugPrint('❌ Error loading existing acts: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _pickFile() async {
    try {
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
      );

      if (pickedFile != null) {
        setState(() {
          _selectedFile = File(pickedFile.path);
        });
        debugPrint('✅ File selected: ${pickedFile.path}');
      }
    } catch (e) {
      debugPrint('❌ Error picking file: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Файл сонгоход алдаа гарлаа: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _removeFile() {
    setState(() {
      _selectedFile = null;
    });
  }

  Future<void> _saveAct() async {
    if (widget.assignmentId == null || widget.orgId == null || widget.title == null || widget.templateId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Шаардлагатай мэдээлэл дутуу байна'),
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
      String? actId;

      // If editing existing act, update it
      if (_editingAct != null) {
        actId = _editingAct!['id']?.toString();
        
        // Update act
        await InstallationActAPI.update(
          id: actId!,
          actTitle: _titleController.text.trim().isNotEmpty ? _titleController.text.trim() : null,
          comment: _commentController.text.trim(),
        );

        // Upload file if selected
        if (_selectedFile != null) {
          await InstallationActAPI.uploadFile(
            actId: actId,
            file: _selectedFile!,
          );
        }
      } else {
        // Create new act
        final createResponse = await InstallationActAPI.create(
          assignmentId: widget.assignmentId!,
          orgId: widget.orgId!,
          title: widget.title!,
          templateId: widget.templateId!,
          actTitle: _titleController.text.trim().isNotEmpty ? _titleController.text.trim() : null,
          comment: _commentController.text.trim(),
        );

        final createdData = createResponse['data'] ?? createResponse;
        actId = createdData['id']?.toString();

        // Upload file if selected
        if (_selectedFile != null && actId != null) {
          await InstallationActAPI.uploadFile(
            actId: actId,
            file: _selectedFile!,
          );
        }
      }

      // Reload acts
      await _loadExistingActs();

      // Clear form
      setState(() {
        _titleController.clear();
        _commentController.clear();
        _selectedFile = null;
        _isAddingNew = false;
        _editingAct = null;
        _selectedAct = null; // Close detail view if open
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Акт амжилттай хадгаллаа'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      debugPrint('❌ Error saving act: $e');
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

  void _startAddingNew() {
    setState(() {
      _isAddingNew = true;
      _editingAct = null;
      _titleController.clear();
      _commentController.clear();
      _selectedFile = null;
    });
  }

  void _cancelAdding() {
    setState(() {
      _isAddingNew = false;
      _editingAct = null;
      _selectedAct = null; // Close detail view if open
      _titleController.clear();
      _commentController.clear();
      _selectedFile = null;
    });
  }

  void _editAct(Map<String, dynamic> act) {
    setState(() {
      _isAddingNew = true;
      _editingAct = act;
      _selectedAct = null; // Close detail view
      _titleController.text = act['act_title']?.toString() ?? '';
      _commentController.text = act['comment']?.toString() ?? '';
      _selectedFile = null; // File will be loaded from URL if needed
    });
  }

  void _deleteAct(Map<String, dynamic> act) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Акт устгах'),
          content: const Text('Та энэ актыг устгахдаа итгэлтэй байна уу?'),
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
      final actId = act['id']?.toString();
      if (actId != null) {
        await InstallationActAPI.delete(actId);
        
        // Close detail view and go back to list
        setState(() {
          _selectedAct = null;
        });
        
        // Reload acts list
        await _loadExistingActs();
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Акт амжилттай устгалаа'),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('❌ Error deleting act: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Устгахад алдаа гарлаа: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(_selectedAct != null ? 'Акт #${_selectedAct!['id']}' : 'Акт'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_selectedAct != null) {
              // Go back to list view
              setState(() {
                _selectedAct = null;
              });
            } else {
              // Go back to previous page
              Navigator.of(context).pop();
            }
          },
        ),
        actions: [
          if (!_isAddingNew && _selectedAct == null)
            IconButton(
              icon: const Icon(Icons.add),
              onPressed: _startAddingNew,
              tooltip: 'Шинэ акт нэмэх',
            ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Ачаалж байна...'),
          ],
        ),
      );
    }

    // Show detail view if an act is selected
    if (_selectedAct != null && !_isAddingNew) {
      return _buildActDetailView(_selectedAct!);
    }

    // Show add/edit form
    if (_isAddingNew) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildTitleSection(),
            const SizedBox(height: 24),
            _buildCommentSection(),
            const SizedBox(height: 24),
            _buildFileUploadSection(),
            const SizedBox(height: 24),
            _buildActionButtons(),
          ],
        ),
      );
    }

    // Show list of acts
    if (_existingActs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.description_outlined, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Акт олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Шинэ акт нэмэхийн тулд + тэмдэг дээр дарна уу',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16.0),
      itemCount: _existingActs.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final act = _existingActs[index];
        return _buildActListItem(act);
      },
    );
  }

  Widget _buildTitleSection() {
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
                Icon(Icons.title, color: AppColors.primary),
                const SizedBox(width: 8),
                const Text(
                  'Гарчиг',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _titleController,
              decoration: InputDecoration(
                hintText: 'Актын гарчиг оруулах...',
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

  Widget _buildFileUploadSection() {
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
                  'Файл оруулах',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_selectedFile != null) ...[
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.file(
                          _selectedFile!,
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
                            onPressed: _removeFile,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ] else ...[
              InkWell(
                onTap: _pickFile,
                child: Container(
                  height: 150,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.grey[300]!),
                    borderRadius: BorderRadius.circular(12),
                    color: Colors.grey[50],
                  ),
                  child: const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.upload_file, size: 48, color: Colors.grey),
                        SizedBox(height: 8),
                        Text(
                          'Файл сонгох',
                          style: TextStyle(color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildActionButtons() {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: _isSaving ? null : _cancelAdding,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
            child: const Text('Буцах'),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: ElevatedButton(
            onPressed: _isSaving ? null : _saveAct,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              backgroundColor: AppColors.primary,
            ),
            child: _isSaving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Text('Хадгалах'),
          ),
        ),
      ],
    );
  }

  Widget _buildActListItem(Map<String, dynamic> act) {
    final actTitle = act['act_title']?.toString() ?? '';
    final comment = act['comment']?.toString() ?? '';
    final imageUrl = act['image_url']?.toString();
    final hasImage = imageUrl != null && imageUrl.isNotEmpty;
    final hasComment = comment.isNotEmpty;
    
    // Use act_title as title if available, otherwise use comment, otherwise show default text
    String title = '';
    String subtitle = '';
    
    if (actTitle.isNotEmpty) {
      title = actTitle.length > 50 ? '${actTitle.substring(0, 50)}...' : actTitle;
      if (hasComment && hasImage) {
        subtitle = 'Тайлбар, зураг';
      } else if (hasComment) {
        subtitle = 'Тайлбар';
      } else if (hasImage) {
        subtitle = 'Зураг';
      }
    } else if (hasComment) {
      // Use comment as title (truncate if too long)
      title = comment.length > 50 ? '${comment.substring(0, 50)}...' : comment;
      if (hasImage) {
        subtitle = 'Тайлбар, зураг';
      } else {
        subtitle = 'Тайлбар';
      }
    } else if (hasImage) {
      title = 'Акт файл';
      subtitle = 'Зураг';
    } else {
      title = 'Акт файл оруулах';
      subtitle = '';
    }

    return SizedBox(
      height: 72,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.textPrimary,
          elevation: 1,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Color(0xFFE6E6E6)),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 12,
          ),
        ),
        onPressed: () {
          setState(() {
            _selectedAct = act;
          });
        },
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppColors.centerGradient,
              ),
              child: const Icon(
                Icons.description,
                color: Colors.white,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 12),
            const Icon(
              Icons.play_arrow_rounded,
              color: AppColors.primary,
              size: 28,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActDetailView(Map<String, dynamic> act) {
    final actTitle = act['act_title']?.toString() ?? '';
    final comment = act['comment']?.toString() ?? '';
    final imageUrl = act['image_url']?.toString();
    final createdAt = act['created_at']?.toString() ?? '';

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Title section
          if (actTitle.isNotEmpty) ...[
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.title, color: AppColors.primary),
                        const SizedBox(width: 8),
                        const Text(
                          'Гарчиг',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      actTitle,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          
          // Comment section
          if (comment.isNotEmpty) ...[
            Card(
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
                    Text(
                      comment,
                      style: const TextStyle(fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Image section
          if (imageUrl != null && imageUrl.isNotEmpty) ...[
            Card(
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
                          'Зураг',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
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
                              debugPrint('❌ Act image load error: $error');
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
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Date section
          if (createdAt.isNotEmpty) ...[
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    Icon(Icons.calendar_today, color: AppColors.primary, size: 20),
                    const SizedBox(width: 8),
                    Text(
                      'Огноо: $createdAt',
                      style: TextStyle(fontSize: 14, color: Colors.grey[700]),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Action buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    setState(() {
                      _selectedAct = null;
                    });
                  },
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Буцах'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => _editAct(act),
                  icon: const Icon(Icons.edit),
                  label: const Text('Засварлах'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: AppColors.primary,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => _deleteAct(act),
                  icon: const Icon(Icons.delete),
                  label: const Text('Устгах'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: Colors.red,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
