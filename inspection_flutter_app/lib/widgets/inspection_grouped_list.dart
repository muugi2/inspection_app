import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/inspection_start_page.dart';
import 'package:app/utils/api_response_parser.dart';
import 'package:app/utils/error_handler.dart';
import 'package:app/widgets/assigned_list.dart';

class InspectionGroupedItem {
  final String id;
  final String title;
  final String? contractName;
  final String type;
  final String? scheduleType;
  final String? deviceId;
  final String? deviceLocation;
  final String? deviceModel;
  final Map<String, dynamic>? deviceInfo;
  final Map<String, dynamic>? deviceModelInfo;

  const InspectionGroupedItem({
    required this.id,
    required this.title,
    required this.type,
    this.scheduleType,
    this.contractName,
    this.deviceId,
    this.deviceLocation,
    this.deviceModel,
    this.deviceInfo,
    this.deviceModelInfo,
  });
}

class InspectionGroupedList extends StatefulWidget {
  const InspectionGroupedList({super.key});

  @override
  State<InspectionGroupedList> createState() => _InspectionGroupedListState();
}

class _InspectionGroupedListState extends State<InspectionGroupedList> {
  bool _loading = true;
  String _error = '';
  List<InspectionGroupedItem> _dailyItems = [];
  List<InspectionGroupedItem> _scheduledItems = [];
  List<InspectionGroupedItem> _assignmentItems = [];
  bool _dailyExpanded = false;
  bool _scheduledExpanded = false;
  bool _assignmentExpanded = false;

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
      // Load daily inspections (DAILY scheduleType)
      debugPrint('🔍 Loading DAILY inspections...');
      final dailyResponse = await InspectionAPI.getInspectionsByScheduleType('DAILY');
      final dailyRawItems = ApiResponseParser.parseListResponse(dailyResponse);
      debugPrint('📋 DAILY raw items count: ${dailyRawItems.length}');
      if (dailyRawItems.isNotEmpty) {
        debugPrint('📋 First DAILY item: ${dailyRawItems[0]}');
      }
      final dailyParsed = await _parseResponseWithDeviceInfo(dailyRawItems);
      debugPrint('✅ DAILY parsed items count: ${dailyParsed.length}');

      // Load scheduled inspections (SCHEDULED scheduleType)
      debugPrint('🔍 Loading SCHEDULED inspections...');
      final scheduledResponse = await InspectionAPI.getInspectionsByScheduleType('SCHEDULED');
      final scheduledRawItems = ApiResponseParser.parseListResponse(scheduledResponse);
      debugPrint('📋 SCHEDULED raw items count: ${scheduledRawItems.length}');
      if (scheduledRawItems.isNotEmpty) {
        debugPrint('📋 First SCHEDULED item: ${scheduledRawItems[0]}');
      }
      final scheduledParsed = await _parseResponseWithDeviceInfo(scheduledRawItems);
      debugPrint('✅ SCHEDULED parsed items count: ${scheduledParsed.length}');

      // Load assignment inspections (MAINTENANCE type)
      debugPrint('🔍 Loading MAINTENANCE (assignment) inspections...');
      final assignmentResponse = await InspectionAPI.getAssignedByType('MAINTENANCE');
      final assignmentRawItems = ApiResponseParser.parseListResponse(assignmentResponse);
      debugPrint('📋 MAINTENANCE raw items count: ${assignmentRawItems.length}');
      if (assignmentRawItems.isNotEmpty) {
        debugPrint('📋 First MAINTENANCE item: ${assignmentRawItems[0]}');
      }
      final assignmentParsed = await _parseResponseWithDeviceInfo(assignmentRawItems);
      debugPrint('✅ MAINTENANCE parsed items count: ${assignmentParsed.length}');

      setState(() {
        _dailyItems = dailyParsed;
        _scheduledItems = scheduledParsed;
        _assignmentItems = assignmentParsed;
        _loading = false;
      });
      
