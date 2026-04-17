import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/config/app_config.dart';
import 'package:app/utils/error_handler.dart';
import 'package:app/pages/repair_detail_page.dart';
import 'package:app/pages/repair_assignment_page.dart';

class RepairItem {
  final String id;
  final String inspectionId;
  final String inspectionTitle;
  final String fieldId;
  final String section;
  final String questionText;
  final String? originalStatus;
  final String? description;
  final String repairStatus;
  final Map<String, dynamic>? inspectionData;
  final Map<String, dynamic>? deviceInfo;

  const RepairItem({
    required this.id,
    required this.inspectionId,
    required this.inspectionTitle,
    required this.fieldId,
    required this.section,
    required this.questionText,
    this.originalStatus,
    this.description,
    required this.repairStatus,
    this.inspectionData,
    this.deviceInfo,
  });
}

class InspectionWithRepairs {
  final String id;
  final String title;
  final Map<String, dynamic>? deviceInfo;
  final List<RepairItem> repairs;

  const InspectionWithRepairs({
    required this.id,
    required this.title,
    this.deviceInfo,
    required this.repairs,
  });
}

class RepairPage extends StatefulWidget {
  const RepairPage({super.key});

  @override
  State<RepairPage> createState() => _RepairPageState();
}

class _RepairPageState extends State<RepairPage> with SingleTickerProviderStateMixin {
  bool _loading = true;
  String _error = '';
  List<InspectionWithRepairs> _inspectionsWithRepairs = [];
  bool _expanded = true;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      debugPrint('🔍 Loading repairs from inspection answers...');
      debugPrint('   API endpoint: /api/inspections/repairs-needed');
      debugPrint(
        '   Request URL: ${AppConfig.apiBaseUrl}/api/inspections/repairs-needed',
      );

      final response = await InspectionAPI.getInspectionsWithRepairsNeeded();
      debugPrint('✅ Response received');
      debugPrint('   Response keys: ${response.keys.toList()}');

      final inspectionsData = response['data'] ?? [];
      debugPrint('   Inspections data type: ${inspectionsData.runtimeType}');
      debugPrint(
        '   Inspections data length: ${inspectionsData is List ? inspectionsData.length : 'N/A'}',
      );

      final List<InspectionWithRepairs> inspections = [];
      for (var inspectionData in inspectionsData) {
        try {
          final inspectionMap = inspectionData as Map<String, dynamic>;
          final inspection =
              inspectionMap['inspection'] as Map<String, dynamic>?;
          final repairs = inspectionMap['repairs'] as List<dynamic>? ?? [];

          if (inspection == null || repairs.isEmpty) continue;

          final deviceInfo = inspection['device'] as Map<String, dynamic>?;
          final inspectionId = inspection['id']?.toString() ?? '';
          final inspectionTitle = inspection['title']?.toString() ?? 'Үзлэг';

          // Create repair items for this inspection
          final List<RepairItem> repairItems = [];
          for (var repairData in repairs) {
            final repairMap = repairData as Map<String, dynamic>;

            repairItems.add(
              RepairItem(
                id: '${inspectionId}_${repairMap['fieldId']}', // Temporary ID
                inspectionId: inspectionId,
                inspectionTitle: inspectionTitle,
                fieldId: repairMap['fieldId']?.toString() ?? '',
                section: repairMap['section']?.toString() ?? '',
                questionText: repairMap['questionText']?.toString() ?? '',
                originalStatus: repairMap['originalStatus']?.toString(),
                description: repairMap['description']?.toString(),
                repairStatus:
                    'PENDING', // All items from inspection_answer are pending
                inspectionData: inspection,
                deviceInfo: deviceInfo,
              ),
            );
          }

          inspections.add(
            InspectionWithRepairs(
              id: inspectionId,
              title: inspectionTitle,
              deviceInfo: deviceInfo,
              repairs: repairItems,
            ),
          );
        } catch (e) {
          debugPrint('Error parsing inspection with repairs: $e');
        }
      }

      setState(() {
        _inspectionsWithRepairs = inspections;
        _loading = false;
      });

