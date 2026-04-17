import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/services/answer_service.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/conclusion_page.dart';
import 'package:app/utils/error_handler.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

class InspectionRunPage extends StatefulWidget {
  final String inspectionId;
  final Map<String, dynamic>? deviceInfo; // Device мэдээлэл дамжуулах
  final String? answerId; // Үргэлжлүүлэх үед одоогийн answer ID
  final Map<String, dynamic>? resumeData; // Үргэлжлүүлэх өгөгдөл

  const InspectionRunPage({
    super.key,
    required this.inspectionId,
    this.deviceInfo,
    this.answerId,
    this.resumeData,
  });

  @override
  State<InspectionRunPage> createState() => _InspectionRunPageState();
}

class _InspectionRunPageState extends State<InspectionRunPage> {
  // ===== LOADING & ERROR STATES =====
  bool _loading = true;
  String _error = '';

  // ===== TEMPLATE & SECTIONS =====
  Map<String, dynamic>?
  _template; // expecting { name, questions: [{title, fields:[...]}, ...] }
  List<Map<String, dynamic>> _sections = const [];

  // ===== INSPECTION INFO =====
  Map<String, dynamic>?
  _inspectionInfo; // Үзлэгийн мэдээлэл (scheduleType-ийг авах)

  // ===== PAGINATION & NAVIGATION =====
  int _currentSection = 0;
  final ScrollController _scrollController = ScrollController();

  // ===== UI STATES =====
  bool _showVerification = false;
  bool _showSectionReview = false;
  bool _isSavingSection = false;
  Map<String, dynamic>? _currentSectionAnswers;
  String? _answerId; // backend-ээс ирсэн answerId-г хадгална

  // ===== DEVICE INFO =====
  Map<String, dynamic>? _deviceInfo; // Device мэдээлэл (JSON payload-д ашиглах)

  // ===== FORM DATA =====
  final Map<String, Set<int>> _selectedOptionsByField = {}; // option indices
  final Map<String, String> _fieldTextByKey = {}; // extra text if required
  final Map<String, bool> _fieldHasImageByKey = {}; // image flag if required
  final Map<String, List<File>> _fieldImagesByKey = {}; // files per field

  // ===== FIELD KEYS FOR SCROLLING =====
  final Map<String, GlobalKey> _fieldKeys =
      {}; // GlobalKey for each field to enable scrolling
  String?
  _highlightedFieldKey; // Key of the field that should be highlighted (for invalid fields)

  // ===== LIFECYCLE METHODS =====
  @override
  void initState() {
    super.initState();
    
    // Үргэлжлүүлэх үед answerId болон resumeData-г тохируулах
    if (widget.answerId != null && widget.answerId!.isNotEmpty) {
      setState(() {
        _answerId = widget.answerId;
      });
      debugPrint('✅ Resuming inspection with answerId: ${widget.answerId}');
    }
    
    _loadInspectionInfo();
    _loadTemplate();

    // Constructor-аас ирсэн device мэдээлэл байвал ашиглах, үгүй бол API-аас татах
    if (widget.deviceInfo != null) {
      setState(() {
        _deviceInfo = widget.deviceInfo;
      });
      debugPrint('✅ Using device info from constructor: ${widget.deviceInfo}');
    } else {
      _loadDeviceInfo();
    }
  }
  
  // Load resume data (existing answers) - called after template is loaded
  void _loadResumeData() {
    try {
      debugPrint('=== LOADING RESUME DATA ===');
      final resumeData = widget.resumeData!;
      
      // Extract answers from resume data
      final answers = resumeData['answers'] as Map<String, dynamic>?;
      if (answers != null) {
        debugPrint('✅ Found resume answers with ${answers.length} sections');
        
        // Load answers into form fields
        // Note: We need to map field IDs to the correct field keys used in the form
        answers.forEach((sectionName, sectionData) {
          if (sectionName == 'metadata' || sectionName == 'remarks' || sectionName == 'signatures') {
            return; // Skip metadata, remarks, signatures
          }
          
          if (sectionData is Map<String, dynamic>) {
            // Find the section index
            final sectionIndex = _sections.indexWhere(
              (s) => (s['section'] as String?) == sectionName || 
                     (s['title'] as String?) == sectionName
            );
            
            if (sectionIndex >= 0) {
              final section = _sections[sectionIndex];
              final fields = (section['fields'] as List<dynamic>? ?? []);
              
              sectionData.forEach((fieldId, fieldValue) {
                if (fieldValue is Map<String, dynamic>) {
                  // Find the field in the section
                  for (int f = 0; f < fields.length; f++) {
                    final field = fields[f] as Map<String, dynamic>;
                    final currentFieldId = (field['id'] ?? '').toString();
                    
                    if (currentFieldId == fieldId) {
                      final fieldKey = '$sectionIndex|$f';
                      
                      // Load selected options
                      if (fieldValue['status'] != null) {
                        final status = fieldValue['status'].toString();
                        final options = (field['options'] as List<dynamic>?)
                            ?.map((e) => e.toString())
                            .toList() ?? [];
                        final optionIndex = options.indexOf(status);
                        if (optionIndex >= 0) {
                          _selectedOptionsByField[fieldKey] = {optionIndex};
                          debugPrint('✅ Loaded option for field $fieldId: $status (index: $optionIndex)');
                        }
                      }
                      
                      // Load text answers
                      if (fieldValue['comment'] != null) {
                        _fieldTextByKey[fieldKey] = fieldValue['comment'].toString();
                        debugPrint('✅ Loaded comment for field $fieldId: ${fieldValue['comment']}');
                      }
                      break;
                    }
                  }
                }
              });
            }
          }
        });
        
        // Set current section to next section from resume data
        // If nextSection is provided, use it; otherwise find first incomplete section
        final nextSection = resumeData['nextSection'] as String?;
        int targetSectionIndex = 0;
        
        if (nextSection != null) {
          // Use nextSection if provided
          final sectionIndex = _sections.indexWhere(
            (s) => (s['section'] as String?) == nextSection ||
                   (s['title'] as String?) == nextSection
          );
          if (sectionIndex >= 0) {
            targetSectionIndex = sectionIndex;
            debugPrint('✅ Set current section to nextSection: $nextSection (index: $sectionIndex)');
          }
        } else {
          // If nextSection is not provided, find first incomplete section
          // Get completed sections from resume data
          final completedSectionNames = <String>{};
          answers.forEach((sectionName, sectionData) {
            if (sectionName != 'metadata' && sectionName != 'remarks' && sectionName != 'signatures') {
              if (sectionData is Map<String, dynamic> && sectionData.isNotEmpty) {
                completedSectionNames.add(sectionName);
              }
            }
          });
          
          // Find first section that is not completed
          for (int i = 0; i < _sections.length; i++) {
            final section = _sections[i];
            final sectionName = (section['section'] as String?) ?? (section['title'] as String?);
            if (sectionName != null && !completedSectionNames.contains(sectionName)) {
              targetSectionIndex = i;
              debugPrint('✅ Set current section to first incomplete section: $sectionName (index: $i)');
              break;
            }
          }
        }
        
        setState(() {
          _currentSection = targetSectionIndex;
        });
        debugPrint('✅ Final current section index: $targetSectionIndex');
      }
    } catch (e) {
      debugPrint('❌ Error loading resume data: $e');
    }
  }
  