      debugPrint('📊 Final state: DAILY=${dailyParsed.length}, SCHEDULED=${scheduledParsed.length}, ASSIGNMENT=${assignmentParsed.length}');
    } catch (e) {
      debugPrint('❌ Error loading inspections: $e');
      setState(() {
        _error = ErrorHandler.handleApiError(e);
        _loading = false;
      });
    }
  }

  Future<List<InspectionGroupedItem>> _parseResponseWithDeviceInfo(
    List<dynamic> rawItems,
  ) async {
    final items = _parseResponse(rawItems);

    // Fetch device info for each item
    for (int i = 0; i < items.length; i++) {
      try {
        final deviceResponse = await InspectionAPI.getDeviceDetails(items[i].id);

        if (deviceResponse is Map<String, dynamic>) {
          final data = deviceResponse['data'];

          if (data is Map<String, dynamic> && data['device'] is Map) {
            final device = data['device'] as Map<String, dynamic>;

            String? deviceLocation;
            String? deviceModel;
            Map<String, dynamic>? deviceModelInfo;

            deviceLocation = device['location']?.toString();

            if (device['model'] is Map) {
              final model = device['model'] as Map<String, dynamic>;
              deviceModel = model['model']?.toString();
              deviceModelInfo = model;
            }

            items[i] = InspectionGroupedItem(
              id: items[i].id,
              title: items[i].title,
              type: items[i].type,
              scheduleType: items[i].scheduleType,
              contractName: items[i].contractName,
              deviceId: items[i].deviceId,
              deviceLocation: deviceLocation,
              deviceModel: deviceModel,
              deviceInfo: device,
              deviceModelInfo: deviceModelInfo,
            );
          }
        }
      } catch (e) {
        debugPrint('Error fetching device info for ${items[i].id}: $e');
      }
    }

    return items;
  }

  List<InspectionGroupedItem> _parseResponse(List<dynamic> listData) {
    if (listData.isEmpty) return [];

    return listData
        .map((raw) {
          if (raw is Map<String, dynamic>) {
            final dynamic idRaw =
                raw['id'] ?? raw['_id'] ?? raw['inspectionId'] ?? raw['taskId'];
            final String id = idRaw?.toString() ?? '';
            final String title =
                (raw['title'] ??
                        raw['name'] ??
                        raw['inspectionTitle'] ??
                        'ID: $id')
                    .toString();
            final String? contractName =
                (raw['contractName'] ??
                        raw['contract_name'] ??
                        (raw['contract'] is Map
                            ? raw['contract']['contractName'] ??
                                raw['contract']['name']
                            : null))
                    ?.toString();
            final String type =
                (raw['type'] ?? raw['inspectionType'] ?? 'inspection').toString();
            final String? scheduleType = raw['scheduleType']?.toString();
            
            // Debug: Log scheduleType for each item
            debugPrint('🔍 Parsing inspection: id=$id, scheduleType=$scheduleType, title=$title');

            final String? deviceId = (raw['deviceId'] ?? raw['device_id'])?.toString();

            return InspectionGroupedItem(
              id: id,
              title: title,
              type: type,
              scheduleType: scheduleType,
              contractName: contractName,
              deviceId: deviceId,
              deviceLocation: null,
              deviceModel: null,
              deviceInfo: null,
              deviceModelInfo: null,
            );
          }
          final String id = raw.toString();
          return InspectionGroupedItem(
            id: id,
            title: 'ID: $id',
            type: 'inspection',
            deviceId: null,
            deviceInfo: null,
            deviceModelInfo: null,
          );
        })
        .where((e) => e.id.isNotEmpty)
        .toList();
  }

  void _onTap(InspectionGroupedItem item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InspectionStartPage(
          item: AssignedItem(
            id: item.id,
            title: item.title,
            type: item.type,
            contractName: item.contractName,
            deviceId: item.deviceId,
            deviceLocation: item.deviceLocation,
            deviceModel: item.deviceModel,
            deviceInfo: item.deviceInfo,
            deviceModelInfo: item.deviceModelInfo,
          ),
          deviceInfo: item.deviceInfo,
          deviceModelInfo: item.deviceModelInfo,
        ),
      ),
    );
  }

  String _buildSubtitleWithDeviceInfo(InspectionGroupedItem item) {
    List<String> parts = [];

    if (item.deviceInfo != null) {
      String? deviceModel;
      String? deviceType;
      if (item.deviceInfo!['model'] is Map<String, dynamic>) {
        final modelInfo = item.deviceInfo!['model'] as Map<String, dynamic>;
        deviceModel = modelInfo['model']?.toString();
        // Device type-ийг авна (ANALOG эсвэл DIGITAL)
        final type = modelInfo['deviceType']?.toString();
        if (type != null && type.isNotEmpty) {
          deviceType = type == 'ANALOG' ? 'Аналог' : type == 'DIGITAL' ? 'Дижитал' : type;
        }
      }

      final metadata = item.deviceInfo!['metadata'];
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

      if (deviceType != null && deviceType.isNotEmpty) {
        parts.add(deviceType);
      }

      if (location != null && location.isNotEmpty) {
        parts.add(location);
      }
    }

    if (parts.isEmpty) {
      if (item.deviceLocation != null && item.deviceLocation!.isNotEmpty) {
        parts.add(item.deviceLocation!);
      }
      if (item.deviceModel != null && item.deviceModel!.isNotEmpty) {
        parts.add(item.deviceModel!);
      }
    }

    if (parts.isEmpty) {
      return '';
    }

    return parts.join(' • ');
  }

  Widget _buildInspectionCard(InspectionGroupedItem item) {
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
        onPressed: () => _onTap(item),
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
                Icons.assignment_turned_in_rounded,
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
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _buildSubtitleWithDeviceInfo(item),
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
    required List<InspectionGroupedItem> items,
    required String emptyMessage,
    required bool isExpanded,
    required VoidCallback onToggle,
  }) {
    if (items.isEmpty) {
      return const SizedBox.shrink();
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
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
          '${items.length} үзлэг',
          style: const TextStyle(
            fontSize: 14,
            color: AppColors.textSecondary,
          ),
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
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    return _buildInspectionCard(items[index]);
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

    final hasDaily = _dailyItems.isNotEmpty;
    final hasScheduled = _scheduledItems.isNotEmpty;
    final hasAssignment = _assignmentItems.isNotEmpty;

    if (!hasDaily && !hasScheduled && !hasAssignment) {
      return const Center(
        child: Text('Одоогоор үзлэг алга.'),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 100), // Navbar-ийн өргөлтийн хувьд padding
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            // Өдөр тутмын үзлэгүүд (DAILY)
            if (hasDaily)
              _buildSection(
                title: 'Өдөр тутмын үзлэг, шалгалт',
                items: _dailyItems,
                emptyMessage: 'Одоогоор өдөр тутмын үзлэг алга.',
                isExpanded: _dailyExpanded,
                onToggle: () {
                  setState(() {
                    _dailyExpanded = !_dailyExpanded;
                  });
                },
              ),
            // Хугацаат үзлэгүүд (SCHEDULED)
            if (hasScheduled)
              _buildSection(
                title: 'Хугацаат үзлэг',
                items: _scheduledItems,
                emptyMessage: 'Одоогоор хугацаат үзлэг алга.',
                isExpanded: _scheduledExpanded,
                onToggle: () {
                  setState(() {
                    _scheduledExpanded = !_scheduledExpanded;
                  });
                },
              ),
            // Томилолтын үзлэгүүд (MAINTENANCE)
            if (hasAssignment)
              _buildSection(
                title: 'Томилолтын үзлэг',
                items: _assignmentItems,
                emptyMessage: 'Одоогоор томилолтын үзлэг алга.',
                isExpanded: _assignmentExpanded,
                onToggle: () {
                  setState(() {
                    _assignmentExpanded = !_assignmentExpanded;
                  });
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