      debugPrint('✅ Loaded ${inspections.length} inspection(s) with repairs');
    } catch (e) {
      debugPrint('❌ Error loading repairs: $e');
      debugPrint('   Error type: ${e.runtimeType}');

      if (e is DioException) {
        debugPrint('   DioException details:');
        debugPrint('     Response status: ${e.response?.statusCode}');
        debugPrint('     Response data: ${e.response?.data}');
        debugPrint('     Request path: ${e.requestOptions.path}');
        debugPrint('     Request base URL: ${e.requestOptions.baseUrl}');
        debugPrint('     Request headers: ${e.requestOptions.headers}');

        if (e.response?.statusCode == 404) {
          debugPrint('   ⚠️ 404 Not Found - Route may not exist on server');
          debugPrint(
            '   ⚠️ Check if backend server is running and route is registered',
          );
        }
      }

      setState(() {
        _error = ErrorHandler.handleApiError(e);
        _loading = false;
      });
    }
  }

  void _onTap(InspectionWithRepairs inspection) {
    // Navigate to a page showing all repairs for this inspection
    // For now, navigate to first repair detail
    if (inspection.repairs.isNotEmpty) {
      final firstRepair = inspection.repairs[0];
      final repairItemMap = {
        'id': firstRepair.id,
        'inspectionId': firstRepair.inspectionId,
        'fieldId': firstRepair.fieldId,
        'section': firstRepair.section,
        'questionText': firstRepair.questionText,
        'originalStatus': firstRepair.originalStatus,
        'description': firstRepair.description,
        'repairStatus': firstRepair.repairStatus,
        'inspectionData': firstRepair.inspectionData,
        'deviceInfo': firstRepair.deviceInfo,
      };

      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => RepairDetailPage(
            repairId: firstRepair.id,
            inspectionId: firstRepair.inspectionId,
            fieldId: firstRepair.fieldId,
            repairItem: repairItemMap,
          ),
        ),
      );
    }
  }

  String _buildSubtitleWithDeviceInfo(InspectionWithRepairs inspection) {
    List<String> parts = [];

    if (inspection.deviceInfo != null) {
      String? deviceModel;
      if (inspection.deviceInfo!['model'] is Map<String, dynamic>) {
        final modelInfo =
            inspection.deviceInfo!['model'] as Map<String, dynamic>;
        deviceModel = modelInfo['model']?.toString();
      }

      final metadata = inspection.deviceInfo!['metadata'];
      String? location;

      if (metadata != null) {
        if (metadata is String) {
          try {
            final metadataMap = jsonDecode(metadata) as Map<String, dynamic>;
            location = metadataMap['location']?.toString();
          } catch (e) {
            debugPrint('JSON parse error for metadata: $e');
          }
        } else if (metadata is Map<String, dynamic>) {
          location = metadata['location']?.toString();
        }
      }

      if (deviceModel != null && deviceModel.isNotEmpty) {
        parts.add(deviceModel);
      }

      if (location != null && location.isNotEmpty) {
        parts.add(location);
      }
    }

    if (parts.isEmpty) {
      // Show repair count as fallback
      return '${inspection.repairs.length} засвар шаардлагатай';
    }

    return parts.join(' • ');
  }

  Widget _buildInspectionCard(InspectionWithRepairs inspection) {
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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
        onPressed: () => _onTap(inspection),
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
                Icons.build_circle,
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
                    inspection.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _buildSubtitleWithDeviceInfo(inspection),
                    maxLines: 2,
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
  }

  Widget _buildSection({
    required String title,
    required List<InspectionWithRepairs> inspections,
    required String emptyMessage,
    required bool isExpanded,
    required VoidCallback onToggle,
  }) {
    if (inspections.isEmpty) {
      return const SizedBox.shrink();
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ExpansionTile(
        title: Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        subtitle: Text(
          '${inspections.length} үзлэг',
          style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
        ),
        trailing: Icon(
          isExpanded ? Icons.expand_less : Icons.expand_more,
          color: AppColors.primary,
        ),
        initiallyExpanded: isExpanded,
        onExpansionChanged: (expanded) => onToggle(),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              children: [
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: inspections.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    return _buildInspectionCard(inspections[index]);
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
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
              onPressed: _load,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }

    // Always show tab bar and tab view, regardless of whether there are repairs needed
    // This allows users to access "Засварын томилолт" tab even when no repairs are needed
    return Column(
      children: [
        TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Засвар шаардлагатай'),
            Tab(text: 'Засварын томилолт'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              // Засвар шаардлагатай үзлэгүүд
              RefreshIndicator(
                onRefresh: _load,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.only(bottom: 100),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 8),
                      _buildSection(
                        title: 'Засвар шаардлагатай үзлэг',
                        inspections: _inspectionsWithRepairs,
                        emptyMessage: 'Одоогоор засвар шаардлагатай үзлэг алга.',
                        isExpanded: _expanded,
                        onToggle: () {
                          setState(() {
                            _expanded = !_expanded;
                          });
                        },
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),
              // Засварын томилолт
              const RepairAssignmentPage(),
            ],
          ),
        ),
      ],
    );
  }
}
