import 'package:flutter/material.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/install_field_page.dart';

class InstallFieldListPage extends StatefulWidget {
  final Map<String, dynamic> section;
  final Map<String, dynamic> template;
  final String? assignmentId; // Assignment ID for saving data

  const InstallFieldListPage({
    super.key,
    required this.section,
    required this.template,
    this.assignmentId,
  });

  @override
  State<InstallFieldListPage> createState() => _InstallFieldListPageState();
}

class _InstallFieldListPageState extends State<InstallFieldListPage> {
  List<Map<String, dynamic>> _fields = [];

  @override
  void initState() {
    super.initState();
    _parseFields();
  }

  void _parseFields() {
    try {
      final fields = widget.section['fields'] as List?;
      if (fields != null) {
        setState(() {
          _fields = fields.cast<Map<String, dynamic>>();
        });
        debugPrint('Parsed ${_fields.length} fields from section');
      }
    } catch (e) {
      debugPrint('Error parsing fields: $e');
    }
  }

  void _onFieldTap(Map<String, dynamic> field) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InstallFieldPage(
          section: widget.section,
          template: widget.template,
          field: field,
          assignmentId: widget.assignmentId,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sectionTitle = widget.section['title']?.toString() ?? 'Тодорхойгүй';

    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(sectionTitle),
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
    if (_fields.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.list_alt, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Асуулт олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Энэ хэсэгт асуулт байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16.0),
      itemCount: _fields.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final field = _fields[index];
        final question = field['question']?.toString() ?? 'Тодорхойгүй';

        return Card(
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => _onFieldTap(field),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: AppColors.centerGradient,
                    ),
                    child: const Icon(
                      Icons.help_outline,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text(
                      question,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Icon(
                    Icons.arrow_forward_ios,
                    color: AppColors.textSecondary,
                    size: 18,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
