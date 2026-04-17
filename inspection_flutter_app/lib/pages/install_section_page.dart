import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/install_field_list_page.dart';
import 'package:app/pages/install_act_page.dart';

class InstallSectionPage extends StatefulWidget {
  final Map<String, dynamic> template;
  final String? assignmentId; // Assignment ID for saving data
  final String? orgId; // Organization ID
  final String? title; // Title (пүү-1, пүү-2, etc.)

  const InstallSectionPage({
    super.key,
    required this.template,
    this.assignmentId,
    this.orgId,
    this.title,
  });

  @override
  State<InstallSectionPage> createState() => _InstallSectionPageState();
}

class _InstallSectionPageState extends State<InstallSectionPage> {
  List<Map<String, dynamic>> _sections = [];

  @override
  void initState() {
    super.initState();
    _parseSections();
  }

  void _parseSections() {
    try {
      debugPrint('=== PARSING SECTIONS FROM TEMPLATE ===');
      debugPrint('Template keys: ${widget.template.keys}');
      debugPrint('Template: ${widget.template}');
      
      final questions = widget.template['questions'];
      debugPrint('Questions type: ${questions.runtimeType}');
      debugPrint('Questions: $questions');
      
      List<Map<String, dynamic>> sections = [];

      if (questions is String) {
        debugPrint('Questions is String, parsing JSON...');
        final parsed = jsonDecode(questions);
        debugPrint('Parsed type: ${parsed.runtimeType}');
        debugPrint('Parsed: $parsed');
        if (parsed is List) {
          sections = parsed.cast<Map<String, dynamic>>();
        } else if (parsed is Map) {
          // If parsed is a Map, try to get sections from it
          final sectionsData = parsed['sections'] ?? parsed['data'];
          if (sectionsData is List) {
            sections = sectionsData.cast<Map<String, dynamic>>();
          }
        }
      } else if (questions is List) {
        debugPrint('Questions is List, using directly...');
        sections = questions.cast<Map<String, dynamic>>();
      } else if (questions is Map) {
        debugPrint('Questions is Map, extracting sections...');
        final sectionsData = questions['sections'] ?? questions['data'];
        if (sectionsData is List) {
          sections = sectionsData.cast<Map<String, dynamic>>();
        }
      }

      debugPrint('Parsed ${sections.length} sections from template');
      for (var section in sections) {
        debugPrint('  - Section: ${section['title']} (${section['fields']?.length ?? 0} fields)');
      }

      setState(() {
        _sections = sections;
      });
    } catch (e) {
      debugPrint('Error parsing sections: $e');
      debugPrint('Error stack: ${StackTrace.current}');
    }
  }

  void _onSectionTap(Map<String, dynamic> section) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InstallFieldListPage(
          section: section,
          template: widget.template,
          assignmentId: widget.assignmentId,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final deviceType = widget.template['device_type']?.toString();
    final deviceTypeLabel = deviceType == 'slab_base' 
        ? 'Нил суурь' 
        : deviceType == 'ramp' 
            ? 'Налуу зам' 
            : deviceType ?? 'Тодорхойгүй';

    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(deviceTypeLabel),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_sections.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.folder_open, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Хэсэг олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Энэ template-д хэсэг байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16.0),
      itemCount: _sections.length + 1, // +1 for Act section
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        // Show Act section as the last item
        if (index == _sections.length) {
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
                // Navigate to Act page
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => InstallActPage(
                      assignmentId: widget.assignmentId,
                      orgId: widget.orgId,
                      title: widget.title,
                      templateId: widget.template['id']?.toString(),
                    ),
                  ),
                );
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
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          'Акт',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Акт файл оруулах',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.textSecondary,
                          ),
                        ),
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

        // Regular sections
        final section = _sections[index];
        final title = section['title']?.toString() ?? 'Тодорхойгүй';
        final fields = section['fields'] as List?;
        final fieldCount = fields?.length ?? 0;

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
            onPressed: () => _onSectionTap(section),
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
                    Icons.folder,
                    color: Colors.white,
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
                      const SizedBox(height: 2),
                      Text(
                        '$fieldCount асуулт',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
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
      },
    );
  }
}
