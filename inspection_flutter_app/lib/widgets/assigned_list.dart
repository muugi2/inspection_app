import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/inspection_start_page.dart';
import 'package:app/pages/install_type_selection_page.dart';

class AssignedItem {
  final String id;
  final String title;
  final String? contractName;
  final String type;
  final String? deviceId; // Inspection-ий device ID
  final String? deviceLocation;
  final String? deviceModel;
  final Map<String, dynamic>?
  deviceInfo; // Inspection тус бүрийн төхөөрөмжийн мэдээлэл
  final Map<String, dynamic>?
  deviceModelInfo; // Inspection тус бүрийн загварын мэдээлэл

  const AssignedItem({
    required this.id,
    required this.title,
    required this.type,
    this.contractName,
    this.deviceId,
    this.deviceLocation,
    this.deviceModel,
    this.deviceInfo,
    this.deviceModelInfo,
  });
}

class AssignedList extends StatefulWidget {
  final String type; // inspection | repair | install
  const AssignedList({super.key, required this.type});

  @override
  State<AssignedList> createState() => _AssignedListState();
}

class _AssignedListState extends State<AssignedList> {
  bool _loading = true;
  String _error = '';
  List<AssignedItem> _items = const [];

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
      // Map frontend types to backend types
      String backendType = widget.type;
      switch (widget.type.toLowerCase()) {
        case 'repair':
          backendType = 'maintenance';
          break;
        case 'install':
          backendType = 'installation';
          break;
        case 'verify':
        case 'verification':
          backendType = 'inspection';
          break;
        default:
          backendType = widget.type;
      }

      debugPrint('=== LOADING ASSIGNED ITEMS ===');
      debugPrint('Widget type: ${widget.type}');
      debugPrint('Backend type: $backendType');

      final dynamic response = await InspectionAPI.getAssignedByType(
        backendType,
      );
      debugPrint('API response: $response');

      final parsed = await _parseResponseWithDeviceInfo(response, widget.type);
      debugPrint('Parsed items count: ${parsed.length}');