  // ===== DATA LOADING METHODS =====
  // Үзлэгийн мэдээлэл татах (scheduleType-ийг авах)
  Future<void> _loadInspectionInfo() async {
    try {
      final response = await InspectionAPI.getById(widget.inspectionId);
      if (response is Map<String, dynamic>) {
        final data = response['data'] ?? response['result'] ?? response;
        if (data is Map<String, dynamic>) {
          setState(() {
            _inspectionInfo = data;
          });
          debugPrint('✅ Inspection info loaded: ${data['scheduleType']}');
        }
      }
    } catch (e) {
      debugPrint('⚠️ Failed to load inspection info: $e');
      // Алдаа гарсан ч үргэлжлүүлнэ
    }
  }

  Future<void> _loadTemplate() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      // Use getInspectionTemplate to get the correct template for this inspection
      final dynamic resp = await InspectionAPI.getInspectionTemplate(widget.inspectionId);
      
      // Extract template from response
      Map<String, dynamic>? tpl;
      if (resp is Map<String, dynamic>) {
        final dynamic data = resp['data'];
        if (data is Map<String, dynamic>) {
          tpl = data['template'];
        }
      }
      
      final parsedSections = _extractSections(tpl);
      setState(() {
        _template = tpl;
        _sections = parsedSections;
        // Only set _currentSection to 0 if not resuming (resumeData will set it correctly)
        if (widget.resumeData == null) {
        _currentSection = 0;
        }
        _selectedOptionsByField.clear();
        _fieldTextByKey.clear();
        _fieldHasImageByKey.clear();
      });
      
