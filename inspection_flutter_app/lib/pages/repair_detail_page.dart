import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/repair_field_detail_page.dart';

class RepairDetailPage extends StatefulWidget {
  final String repairId;
  final String inspectionId;
  final String fieldId;
  final Map<String, dynamic>? repairItem;

  const RepairDetailPage({
    super.key,
    required this.repairId,
    required this.inspectionId,
    required this.fieldId,
    this.repairItem,
  });

  @override
  State<RepairDetailPage> createState() => _RepairDetailPageState();
}

class _RepairDetailPageState extends State<RepairDetailPage> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _repairFields = [];
  Map<String, dynamic>? _inspectionData;
  Map<String, dynamic>? _deviceInfo;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      debugPrint(
        '🔍 Loading repair fields for inspection: ${widget.inspectionId}',
      );

      // Get inspection with repairs needed
      final response = await InspectionAPI.getInspectionsWithRepairsNeeded();
      final inspectionsData = response['data'] ?? [];

      // Find this specific inspection
      Map<String, dynamic>? targetInspection;
      for (var inspectionData in inspectionsData) {
        final inspection =
            inspectionData['inspection'] as Map<String, dynamic>?;
        if (inspection != null &&
            inspection['id'].toString() == widget.inspectionId) {
          targetInspection = inspectionData;
          break;
        }
      }

      if (targetInspection == null) {
        // If inspection not found (all repairs completed), navigate back to RepairPage
        debugPrint(
          '⚠️ Inspection ${widget.inspectionId} not found in repairs-needed list. All repairs may be completed.',
        );
        if (mounted) {
          // Show message and navigate back
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Бүх засварууд амжилттай хийгдсэн байна'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 2),
            ),
          );

          // Navigate back to RepairPage (pop current page)
          Navigator.of(context).pop();
        }
        return;
      }

      final inspection = targetInspection['inspection'] as Map<String, dynamic>;
      final repairs = targetInspection['repairs'] as List<dynamic>? ?? [];

      // If no repairs left (all completed), navigate back
      if (repairs.isEmpty) {
        debugPrint('⚠️ No repair fields found. All repairs may be completed.');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Бүх засварууд амжилттай хийгдсэн байна'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 2),
            ),
          );

          // Navigate back to RepairPage
          Navigator.of(context).pop();
        }
        return;
      }

      setState(() {
        _inspectionData = inspection;
        _deviceInfo = inspection['device'] as Map<String, dynamic>?;
        _repairFields = repairs.cast<Map<String, dynamic>>();
        _loading = false;
      });

      debugPrint('✅ Loaded ${_repairFields.length} repair field(s)');
    } catch (e) {
      debugPrint('❌ Error loading repair fields: $e');
      setState(() {
        _error = 'Ачаалах үед алдаа гарлаа: ${e.toString()}';
        _loading = false;
      });
    }
  }

  void _onFieldTap(Map<String, dynamic> field) {
    Navigator.of(context)
        .push(
          MaterialPageRoute(
            builder: (_) => RepairFieldDetailPage(
              inspectionId: widget.inspectionId,
              fieldId: field['fieldId'] ?? '',
              section: field['section'] ?? '',
              field: field,
              inspectionData: _inspectionData,
              deviceInfo: _deviceInfo,
            ),
          ),
        )
        .then((_) {
          // Reload when returning from detail page
          _load();
        });
  }

  String _getStatusBadgeColor(String? status) {
    if (status == null) return 'grey';
    final statusLower = status.toLowerCase();
    if (statusLower.contains('солих') || statusLower.contains('replace')) {
      return 'red';
    } else if (statusLower.contains('сайжруулах') ||
        statusLower.contains('improve')) {
      return 'orange';
    }
    return 'orange';
  }

  Color _getStatusColor(String colorName) {
    switch (colorName) {
      case 'red':
        return Colors.red;
      case 'orange':
        return Colors.orange;
      case 'grey':
      default:
        return Colors.grey;
    }
  }

  Widget _buildFieldCard(Map<String, dynamic> field) {
    final questionText = field['questionText'] ?? 'Асуулт';
    final originalStatus = field['originalStatus'] ?? '';
    final description = field['description'] ?? '';
    final section = field['section'] ?? '';

    final statusColor = _getStatusBadgeColor(originalStatus);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _onFieldTap(field),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row with section and status
              Row(
                children: [
                  // Section badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      section,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Status badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: _getStatusColor(statusColor).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      originalStatus,
                      style: TextStyle(
                        fontSize: 12,
                        color: _getStatusColor(statusColor),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Spacer(),
                  const Icon(
                    Icons.arrow_forward_ios,
                    size: 16,
                    color: AppColors.textSecondary,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              // Question text
              Text(
                questionText,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  description,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_inspectionData?['title'] ?? 'Засварын дэлгэрэнгүй'),
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
          ? Center(
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
                    onPressed: _load,
                    child: const Text('Дахин ачаалах'),
                  ),
                ],
              ),
            )
          : _repairFields.isEmpty
          ? const Center(child: Text('Засвар шаардлагатай зүйл алга.'))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.only(top: 8, bottom: 100),
                children: [
                  // Device info
                  if (_deviceInfo != null) ...[
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFE6E6E6)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Төхөөрөмжийн мэдээлэл',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 12),
                            if (_deviceInfo!['model'] != null) ...[
                              Text(
                                'Загвар: ${_deviceInfo!['model']['model'] ?? ''}',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                              const SizedBox(height: 4),
                            ],
                            if (_deviceInfo!['serialNumber'] != null)
                              Text(
                                'Serial: ${_deviceInfo!['serialNumber']}',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  // Summary
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'Нийт ${_repairFields.length} засвар шаардлагатай',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  // Repair fields list
                  ..._repairFields
                      .map((field) => _buildFieldCard(field))
                      .toList(),
                ],
              ),
            ),
    );
  }
}