      setState(() {
        _items = parsed;
      });
    } catch (e) {
      debugPrint('Error loading items: $e');
      setState(() {
        _error = 'Ачаалах үед алдаа гарлаа: $e';
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<List<AssignedItem>> _parseResponseWithDeviceInfo(
    dynamic response,
    String fallbackType,
  ) async {
    final items = _parseResponse(response, fallbackType);

    // Fetch device info for each item
    for (int i = 0; i < items.length; i++) {
      try {
        debugPrint('=== FETCHING DEVICE INFO ===');
        debugPrint('Inspection ID: ${items[i].id}');
        final deviceResponse = await InspectionAPI.getDeviceDetails(
          items[i].id,
        );
        debugPrint('Device info response: $deviceResponse');

        if (deviceResponse is Map<String, dynamic>) {
          debugPrint('Response is Map, checking data field...');
          final data = deviceResponse['data'];
          debugPrint('Data field: $data');

          if (data is Map<String, dynamic> && data['device'] is Map) {
            final device = data['device'] as Map<String, dynamic>;
            debugPrint('Device field: $device');

            String? deviceLocation;
            String? deviceModel;
            Map<String, dynamic>? deviceModelInfo;

            // Get location directly from device.location (new backend structure)
            deviceLocation = device['location']?.toString();
            debugPrint('Location from device: $deviceLocation');

            // Get model from model.model
            if (device['model'] is Map) {
              final model = device['model'] as Map<String, dynamic>;
              deviceModel = model['model']?.toString();
              deviceModelInfo = model; // Бүх model мэдээллийг хадгална
              debugPrint('Model from model: $deviceModel');
            }

            // Update the item with device info
            items[i] = AssignedItem(
              id: items[i].id,
              title: items[i].title,
              type: items[i].type,
              contractName: items[i].contractName,
              deviceId: items[i].deviceId,
              deviceLocation: deviceLocation,
              deviceModel: deviceModel,
              deviceInfo: device, // Inspection тус бүрийн төхөөрөмжийн мэдээлэл
              deviceModelInfo:
                  deviceModelInfo, // Inspection тус бүрийн загварын мэдээлэл
            );

            debugPrint(
              'Updated item: ${items[i].deviceLocation}, ${items[i].deviceModel}',
            );
          }
        }
      } catch (e) {
        debugPrint('Error fetching device info for ${items[i].id}: $e');
        // Continue with original item if device info fetch fails
      }
    }

    return items;
  }

  List<AssignedItem> _parseResponse(dynamic response, String fallbackType) {
    dynamic listData;
    if (response is Map<String, dynamic>) {
      listData =
          response['data'] ??
          response['items'] ??
          response['result'] ??
          response['rows'];
    } else {
      listData = response;
    }

    if (listData is! List) return const [];

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
                            ? raw['contract']['name']
                            : null))
                    ?.toString();
            final String type =
                (raw['type'] ?? raw['inspectionType'] ?? fallbackType)
                    .toString();

            // Device ID авах
            final String? deviceId = (raw['deviceId'] ?? raw['device_id'])
                ?.toString();

            // Device info will be fetched separately in _parseResponseWithDeviceInfo

            return AssignedItem(
              id: id,
              title: title,
              type: type,
              contractName: contractName,
              deviceId: deviceId,
              deviceLocation:
                  null, // Will be set in _parseResponseWithDeviceInfo
              deviceModel: null, // Will be set in _parseResponseWithDeviceInfo
              deviceInfo: null, // Will be set in _parseResponseWithDeviceInfo
              deviceModelInfo:
                  null, // Will be set in _parseResponseWithDeviceInfo
            );
          }
          final String id = raw.toString();
          return AssignedItem(
            id: id,
            title: 'ID: $id',
            type: fallbackType,
            deviceId: null,
            deviceInfo: null,
            deviceModelInfo: null,
          );
        })
        .where((e) => e.id.isNotEmpty)
        .toList();
  }

  void _onTap(AssignedItem item) {
    if (item.type.toLowerCase() == 'inspection') {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => InspectionStartPage(
            item: item,
            deviceInfo: item.deviceInfo, // Item-ийн device мэдээлэл ашиглах
            deviceModelInfo:
                item.deviceModelInfo, // Item-ийн model мэдээлэл ашиглах
          ),
        ),
      );
    } else if (item.type.toLowerCase() == 'install' || 
               item.type.toLowerCase() == 'installation') {
      // Суурьлуулалтын хувьд төрөл сонгох хуудас руу шилжих
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => const InstallTypeSelectionPage(),
        ),
      );
    } else {
      _showStartSheet(context, item);
    }
  }

  void _showStartSheet(BuildContext context, AssignedItem item) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Device info as simple text (no card)
              _buildSimpleDeviceInfo(item),
              const SizedBox(height: 16),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('${_actionVerb(item.type)} эхэллээ'),
                      ),
                    );
                  },
                  child: Text('${_actionVerb(item.type)}'),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Болих'),
              ),
            ],
          ),
        );
      },
    );
  }

  String _actionVerb(String type) {
    switch (type.toLowerCase()) {
      case 'repair':
        return 'Засварыг эхлүүлэх';
      case 'install':
      case 'installation':
        return 'Суурилуулалтыг эхлүүлэх';
      default:
        return 'Үзлэгийг эхлүүлэх';
    }
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

    if (_items.isEmpty) {
      return Center(child: Text(_emptyTextForType(widget.type)));
    }

    return RefreshIndicator(
      onRefresh: () async {
        await _load();
      },
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16.0, 16.0, 16.0, 100.0), // Navbar-ийн өргөлтийн хувьд bottom padding
        itemCount: _items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final item = _items[index];
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
        },
      ),
    );
  }

  Widget _buildSimpleDeviceInfo(AssignedItem item) {
    // Device мэдээллийг энгийн text хэлбэрээр харуулах
    String? deviceModel;
    String? location;

    // Item-ийн device мэдээлэл ашиглах (inspection тус бүрт өөр өөр)
    if (item.deviceInfo != null) {
      // Model мэдээлэл
      if (item.deviceInfo!['model'] is Map<String, dynamic>) {
        final modelInfo = item.deviceInfo!['model'] as Map<String, dynamic>;
        deviceModel = modelInfo['model']?.toString();
      }

      // Location мэдээлэл
      final metadata = item.deviceInfo!['metadata'];
      if (metadata != null) {
        if (metadata is String) {
          try {
            final metadataMap = jsonDecode(metadata) as Map<String, dynamic>;
            location = metadataMap['location']?.toString();
          } catch (e) {
            // JSON parse алдаа
          }
        } else if (metadata is Map<String, dynamic>) {
          location = metadata['location']?.toString();
        }
      }
    }

    // Fallback to original item data
    if (deviceModel == null) deviceModel = item.deviceModel;
    if (location == null) location = item.deviceLocation;

    // Text харуулах
    return Column(
      children: [
        if (deviceModel != null && deviceModel.isNotEmpty) ...[
          Text(
            deviceModel,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
        ],
        if (location != null && location.isNotEmpty) ...[
          Text(
            location,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: Colors.grey,
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  String _buildSubtitleWithDeviceInfo(AssignedItem item) {
    // Хэрэв inspection type биш бол анхны subtitle-ийг буцаа
    if (widget.type.toLowerCase() != 'inspection') {
      return _buildSubtitle(item);
    }

    debugPrint('=== BUILDING SUBTITLE WITH DEVICE INFO ===');
    debugPrint('Item Device Info: ${item.deviceInfo}');
    debugPrint('Item Device Model Info: ${item.deviceModelInfo}');

    List<String> parts = [];

    // Item-ийн төхөөрөмжийн мэдээлэл ашиглах (inspection тус бүрт өөр өөр)
    if (item.deviceInfo != null) {
      debugPrint('Adding device info to subtitle...');

      // Device-аас шууд model мэдээлэл авах
      String? deviceModel;
      if (item.deviceInfo!['model'] is Map<String, dynamic>) {
        final modelInfo = item.deviceInfo!['model'] as Map<String, dynamic>;
        deviceModel = modelInfo['model']?.toString();
        debugPrint('Found model from device: $deviceModel');
      }

      // Metadata-аас location мэдээлэл авах
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
        debugPrint('Found location from metadata: $location');
      }

      // Model эхлээд нэмэх
      if (deviceModel != null && deviceModel.isNotEmpty) {
        parts.add(deviceModel);
      }

      // Location дараа нь нэмэх
      if (location != null && location.isNotEmpty) {
        parts.add(location);
      }

      debugPrint('Parts added: $parts');
    }

    // Хэрэв item-ийн device мэдээлэл байхгүй бол анхны subtitle ашигла
    if (parts.isEmpty) {
      debugPrint('No device info found, using original subtitle');
      return _buildSubtitle(item);
    }

    final result = parts.join(' • ');
    debugPrint('Final subtitle with device info: $result');
    return result;
  }

  String _buildSubtitle(AssignedItem item) {
    List<String> parts = [];

    // Location first (most important)
    if (item.deviceLocation != null && item.deviceLocation!.isNotEmpty) {
      parts.add(item.deviceLocation!);
    }

    // Model second
    if (item.deviceModel != null && item.deviceModel!.isNotEmpty) {
      parts.add(item.deviceModel!);
    }

    if (parts.isEmpty) {
      return '';
    }

    return parts.join(' • ');
  }

  String _emptyTextForType(String type) {
    switch (type.toLowerCase()) {
      case 'verify':
      case 'verification':
        return 'Одоогоор баталгаажуулах ажил алга.';
      case 'repair':
        return 'Одоогоор даалгасан засвар алга.';
      case 'install':
      case 'installation':
        return 'Одоогоор даалгасан суурилуулалт алга.';
      default:
        return 'Одоогоор даалгасан үзлэг алга.';
    }
  }
}