      // Template load хийгдсэний дараа resume data load хийх
      if (widget.resumeData != null) {
        _loadResumeData();
      }
    } catch (e) {
      setState(() {
        _error = ErrorHandler.handleApiError(e);
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  // Device мэдээлэл татах
  Future<void> _loadDeviceInfo() async {
    try {
      debugPrint('=== LOADING DEVICE INFO FOR INSPECTION ===');
      debugPrint('Inspection ID: ${widget.inspectionId}');

      // Use inspection-specific endpoint that includes device info
      final response = await InspectionAPI.getDeviceDetails(
        widget.inspectionId,
      );

      if (response is Map<String, dynamic>) {
        final data = response['data'];
        if (data is Map<String, dynamic>) {
          final device = data['device'];
          if (device is Map<String, dynamic>) {
            setState(() {
              _deviceInfo = device;
            });
            debugPrint('✅ Found device for inspection: $device');
            return;
          }
        }
      }

      debugPrint(
        '⚠️ No device found for inspection ID: ${widget.inspectionId}',
      );
    } catch (e) {
      debugPrint('❌ Error loading device info: $e');
    }
  }

  // ===== TEMPLATE PROCESSING METHODS =====
  List<Map<String, dynamic>> _extractSections(Map<String, dynamic>? tpl) {
    if (tpl == null) return const [];
    final dynamic rawSections = tpl['questions'];
    
    // Handle case where questions might be a JSON string (backward compatibility)
    if (rawSections is String) {
      try {
        final parsed = jsonDecode(rawSections);
        if (parsed is List) {
          return _processSections(parsed);
        }
      } catch (e) {
        debugPrint('❌ Error parsing questions string: $e');
        return const [];
      }
    }
    
    if (rawSections is! List) return const [];
    return _processSections(rawSections);
  }

  List<Map<String, dynamic>> _processSections(List<dynamic> rawSections) {
    debugPrint('Raw sections count: ${rawSections.length}');

    return rawSections.map<Map<String, dynamic>>((sec) {
      if (sec is Map<String, dynamic>) {
        final String secTitle = (sec['title'] ?? '').toString();
        final String secSection = (sec['section'] ?? '').toString();
        final List<dynamic> fields = (sec['fields'] ?? []) as List<dynamic>;

        debugPrint(
          'Section: $secSection, Title: $secTitle, Fields count: ${fields.length}',
        );

        final List<Map<String, dynamic>>
        normalizedFields = fields.map<Map<String, dynamic>>((f) {
          if (f is Map<String, dynamic>) {
            final String qText = (f['question'] ?? f['title'] ?? '').toString();
            final List<dynamic> optionsDyn =
                (f['options'] ?? []) as List<dynamic>;
            final List<String> options = optionsDyn
                .map((e) => e.toString())
                .toList();
            final bool textRequired = (f['text_required'] ?? false) == true;
            final bool imageRequired = (f['image_required'] ?? false) == true;
            final String fieldId = (f['id'] ?? '').toString();
            return {
              'id': fieldId,
              'question': qText,
              'options': options,
              'text_required': textRequired,
              'image_required': imageRequired,
            };
          }
          return {
            'id': '',
            'question': f.toString(),
            'options': <String>[],
            'text_required': false,
            'image_required': false,
          };
        }).toList();
        return {
          'section': secSection,
          'title': secTitle,
          'fields': normalizedFields,
        };
      }
      return {
        'section': '',
        'title': sec.toString(),
        'fields': <Map<String, dynamic>>[],
      };
    }).toList();
  }

  // ===== UTILITY METHODS =====
  String _fieldKey(int sIdx, int fIdx) => '$sIdx|$fIdx';

  // ===== FORM HANDLING METHODS =====
  void _setSingleSelection(int sIdx, int fIdx, int optIdx) {
    final key = _fieldKey(sIdx, fIdx);
    setState(() {
      _selectedOptionsByField[key] = {optIdx};
    });
  }

  void _setFieldText(int sIdx, int fIdx, String text) {
    setState(() {
      _fieldTextByKey[_fieldKey(sIdx, fIdx)] = text;
    });
  }

  // ===== IMAGE HANDLING METHODS =====
  Future<void> _pickImageSource(int sIdx, int fIdx) async {
    final ImagePicker picker = ImagePicker();

    try {
      final XFile? picked = await showModalBottomSheet<XFile?>(
        context: context,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (ctx) {
          return SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: const Text(
                    'Зургийн эх үүсвэр сонгох',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                const Divider(height: 1),
                // Camera option
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined, size: 28),
                  title: const Text('Камер', style: TextStyle(fontSize: 16)),
                  subtitle: const Text('Камер ашиглан зураг авах'),
                  onTap: () async {
                    try {
                      Navigator.of(ctx).pop(); // Close bottom sheet first

                      // Check and request camera permission
                      final PermissionStatus cameraStatus =
                          await Permission.camera.status;
                      debugPrint('Camera permission status: $cameraStatus');

                      if (!cameraStatus.isGranted) {
                        // Request permission
                        final PermissionStatus requestResult = await Permission
                            .camera
                            .request();
                        debugPrint(
                          'Camera permission request result: $requestResult',
                        );

                        if (!requestResult.isGranted) {
                          if (!context.mounted) return;

                          // Show dialog to explain why permission is needed
                          await showDialog(
                            context: context,
                            builder: (dialogContext) => AlertDialog(
                              title: const Text('Камер эрх шаардлагатай'),
                              content: const Text(
                                'Зураг авахын тулд камер эрх шаардлагатай. '
                                'Тохиргоо дээр очиж эрх зөвшөөрнө үү.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () =>
                                      Navigator.of(dialogContext).pop(),
                                  child: const Text('Цуцлах'),
                                ),
                                TextButton(
                                  onPressed: () async {
                                    Navigator.of(dialogContext).pop();
                                    await openAppSettings();
                                  },
                                  child: const Text('Тохиргоо'),
                                ),
                              ],
                            ),
                          );
                          return;
                        }
                      }

                      // Permission granted, proceed with camera
                      final XFile? x = await picker.pickImage(
                        source: ImageSource.camera,
                        imageQuality: 85,
                        preferredCameraDevice: CameraDevice.rear,
                      );

                      if (x != null && context.mounted) {
                        // Wait a bit before processing to ensure file is ready
                        await Future.delayed(const Duration(milliseconds: 100));
                        _processPickedImage(sIdx, fIdx, x);
                      }
                    } catch (e) {
                      debugPrint('❌ Camera error: $e');
                      if (!context.mounted) return;

                      String errorMessage = 'Камер ашиглахад алдаа гарлаа';
                      if (e.toString().contains('camera_access_denied') ||
                          e.toString().contains('permission')) {
                        errorMessage =
                            'Камер эрх зөвшөөрөгдөөгүй. Тохиргоо дээр очиж эрх зөвшөөрнө үү.';
                      }

                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(errorMessage),
                          backgroundColor: Colors.red,
                          duration: const Duration(seconds: 4),
                          action: SnackBarAction(
                            label: 'Тохиргоо',
                            textColor: Colors.white,
                            onPressed: () async {
                              await openAppSettings();
                            },
                          ),
                        ),
                      );
                    }
                  },
                ),
                // Gallery option
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined, size: 28),
                  title: const Text(
                    'Зургийн сан',
                    style: TextStyle(fontSize: 16),
                  ),
                  subtitle: const Text('Зургийн сангаас зураг сонгох'),
                  onTap: () async {
                    try {
                      Navigator.of(ctx).pop(); // Close bottom sheet first

                      // Check and request photos permission (for Android 13+)
                      PermissionStatus photosStatus;
                      if (Platform.isAndroid) {
                        // Android 13+ uses READ_MEDIA_IMAGES
                        photosStatus = await Permission.photos.status;
                        if (!photosStatus.isGranted) {
                          photosStatus = await Permission.photos.request();
                        }

                        // Fallback for older Android versions
                        if (!photosStatus.isGranted) {
                          photosStatus = await Permission.storage.status;
                          if (!photosStatus.isGranted) {
                            photosStatus = await Permission.storage.request();
                          }
                        }
                      } else {
                        // iOS uses photos permission
                        photosStatus = await Permission.photos.status;
                        if (!photosStatus.isGranted) {
                          photosStatus = await Permission.photos.request();
                        }
                      }

                      if (!photosStatus.isGranted && !photosStatus.isLimited) {
                        if (!context.mounted) return;
                        await showDialog(
                          context: context,
                          builder: (dialogContext) => AlertDialog(
                            title: const Text('Зургийн сан эрх шаардлагатай'),
                            content: const Text(
                              'Зургийн сангаас зураг сонгохын тулд эрх шаардлагатай. '
                              'Тохиргоо дээр очиж эрх зөвшөөрнө үү.',
                            ),
                            actions: [
                              TextButton(
                                onPressed: () =>
                                    Navigator.of(dialogContext).pop(),
                                child: const Text('Цуцлах'),
                              ),
                              TextButton(
                                onPressed: () async {
                                  Navigator.of(dialogContext).pop();
                                  await openAppSettings();
                                },
                                child: const Text('Тохиргоо'),
                              ),
                            ],
                          ),
                        );
                        return;
                      }

                      final XFile? x = await picker.pickImage(
                        source: ImageSource.gallery,
                        imageQuality: 85,
                      );

                      if (x != null && context.mounted) {
                        await Future.delayed(const Duration(milliseconds: 100));
                        _processPickedImage(sIdx, fIdx, x);
                      }
                    } catch (e) {
                      debugPrint('❌ Gallery error: $e');
                      if (!context.mounted) return;

                      String errorMessage =
                          'Зургийн сангаас сонгоход алдаа гарлаа';
                      if (e.toString().contains('permission') ||
                          e.toString().contains('access_denied')) {
                        errorMessage =
                            'Зургийн сан эрх зөвшөөрөгдөөгүй. Тохиргоо дээр очиж эрх зөвшөөрнө үү.';
                      }

                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(errorMessage),
                          backgroundColor: Colors.red,
                          duration: const Duration(seconds: 4),
                          action: SnackBarAction(
                            label: 'Тохиргоо',
                            textColor: Colors.white,
                            onPressed: () async {
                              await openAppSettings();
                            },
                          ),
                        ),
                      );
                    }
                  },
                ),
                const SizedBox(height: 8),
              ],
            ),
          );
        },
      );

      // Handle if user cancelled from bottom sheet (before selecting source)
      if (picked != null) {
        await Future.delayed(const Duration(milliseconds: 100));
        _processPickedImage(sIdx, fIdx, picked);
      }
    } catch (e) {
      debugPrint('❌ Image picker error: $e');
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Зураг сонгоход алдаа гарлаа: ${e.toString()}'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  void _processPickedImage(int sIdx, int fIdx, XFile pickedFile) {
    try {
      final file = File(pickedFile.path);

      // Verify file exists
      if (!file.existsSync()) {
        debugPrint('❌ Image file does not exist: ${pickedFile.path}');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Зураг олдсонгүй. Дахин оролдоно уу.'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      // Check file size (limit to 10MB)
      final fileSize = file.lengthSync();
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (fileSize > maxSize) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Зургийн хэмжээ хэт том байна. 10MB-аас бага зураг сонгоно уу.',
            ),
            backgroundColor: Colors.orange,
            duration: Duration(seconds: 3),
          ),
        );
        return;
      }

      final key = _fieldKey(sIdx, fIdx);
      final existingList = _fieldImagesByKey[key] ?? <File>[];
      if (existingList.length >= 1) {
        if (mounted) {
          ErrorHandler.showError(
            context,
            'Энэ асуултад аль хэдийн зураг байна. Хуучин зургийг устгаад дахин оролдоно уу.',
          );
        }
        return;
      }

      int imageCount = 0;
      setState(() {
        final list = _fieldImagesByKey[key] ?? <File>[];
        list.add(file);
        _fieldImagesByKey[key] = list;
        _fieldHasImageByKey[key] = true;
        imageCount = list.length;
      });

      debugPrint('✅ Image added successfully: ${pickedFile.path}');
      debugPrint(
        '   File size: ${(fileSize / 1024 / 1024).toStringAsFixed(2)} MB',
      );

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Зураг нэмэгдлээ ($imageCount)'),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      debugPrint('❌ Error processing image: $e');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Зураг боловсруулахад алдаа гарлаа: ${e.toString()}'),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 3),
          ),
        );
      }
    }
  }

  void _removeImage(int sIdx, int fIdx, File file) {
    final key = _fieldKey(sIdx, fIdx);
    setState(() {
      final list = _fieldImagesByKey[key] ?? <File>[];
      list.remove(file);
      _fieldImagesByKey[key] = list;
      if (list.isEmpty) _fieldHasImageByKey[key] = false;
    });
  }

  // Upload all images for current section
  Future<void> _uploadSectionImages(
    String sectionName,
    String sectionTitle,
    String? answerId,
  ) async {
    if (answerId == null || answerId.isEmpty) {
      debugPrint('⚠️ Warning: answerId is null or empty, cannot upload images');
      return;
    }

    final section = _sections[_currentSection];
    final fields = (section['fields'] as List<dynamic>);
    final String sectionKey = sectionName.isNotEmpty
        ? sectionName
        : sectionTitle;

    for (int f = 0; f < fields.length; f++) {
      final field = fields[f] as Map<String, dynamic>;
      final String fieldId = (field['id'] ?? '').toString();
      final String questionText = (field['question'] ?? '').toString();
      final String key = _fieldKey(_currentSection, f);
      final List<File> images = _fieldImagesByKey[key] ?? <File>[];

      if (images.isNotEmpty) {
        try {
          debugPrint(
            '📸 Uploading ${images.length} image(s) for field: $fieldId with answerId: $answerId',
          );
          await InspectionAPI.uploadQuestionImages(
            inspectionId: widget.inspectionId,
            answerId: answerId,
            fieldId: fieldId,
            section: sectionKey,
            questionText: questionText,
            images: images,
          );
          debugPrint('✅ Images uploaded successfully for field: $fieldId');
        } catch (e, stackTrace) {
          debugPrint('❌ Error uploading images for field $fieldId: $e');
          debugPrint('Stack trace: $stackTrace');
          final friendlyMessage = ErrorHandler.handleApiError(e);
          if (context.mounted) {
            ErrorHandler.showError(
              context,
              'Зураг хадгалах үед алдаа гарлаа ($fieldId): $friendlyMessage',
            );
          }
          // Continue with other fields even if one fails
        }
      }
    }
  }

  // ===== UI BUILD METHODS =====
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Үзлэг эхлүүлэх'),
        bottom: _buildDeviceInfoHeader(),
      ),
      body: GestureDetector(
        onTap: () {
          // Keyboard-г хаах
          FocusScope.of(context).unfocus();
        },
        child: _buildBody(),
      ),
    );
  }

  PreferredSizeWidget? _buildDeviceInfoHeader() {
    // Device мэдээлэл харуулах header
    return PreferredSize(
      preferredSize: const Size.fromHeight(60),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.blue.withOpacity(0.1),
          border: Border(
            bottom: BorderSide(color: Colors.blue.withOpacity(0.3)),
          ),
        ),
        child: FutureBuilder<Map<String, dynamic>?>(
          future: _getDeviceInfoForHeader(),
          builder: (context, snapshot) {
            if (snapshot.hasData && snapshot.data != null) {
              final deviceInfo = snapshot.data!;
              String deviceText = '';

              // Model мэдээлэл
              if (deviceInfo['model'] is Map<String, dynamic>) {
                final model =
                    (deviceInfo['model'] as Map<String, dynamic>)['model']
                        ?.toString();
                if (model != null) deviceText += model;
              }

              // Location мэдээлэл
              final metadata = deviceInfo['metadata'];
              if (metadata != null) {
                String? location;
                if (metadata is String) {
                  try {
                    final metadataMap =
                        jsonDecode(metadata) as Map<String, dynamic>;
                    location = metadataMap['location']?.toString();
                  } catch (e) {
                    // Ignore parse error
                  }
                } else if (metadata is Map<String, dynamic>) {
                  location = metadata['location']?.toString();
                }

                if (location != null && location.isNotEmpty) {
                  if (deviceText.isNotEmpty) deviceText += ' • ';
                  deviceText += location;
                }
              }

              return Row(
                children: [
                  Icon(Icons.devices, color: Colors.blue[700], size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      deviceText.isNotEmpty
                          ? deviceText
                          : 'Төхөөрөмжийн мэдээлэл',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: Colors.blue[700],
                      ),
                    ),
                  ),
                ],
              );
            }

            return Row(
              children: [
                Icon(Icons.devices, color: Colors.grey[600], size: 20),
                const SizedBox(width: 8),
                Text(
                  'Төхөөрөмжийн мэдээлэл ачаалж байна...',
                  style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Future<Map<String, dynamic>?> _getDeviceInfoForHeader() async {
    try {
      // Use the already loaded device info or fetch it
      if (_deviceInfo != null) {
        return _deviceInfo;
      }

      // Fetch from inspection-specific endpoint
      final response = await InspectionAPI.getDeviceDetails(
        widget.inspectionId,
      );
      if (response is Map<String, dynamic>) {
        final data = response['data'];
        if (data is Map<String, dynamic>) {
          final device = data['device'];
          if (device is Map<String, dynamic>) {
            return device;
          }
        }
      }
    } catch (e) {
      debugPrint('Error getting device info for header: $e');
    }

    return null;
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _error,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.redAccent),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: _loadTemplate,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }
    if (_template == null || _sections.isEmpty) {
      return const Center(child: Text('Идэвхтэй үзлэгийн загвар олдсонгүй.'));
    }

    // Show verification screen if all sections are completed
    debugPrint(
      '_showVerification: $_showVerification, _showSectionReview: $_showSectionReview, _totalSections: $_totalSections, _currentSection: $_currentSection',
    );
    if (_showVerification) {
      debugPrint('Showing verification screen');
      return _buildVerificationScreen();
    }

    // Dynamic section bounds checking
    if (_currentSection >= _totalSections) {
      debugPrint('All sections completed, showing verification screen');
      setState(() {
        _showVerification = true;
      });
      return _buildVerificationScreen();
    }

    // Show section review if current section is completed
    if (_showSectionReview && _currentSectionAnswers != null) {
      debugPrint('Showing section review');
      return _buildSectionReviewScreen();
    }

    // Үзлэгийн төрөл (scheduleType) харуулах - зөвхөн scheduleType-аас хамаарч харуулах
    String templateName = 'Үзлэг';

    // Эхлээд inspectionInfo-аас scheduleType-ийг шалгах
    if (_inspectionInfo != null) {
      final scheduleType = _inspectionInfo!['scheduleType']
          ?.toString()
          .toUpperCase();
      debugPrint('🔍 ScheduleType from inspectionInfo: $scheduleType');
      if (scheduleType == 'DAILY') {
        templateName = 'Өдөр тутмын үзлэг, шалгалт';
      } else if (scheduleType == 'SCHEDULED') {
        templateName = 'Хугацаат үзлэг';
      }
    }


    // Хэрэв scheduleType олдохгүй бол зөвхөн "Үзлэг" гэж харуулах
    // Description эсвэл бусад fallback ашиглахгүй

    final Map<String, dynamic> section = _sections[_currentSection];
    final String sectionTitle = (section['title'] ?? '').toString();
    final String sectionName = (section['section'] ?? '').toString();
    final List<dynamic> fields = (section['fields'] as List<dynamic>);

    debugPrint('Current section: $_currentSection/$_totalSections');
    debugPrint('Section name: $sectionName, Title: $sectionTitle');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            templateName,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
        ),
        // Section progress indicator
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(
            children: [
              Text(
                'Хэсэг ${_currentSection + 1}/$_totalSections',
                style: const TextStyle(fontSize: 14, color: Colors.grey),
              ),
              const Spacer(),
              Text(
                '${((_currentSection + 1) / _totalSections * 100).round()}%',
                style: const TextStyle(fontSize: 14, color: Colors.grey),
              ),
            ],
          ),
        ),
        if (sectionTitle.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              sectionTitle,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
          ),
        const Divider(height: 1),
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(16.0),
            itemCount: fields.length,
            itemBuilder: (context, fIdx) {
              final Map<String, dynamic> field =
                  fields[fIdx] as Map<String, dynamic>;
              final String qText = (field['question'] ?? '').toString();
              final List<dynamic> options = (field['options'] as List<dynamic>);
              final String fKey = _fieldKey(_currentSection, fIdx);
              final Set<int> selected =
                  _selectedOptionsByField[fKey] ?? <int>{};
              final String textValue = _fieldTextByKey[fKey] ?? '';

              // Get or create GlobalKey for this field
              if (!_fieldKeys.containsKey(fKey)) {
                _fieldKeys[fKey] = GlobalKey();
              }
              final GlobalKey fieldKey = _fieldKeys[fKey]!;

              // Check if this field should be highlighted (invalid field)
              final bool isHighlighted = _highlightedFieldKey == fKey;

              return Padding(
                key: fieldKey,
                padding: const EdgeInsets.only(bottom: 12.0),
                child: Card(
                  color: AppColors.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: isHighlighted
                        ? const BorderSide(color: Colors.red, width: 2)
                        : BorderSide.none,
                  ),
                  elevation: isHighlighted ? 4 : 0,
                  child: Padding(
                    padding: const EdgeInsets.all(12.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          qText,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 8),
                        for (int oIdx = 0; oIdx < options.length; oIdx++)
                          RadioListTile<int>(
                            value: oIdx,
                            groupValue: selected.isEmpty
                                ? null
                                : selected.first,
                            onChanged: (val) {
                              if (val == null) return;
                              _setSingleSelection(_currentSection, fIdx, val);
                            },
                            title: Text(options[oIdx].toString()),
                            contentPadding: EdgeInsets.zero,
                          ),
                        // Show text field if answer is not "Зүгээр", "Цэвэр", or "Хэвийн"
                        if (_shouldShowTextField(selected, options))
                          Padding(
                            padding: const EdgeInsets.only(top: 8.0),
                            child: TextField(
                              decoration: const InputDecoration(
                                labelText: 'Тайлбар',
                                border: OutlineInputBorder(),
                              ),
                              onChanged: (v) =>
                                  _setFieldText(_currentSection, fIdx, v),
                              controller: TextEditingController.fromValue(
                                TextEditingValue(
                                  text: textValue,
                                  selection: TextSelection.collapsed(
                                    offset: textValue.length,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        // Show image field if answer is not "Зүгээр", "Цэвэр", or "Хэвийн"
                        if (_shouldShowImageField(selected, options))
                          Padding(
                            padding: const EdgeInsets.only(top: 8.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    for (final file
                                        in _fieldImagesByKey[fKey] ??
                                            const <File>[])
                                      Stack(
                                        children: [
                                          ClipRRect(
                                            borderRadius: BorderRadius.circular(
                                              8,
                                            ),
                                            child: Image.file(
                                              file,
                                              width: 72,
                                              height: 72,
                                              fit: BoxFit.cover,
                                            ),
                                          ),
                                          Positioned(
                                            right: 0,
                                            top: 0,
                                            child: InkWell(
                                              onTap: () => _removeImage(
                                                _currentSection,
                                                fIdx,
                                                file,
                                              ),
                                              child: Container(
                                                decoration: BoxDecoration(
                                                  color: Colors.black54,
                                                  borderRadius:
                                                      BorderRadius.circular(10),
                                                ),
                                                padding: const EdgeInsets.all(
                                                  2,
                                                ),
                                                child: const Icon(
                                                  Icons.close,
                                                  size: 14,
                                                  color: Colors.white,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                OutlinedButton.icon(
                                  onPressed: () =>
                                      _pickImageSource(_currentSection, fIdx),
                                  icon: const Icon(Icons.add_a_photo_outlined),
                                  label: Text(
                                    (_fieldImagesByKey[fKey]?.length ?? 0) >= 1
                                        ? 'Зураг солих'
                                        : 'Зураг оруулах',
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 46),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _currentSection == 0
                      ? null
                      : () {
                          setState(() {
                            _currentSection -= 1;
                            // Scroll to top when going back
                            _scrollController.animateTo(
                              0,
                              duration: const Duration(milliseconds: 300),
                              curve: Curves.easeInOut,
                            );
                          });
                        },
                  child: const Text('Өмнөх'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: () async {
                    if (!_validateSection(_currentSection)) {
                      // Scroll to first invalid field instead of showing SnackBar
                      _scrollToFirstInvalidField(_currentSection);
                      return;
                    }

                    // Show section review (backend submission will happen in review screen)
                    _displaySectionReview();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.black,
                  ),
                  child: Text(
                    _currentSection >= (_totalSections - 1)
                        ? 'Дуусгах'
                        : 'Дараах',
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  int get _totalSections => _sections.length;

  // ===== DYNAMIC FIELD DISPLAY METHODS =====

  /// Check if text field should be shown based on selected answer
  /// Ямар ч сонголт хийх үед зураг болон тайлбар бичих хэсгийг харуулах
  /// "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг болон тайлбар бичих шаардлагагүй
  bool _shouldShowTextField(Set<int> selected, List<dynamic> options) {
    if (selected.isEmpty) return false;

    // Ямар ч сонголт хийх үед тайлбар бичих хэсгийг харуулах
    return true;
  }

  /// Check if image field should be shown based on selected answer
  /// Ямар ч сонголт хийх үед зураг болон тайлбар бичих хэсгийг харуулах
  /// "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг болон тайлбар бичих шаардлагагүй
  bool _shouldShowImageField(Set<int> selected, List<dynamic> options) {
    if (selected.isEmpty) return false;

    // Ямар ч сонголт хийх үед зураг оруулах хэсгийг харуулах
    return true;
  }
  
  /// Check if text field is required based on selected answer
  /// "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал тайлбар бичих шаардлагагүй
  /// Бусад сонголтуудыг хийхэд заавал тайлбар оруулах шаардлагатай
  bool _isTextFieldRequired(Set<int> selected, List<dynamic> options) {
    if (selected.isEmpty) return false;

    final selectedOption = options[selected.first].toString().trim();
    // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал тайлбар бичих шаардлагагүй
    return selectedOption != 'Хэвийн' && selectedOption != 'Цэвэр';
  }
  
  /// Check if image field is required based on selected answer
  /// "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг оруулах шаардлагагүй
  /// Бусад сонголтуудыг хийхэд заавал зураг оруулах шаардлагатай
  bool _isImageFieldRequired(Set<int> selected, List<dynamic> options) {
    if (selected.isEmpty) return false;

    final selectedOption = options[selected.first].toString().trim();
    // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг оруулах шаардлагагүй
    return selectedOption != 'Хэвийн' && selectedOption != 'Цэвэр';
  }

  // ===== VALIDATION METHODS =====
  bool _validateSection(int sIdx) {
    final section = _sections[sIdx];
    final fields = (section['fields'] as List<dynamic>);
    for (int f = 0; f < fields.length; f++) {
      final field = fields[f] as Map<String, dynamic>;
      final String key = _fieldKey(sIdx, f);
      final List<dynamic> options = (field['options'] as List<dynamic>);
      final selected = _selectedOptionsByField[key] ?? <int>{};

      if (selected.isEmpty) return false;

      // Check if text is required based on selected answer
      // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал тайлбар бичих шаардлагагүй
      if (_isTextFieldRequired(selected, options)) {
        final txt = (_fieldTextByKey[key] ?? '').trim();
        if (txt.isEmpty) return false;
      }

      // Check if image is required based on selected answer
      // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг оруулах шаардлагагүй
      if (_isImageFieldRequired(selected, options)) {
        final imgs = _fieldImagesByKey[key] ?? const <File>[];
        if (imgs.isEmpty) return false;
      }
    }
    return true;
  }

  /// Find the first invalid field index in the current section
  /// Returns -1 if all fields are valid
  int _findFirstInvalidFieldIndex(int sIdx) {
    final section = _sections[sIdx];
    final fields = (section['fields'] as List<dynamic>);
    for (int f = 0; f < fields.length; f++) {
      final field = fields[f] as Map<String, dynamic>;
      final String key = _fieldKey(sIdx, f);
      final List<dynamic> options = (field['options'] as List<dynamic>);
      final selected = _selectedOptionsByField[key] ?? <int>{};

      if (selected.isEmpty) return f;

      // Check if text is required based on selected answer
      // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал тайлбар бичих шаардлагагүй
      if (_isTextFieldRequired(selected, options)) {
        final txt = (_fieldTextByKey[key] ?? '').trim();
        if (txt.isEmpty) return f;
      }

      // Check if image is required based on selected answer
      // "Хэвийн" болон "Цэвэр" хэсгийг сонгох үед заавал зураг оруулах шаардлагагүй
      if (_isImageFieldRequired(selected, options)) {
        final imgs = _fieldImagesByKey[key] ?? const <File>[];
        if (imgs.isEmpty) return f;
      }
    }
    return -1; // All fields are valid
  }

  /// Scroll to the first invalid field in the current section
  void _scrollToFirstInvalidField(int sIdx) {
    final invalidFieldIndex = _findFirstInvalidFieldIndex(sIdx);
    if (invalidFieldIndex == -1) {
      debugPrint('No invalid field found in section $sIdx');
      setState(() {
        _highlightedFieldKey = null;
      });
      return;
    }

    debugPrint(
      'Scrolling to invalid field: section $sIdx, field $invalidFieldIndex',
    );
    final String fieldKey = _fieldKey(sIdx, invalidFieldIndex);

    // Highlight the invalid field
    setState(() {
      _highlightedFieldKey = fieldKey;
    });

    // Remove highlight after 3 seconds
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) {
        setState(() {
          _highlightedFieldKey = null;
        });
      }
    });

    // Ensure the key exists
    if (!_fieldKeys.containsKey(fieldKey)) {
      debugPrint('Creating GlobalKey for field: $fieldKey');
      _fieldKeys[fieldKey] = GlobalKey();
    }

    final GlobalKey key = _fieldKeys[fieldKey]!;

    // Wait for the widget to be built and rendered
    // Use multiple post frame callbacks to ensure the widget is ready
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Wait one more frame to ensure the widget is fully rendered
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _performScroll(key, fieldKey, sIdx);
      });
    });
  }

  /// Perform the actual scroll operation
  /// [retryCount] tracks retry attempts to prevent infinite loops
  void _performScroll(
    GlobalKey key,
    String fieldKey,
    int sIdx, {
    int retryCount = 0,
  }) {
    const int maxRetries = 3;

    final BuildContext? context = key.currentContext;

    // If context is null, the widget is not rendered yet (likely far away)
    // First scroll to approximate position, then retry
    if (context == null) {
      if (retryCount >= maxRetries) {
        debugPrint(
          '❌ Max retries reached for field: $fieldKey, using fallback scroll',
        );
        // Final fallback: scroll to approximate position and stay there
        _scrollToApproximatePosition(sIdx, fieldKey);
        return;
      }

      debugPrint(
        'Warning: BuildContext is null for field: $fieldKey (retry $retryCount/$maxRetries), scrolling to approximate position first...',
      );
      _scrollToApproximatePosition(sIdx, fieldKey);

      // Wait for scroll animation to complete and widget to render
      // Scroll animation takes 500ms, so wait a bit longer
      Future.delayed(const Duration(milliseconds: 700), () {
        if (mounted) {
          // Wait for next frame to ensure widget is rendered
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              // Retry with incremented retry count
              _performScroll(key, fieldKey, sIdx, retryCount: retryCount + 1);
            }
          });
        }
      });
      return;
    }

    debugPrint('Scrolling to field: $fieldKey');

    // Method 1: Use Scrollable.ensureVisible (most reliable for ListView.builder)
    try {
      Scrollable.ensureVisible(
        context,
        duration: const Duration(milliseconds: 700),
        curve: Curves.easeInOut,
        alignment: 0.1, // Scroll to show field near the top (10% from top)
        alignmentPolicy:
            ScrollPositionAlignmentPolicy.explicit, // Always scroll
      );
      debugPrint('✅ Successfully scrolled using ensureVisible: $fieldKey');
      return;
    } catch (e) {
      debugPrint('⚠️ Scrollable.ensureVisible failed: $e');
    }

    // Method 2: Use ScrollController with RenderBox and proper coordinate calculation
    if (_scrollController.hasClients) {
      try {
        final RenderBox? renderBox = context.findRenderObject() as RenderBox?;
        if (renderBox != null) {
          // Get the position of the field relative to the screen
          final Offset globalPosition = renderBox.localToGlobal(Offset.zero);

          // Get the ListView's RenderBox to calculate relative position
          final RenderObject? listViewRenderObject = _scrollController
              .position
              .context
              .storageContext
              .findRenderObject();
          if (listViewRenderObject is RenderBox) {
            final Offset listViewGlobalPosition = listViewRenderObject
                .localToGlobal(Offset.zero);

            // Calculate the field's position relative to the ListView
            final double fieldTopRelativeToListView =
                globalPosition.dy - listViewGlobalPosition.dy;

            // Current scroll offset
            final double currentScrollOffset = _scrollController.offset;

            // Calculate target scroll position
            // We want the field to be 100px from the top of the viewport
            final double targetScrollPosition =
                currentScrollOffset + fieldTopRelativeToListView - 100;

            debugPrint(
              'Scroll calculation: globalPos=${globalPosition.dy}, listViewPos=${listViewGlobalPosition.dy}, relative=$fieldTopRelativeToListView, current=$currentScrollOffset, target=$targetScrollPosition',
            );

            _scrollController.animateTo(
              targetScrollPosition.clamp(
                0.0,
                _scrollController.position.maxScrollExtent,
              ),
              duration: const Duration(milliseconds: 700),
              curve: Curves.easeInOut,
            );
            debugPrint(
              '✅ Successfully scrolled using RenderBox calculation: $fieldKey',
            );
            return;
          }
        }
      } catch (e2) {
        debugPrint('❌ Error using RenderBox calculation: $e2');
      }
    }

    debugPrint('❌ All scroll methods failed for field: $fieldKey');
  }

  /// Scroll to approximate position based on field index
  /// This ensures the widget is rendered even if it's far away
  void _scrollToApproximatePosition(int sIdx, String fieldKey) {
    if (!_scrollController.hasClients) {
      debugPrint('⚠️ ScrollController has no clients');
      return;
    }

    try {
      // Extract field index from fieldKey (format: "sectionIndex|fieldIndex")
      final parts = fieldKey.split('|');
      if (parts.length != 2) {
        debugPrint('⚠️ Invalid fieldKey format: $fieldKey');
        return;
      }

      final int invalidFieldIndex = int.tryParse(parts[1]) ?? -1;
      if (invalidFieldIndex < 0) {
        debugPrint('⚠️ Invalid field index: ${parts[1]}');
        return;
      }

      // Calculate scroll position based on field index with improved height estimation
      const double padding = 16.0; // ListView padding
      const double fieldPadding =
          12.0; // Padding between fields (bottom padding of Card)
      const double questionHeight =
          35.0; // Question text height (with some margin)
      const double optionHeight = 48.0; // Height per option (RadioListTile)
      const double cardPadding = 24.0; // Card padding (top + bottom = 12*2)
      const double textFieldHeight = 88.0; // TextField with label and padding
      const double imageFieldHeight =
          140.0; // Image field with button and padding

      // Estimate total height for each field up to the invalid one
      double totalHeight = padding; // Start with ListView padding

      final section = _sections[sIdx];
      final fields = (section['fields'] as List<dynamic>);

      for (int i = 0; i < invalidFieldIndex && i < fields.length; i++) {
        final field = fields[i] as Map<String, dynamic>;
        final String fKey = _fieldKey(sIdx, i);
        final Set<int> selected = _selectedOptionsByField[fKey] ?? <int>{};
        final List<dynamic> options = (field['options'] as List<dynamic>);

        // Base height: question + card padding
        double fieldHeight = questionHeight + cardPadding;

        // Add height for each option (RadioListTile)
        // Each option takes about 48px, plus spacing
        fieldHeight += options.length * optionHeight;

        // Add spacing between question and options
        if (options.isNotEmpty) {
          fieldHeight += 8.0; // SizedBox height between question and options
        }

        // Add height if text field is shown
        if (_shouldShowTextField(selected, options)) {
          fieldHeight += textFieldHeight;
        }

        // Add height if image field is shown
        if (_shouldShowImageField(selected, options)) {
          fieldHeight += imageFieldHeight;
        }

        // Add field padding (spacing between cards)
        totalHeight += fieldHeight + fieldPadding;
      }

      // Scroll to slightly before the field to ensure it's fully visible
      // Subtract a small amount to account for viewport positioning
      totalHeight = (totalHeight - 100).clamp(0.0, double.infinity);

      debugPrint(
        'Calculated approximate scroll position: $totalHeight (field index: $invalidFieldIndex)',
      );

      // Scroll to approximate position first
      _scrollController.animateTo(
        totalHeight.clamp(0.0, _scrollController.position.maxScrollExtent),
        duration: const Duration(milliseconds: 500),
        curve: Curves.easeInOut,
      );

      debugPrint('✅ Scrolled to approximate position');
    } catch (e) {
      debugPrint('❌ Error calculating approximate scroll position: $e');
    }
  }

  // ===== SECTION MANAGEMENT METHODS =====

  // Navigation methods

  void _onFinish() {
    debugPrint('=== _onFinish() called ===');
    debugPrint(
      'Current section: $_currentSection, Total sections: $_totalSections',
    );

    if (_currentSection >= (_totalSections - 1)) {
      // Last section - show verification screen
      debugPrint('Last section completed, showing verification screen');
      setState(() {
        _showVerification = true;
        _showSectionReview = false;
        _currentSectionAnswers = null;
      });
    } else {
      // Move to next section
      debugPrint('Moving to next section: ${_currentSection + 1}');
      setState(() {
        _currentSection++;
        _showSectionReview = false;
        _currentSectionAnswers = null;
        _highlightedFieldKey =
            null; // Clear highlight when moving to next section
        // Don't clear field keys immediately - wait until after scroll
        // This ensures keys are available for scrolling if validation fails
      });

      // Scroll to top of new section after widget rebuild
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.jumpTo(0);
        }
        // Clear field keys for previous section after scroll
        _clearFieldKeysForSection(_currentSection - 1);
      });
    }
  }

  /// Clear field keys for a specific section to free memory
  void _clearFieldKeysForSection(int sIdx) {
    final keysToRemove = <String>[];
    for (final key in _fieldKeys.keys) {
      if (key.startsWith('$sIdx|')) {
        keysToRemove.add(key);
      }
    }
    for (final key in keysToRemove) {
      _fieldKeys.remove(key);
    }
  }

  void _displaySectionReview() {
    setState(() {
      _showSectionReview = true;
      final section = _sections[_currentSection];
      final String sectionTitle = (section['title'] ?? '').toString();
      final String sectionName = (section['section'] ?? '').toString();

      _currentSectionAnswers = AnswerService.prepareSectionAnswers(
        section: section,
        sectionName: sectionName,
        sectionTitle: sectionTitle,
        selectedOptionsByField: _selectedOptionsByField,
        fieldTextByKey: _fieldTextByKey,
        fieldKey: _fieldKey,
        currentSection: _currentSection,
      );
    });
  }

  // ===== UI HELPER METHODS =====
  Widget _buildSectionReviewScreen() {
    if (_currentSectionAnswers == null) {
      return const Center(child: Text('Хэсэг хариулт олдсонгүй'));
    }

    final String sectionTitle = _currentSectionAnswers!['sectionTitle'] ?? '';
    final Map<String, dynamic> answersMap =
        _currentSectionAnswers!['answers'] as Map<String, dynamic>;

    debugPrint('=== SECTION REVIEW DEBUG ===');
    debugPrint('Section Title: $sectionTitle');
    debugPrint('Answers Map: $answersMap');
    debugPrint('Answers Map Keys: ${answersMap.keys.toList()}');
    answersMap.forEach((key, value) {
      debugPrint('Field $key: $value');
    });
    debugPrint('===========================');

    // Convert Map to List for UI display
    final List<Map<String, dynamic>> answers = answersMap.entries.map((entry) {
      return {
        'fieldId': entry.key,
        'question': entry.value['question'] ?? '',
        'status': entry.value['status'],
        'comment': entry.value['comment'],
      };
    }).toList();

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 20),
          Icon(Icons.check_circle_outline, size: 80, color: AppColors.primary),
          const SizedBox(height: 20),
          Text(
            'Хэсэг дууссан',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Text(
            sectionTitle,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 20),
          Text(
            'Таны бөглөсөн хариултууд:',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.builder(
              itemCount: answers.length,
              itemBuilder: (context, index) {
                final answer = answers[index];
                final String question = answer['question'] ?? '';
                final String status = answer['status'] ?? '';
                final String comment = answer['comment'] ?? '';

                return Padding(
                  padding: const EdgeInsets.only(bottom: 12.0),
                  child: Card(
                    color: AppColors.surface,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            question.isNotEmpty
                                ? question
                                : 'Асуулт тодорхойлогдоогүй',
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: AppColors.primary.withOpacity(0.3),
                              ),
                            ),
                            child: Text(
                              'Төлөв: $status',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.primary,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          if (comment.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.blue[50],
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: Colors.blue[200]!),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.note_alt_outlined,
                                    size: 16,
                                    color: Colors.blue[600],
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Тайлбар: $comment',
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: Colors.blue[800],
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 46),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      setState(() {
                        _showSectionReview = false;
                        _currentSectionAnswers = null;
                      });
                    },
                    child: const Text('Өмнөх'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isSavingSection
                        ? null
                        : () async {
                            if (_isSavingSection) return;
                            setState(() {
                              _isSavingSection = true;
                            });

                            final section = _sections[_currentSection];
                            final sectionTitle = (section['title'] ?? '')
                                .toString();
                            final sectionName = (section['section'] ?? '')
                                .toString();

                            bool saveSucceeded = false;

                            try {
                              // Эхлээд хариулт хадгалах (answerId авахын тулд)
                              final resp = await AnswerService.saveCurrentSection(
                                inspectionId: widget.inspectionId,
                                section: section,
                                sectionName: sectionName,
                                sectionTitle: sectionTitle,
                                selectedOptionsByField: _selectedOptionsByField,
                                fieldTextByKey: _fieldTextByKey,
                                fieldKey: _fieldKey,
                                currentSection: _currentSection,
                                totalSections: _totalSections,
                                answerId:
                                    _answerId, // Metadata-аас ирсэн answerId ашиглах
                                deviceInfo: _deviceInfo,
                              );

                              // Section хариулт хадгалагдсаны дараа answerId шинэчлэх
                              String? currentAnswerId = _answerId;
                              try {
                                final dynamic data =
                                    (resp is Map<String, dynamic>)
                                    ? (resp['data'] ?? resp)
                                    : resp;
                                if (data is Map<String, dynamic>) {
                                  final String? returnedId =
                                      (data['answerId'] ??
                                              data['id'] ??
                                              data['_id'])
                                          ?.toString();
                                  if (returnedId != null &&
                                      returnedId.isNotEmpty) {
                                    currentAnswerId = returnedId;
                                    setState(() => _answerId = returnedId);
                                  }
                                }
                              } catch (_) {}

                              // Дараа нь зураг илгээх (хэрэв байвал, answerId-тэй)
                              if (currentAnswerId != null &&
                                  currentAnswerId.isNotEmpty) {
                                await _uploadSectionImages(
                                  sectionName,
                                  sectionTitle,
                                  currentAnswerId,
                                );
                              } else {
                                debugPrint(
                                  '⚠️ Warning: answerId is not available, skipping image upload',
                                );
                              }

                              saveSucceeded = true;
                            } catch (e) {
                              if (!mounted) return;
                              ErrorHandler.showError(context, ErrorHandler.handleApiError(e));
                            } finally {
                              if (mounted) {
                                setState(() {
                                  _isSavingSection = false;
                                });
                              }
                            }

                            if (!saveSucceeded || !mounted) return;

                            setState(() {
                              _showSectionReview = false;
                              _currentSectionAnswers = null;
                            });

                            _onFinish();
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _isSavingSection
                          ? Colors.grey.shade400
                          : AppColors.primary,
                      foregroundColor: Colors.black,
                      disabledBackgroundColor: Colors.grey.shade300,
                      disabledForegroundColor: Colors.black54,
                    ),
                    child: _isSavingSection
                        ? Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const SizedBox(
                                height: 18,
                                width: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    Colors.black,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                _currentSection >= (_totalSections - 1)
                                    ? 'Дуусгаж байна...'
                                    : 'Дараах...',
                              ),
                            ],
                          )
                        : Text(
                            _currentSection >= (_totalSections - 1)
                                ? 'Дуусгах'
                                : 'Дараах',
                          ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerificationScreen() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 20),
          Icon(
            Icons.verified_user_outlined,
            size: 80,
            color: AppColors.primary,
          ),
          const SizedBox(height: 20),
          Text(
            'Баталгаажуулах',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Text(
            'Таны бөглөсөн бүх хариултууд зөв эсэхийг шалгана уу. Баталгаажуулсны дараа үзлэг автоматаар илгээгдэх болно.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 16, color: Colors.grey),
          ),
          const SizedBox(height: 30),
          Card(
            color: AppColors.surface,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Үзлэгийн мэдээлэл:',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  _buildInfoRow('Нийт хэсэг:', '$_totalSections'),
                  _buildInfoRow('Бөглөгдсөн хэсэг:', '$_totalSections'),
                  _buildInfoRow('Дуусах хувь:', '100%'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Бүх хариултууд:',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildAllAnswersReview(),
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 46),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      setState(() {
                        _showVerification = false;
                      });
                    },
                    child: const Text('Өмнөх'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      // Navigate to conclusion page with inspection ID
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              ConclusionPage(inspectionId: widget.inspectionId),
                        ),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.black,
                    ),
                    child: const Text('Дүгнэлт бичих'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAllAnswersReview() {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _sections.length,
      itemBuilder: (context, sectionIndex) {
        final section = _sections[sectionIndex];
        final String sectionTitle = (section['title'] ?? '').toString();
        final List<dynamic> fields = (section['fields'] as List<dynamic>);

        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${sectionIndex + 1}. $sectionTitle',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 12),
                ...fields.asMap().entries.map((fieldEntry) {
                  final int fieldIndex = fieldEntry.key;
                  final Map<String, dynamic> field = fieldEntry.value;
                  final String question = (field['question'] ?? '').toString();
                  final List<String> options =
                      (field['options'] as List<dynamic>)
                          .map((e) => e.toString())
                          .toList();
                  final String key = _fieldKey(sectionIndex, fieldIndex);
                  final Set<int> selectedIdx =
                      _selectedOptionsByField[key] ?? <int>{};
                  final List<String> selectedOptions = selectedIdx
                      .map((i) => options[i])
                      .toList();
                  final String text = (_fieldTextByKey[key] ?? '').trim();
                  final List<File> images = _fieldImagesByKey[key] ?? <File>[];

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12.0),
                    child: Card(
                      color: AppColors.surface,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(12.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              question,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            if (selectedOptions.isNotEmpty)
                              Wrap(
                                spacing: 8,
                                runSpacing: 4,
                                children: selectedOptions.map((option) {
                                  return Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 6,
                                    ),
                                    decoration: BoxDecoration(
                                      color: AppColors.primary.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(
                                        color: AppColors.primary.withOpacity(
                                          0.3,
                                        ),
                                      ),
                                    ),
                                    child: Text(
                                      option,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.primary,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            if (text.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.blue[50],
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.blue[200]!),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.note_alt_outlined,
                                      size: 16,
                                      color: Colors.blue[600],
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        text,
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: Colors.blue[800],
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                            if (images.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.green[50],
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.green[200]!),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.photo_library_outlined,
                                      size: 16,
                                      color: Colors.green[600],
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Зураг: ${images.length} ширхэг',
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: Colors.green[800],
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 14)),
          Text(
            value,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
