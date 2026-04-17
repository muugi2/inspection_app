import 'package:flutter/material.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/widgets/assigned_list.dart';
import 'package:app/pages/inspection_run_page.dart';
import 'package:app/services/api.dart';
import 'package:app/utils/error_handler.dart';

class InspectionStartPage extends StatefulWidget {
  final AssignedItem item;
  final Map<String, dynamic>? deviceInfo;
  final Map<String, dynamic>? deviceModelInfo;

  const InspectionStartPage({
    super.key,
    required this.item,
    this.deviceInfo,
    this.deviceModelInfo,
  });

  @override
  State<InspectionStartPage> createState() => _InspectionStartPageState();
}

class _InspectionStartPageState extends State<InspectionStartPage> {
  // Device-based card logic
  List<Map<String, dynamic>> _availableDevices = const [];
  bool _loadingDevices = false;
  String _deviceError = '';

  // Incomplete inspection check
  Map<String, dynamic>? _incompleteStatus;
  bool _hasIncompleteInspection = false;

  @override
  void initState() {
    super.initState();
    _loadAvailableDevices();
    _checkIncompleteInspection();
  }

  // Check if inspection has incomplete status
  Future<void> _checkIncompleteInspection() async {
    try {
      debugPrint('=== CHECKING INCOMPLETE INSPECTION ===');
      debugPrint('Inspection ID: ${widget.item.id}');

      final response = await InspectionAPI.getIncompleteInspectionStatus(
        widget.item.id,
      );

      if (response is Map<String, dynamic>) {
        final data = response['data'] ?? response;
        if (data is Map<String, dynamic> && data['isIncomplete'] == true) {
          setState(() {
            _incompleteStatus = data;
            _hasIncompleteInspection = true;
          });
          debugPrint('✅ Found incomplete inspection: ${data['answerId']}');
          debugPrint('Status: ${data['status']}');
          debugPrint('Progress: ${data['progress']?['percentage']}%');
          debugPrint('Next section: ${data['nextSection']}');
          debugPrint('Can continue: ${data['canContinue']}');
        } else {
          debugPrint('ℹ️ No incomplete inspection found (isIncomplete: ${data['isIncomplete']})');
          setState(() {
            _hasIncompleteInspection = false;
            _incompleteStatus = null;
          });
        }
      } else {
        debugPrint('ℹ️ Unexpected response format');
        setState(() {
          _hasIncompleteInspection = false;
          _incompleteStatus = null;
        });
      }
    } catch (e) {
      // Check if it's a 404 error (no incomplete inspection) vs other errors
      debugPrint('⚠️ Error checking incomplete inspection: $e');
      if (e.toString().contains('404') || e.toString().contains('Not Found')) {
        debugPrint('ℹ️ No incomplete inspection found (404)');
      } else {
        debugPrint('❌ Error checking incomplete inspection: $e');
      }
      setState(() {
        _hasIncompleteInspection = false;
        _incompleteStatus = null;
      });
    }
  }

  // Device-уудыг татах логик
  Future<void> _loadAvailableDevices() async {
    setState(() {
      _loadingDevices = true;
      _deviceError = '';
    });

    try {
      debugPrint('=== LOADING AVAILABLE DEVICES ===');

      // Бүх device-уудыг татах
      final devicesResponse = await InspectionAPI.getDevices();
      debugPrint('Devices API Response: $devicesResponse');

      List<Map<String, dynamic>> devices = [];

      if (devicesResponse is Map<String, dynamic>) {
        final data =
            devicesResponse['data'] ??
            devicesResponse['items'] ??
            devicesResponse['result'] ??
            devicesResponse['devices'] ??
            devicesResponse['rows'];

        if (data is List) {
          devices = data.cast<Map<String, dynamic>>();
        }
      } else if (devicesResponse is List) {
        devices = devicesResponse.cast<Map<String, dynamic>>();
      }

      debugPrint('Found ${devices.length} total devices');

      // Эхний device-ийн бүтцийг шалгах
      if (devices.isNotEmpty) {
        final firstDevice = devices.first;
        debugPrint('=== FIRST DEVICE STRUCTURE ===');
        debugPrint('Device keys: ${firstDevice.keys.toList()}');
        debugPrint(
          'Has organization: ${firstDevice.containsKey('organization')}',
        );
        debugPrint('Has contract: ${firstDevice.containsKey('contract')}');
        if (firstDevice.containsKey('organization')) {
          debugPrint('Organization data: ${firstDevice['organization']}');
        }
        if (firstDevice.containsKey('contract')) {
          debugPrint('Contract data: ${firstDevice['contract']}');
        }
        debugPrint('Full device: $firstDevice');
        debugPrint('===============================');
      }

      // Тухайн inspection-д хамаарах device-ийг олох
      // widget.item.deviceId нь inspection-ий device ID
      final inspectionDeviceId = widget.item.deviceId?.toString();

      debugPrint('=== FILTERING FOR INSPECTION DEVICE ===');
      debugPrint('Inspection ID: ${widget.item.id}');
      debugPrint('Looking for Device ID: $inspectionDeviceId');

      final targetDevices = devices.where((device) {
        final deviceId = device['id']?.toString();
        return deviceId == inspectionDeviceId;
      }).toList();

      debugPrint('Found ${targetDevices.length} device(s) for inspection');
      for (final device in targetDevices) {
        debugPrint(
          'Target device: ID=${device['id']}, Keys: ${device.keys.toList()}',
        );
      }

      setState(() {
        _availableDevices = targetDevices;
        _loadingDevices = false;
      });
    } catch (e) {
      debugPrint('Error loading available devices: $e');
      setState(() {
        _deviceError = ErrorHandler.handleApiError(e);
        _loadingDevices = false;
        _availableDevices = [];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('Бүртгэлтэй үзлэг'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _buildDeviceBasedUI(),
    );
  }

  // Device-based UI
  Widget _buildDeviceBasedUI() {
    if (_loadingDevices) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Төхөөрөмжийн мэдээлэл ачаалж байна...'),
          ],
        ),
      );
    }

    if (_deviceError.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: Colors.red[300]),
            const SizedBox(height: 16),
            Text(
              _deviceError,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.redAccent),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadAvailableDevices,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }

    if (_availableDevices.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.devices_other, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Төхөөрөмж олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Энэ үзлэгт хамаарах төхөөрөмж байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadAvailableDevices,
              child: const Text('Дахин шалгах'),
            ),
          ],
        ),
      );
    }

    // Device card-уудыг харуулах
    return RefreshIndicator(
      onRefresh: _loadAvailableDevices,
      child: ListView.separated(
        padding: const EdgeInsets.all(16.0),
        itemCount: _availableDevices.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final device = _availableDevices[index];
          return _buildDeviceCard(device);
        },
      ),
    );
  }

  // Device card үүсгэх
  Widget _buildDeviceCard(Map<String, dynamic> device) {
    final deviceId = device['id']?.toString() ?? '';
    final serialNumber = device['serialNumber']?.toString() ?? '';

    // Device мэдээллээс title үүсгэх
    String title = 'Төхөөрөмж ID: $deviceId';

    // Model мэдээлэл байвал нэмэх
    if (device['model'] is Map<String, dynamic>) {
      final model = device['model'] as Map<String, dynamic>;
      final modelName = model['model']?.toString();
      if (modelName != null && modelName.isNotEmpty) {
        title = modelName;
      }
    }

    // Organization + Contract мэдээлэл
    String? organizationInfo;

    // Organization.name авах (organizations биш organization)
    String? organizationName;
    if (device['organization'] is Map<String, dynamic>) {
      final organization = device['organization'] as Map<String, dynamic>;
      organizationName = organization['name']?.toString();
    }

    // Contract.contractName авах (contracts биш contract, contract_name биш contractName)
    String? contractName;
    if (device['contract'] is Map<String, dynamic>) {
      final contract = device['contract'] as Map<String, dynamic>;
      contractName = contract['contractName']?.toString();
    }

    // Organization.name + Contract.contractName нэгтгэх
    List<String> infoParts = [];
    if (organizationName != null && organizationName.isNotEmpty) {
      infoParts.add(organizationName);
    }
    if (contractName != null && contractName.isNotEmpty) {
      infoParts.add(contractName);
    }

    if (infoParts.isNotEmpty) {
      organizationInfo = infoParts.join(' • ');
    }

    debugPrint(
      'Device ID: $deviceId, Serial: $serialNumber, Organization info: $organizationInfo (org: $organizationName, contract: $contractName)',
    );

    return Card(
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          // Дутуу үзлэг байвал сонголт гаргах
          if (_hasIncompleteInspection && _incompleteStatus != null) {
            _showResumeOrStartDialog(device);
          } else {
            // Шинээр эхлэх
            _startNewInspection(device);
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header with icon and title
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: AppColors.centerGradient,
                    ),
                    child: const Icon(
                      Icons.devices,
                      color: Colors.white,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Colors.grey[800],
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Serial: $serialNumber',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey[600],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.play_arrow_rounded,
                    color: AppColors.primary,
                    size: 32,
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Organization + Contract мэдээлэл
              if (organizationInfo != null && organizationInfo.isNotEmpty) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.green[50],
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.green[200]!),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.business, color: Colors.green[600], size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          organizationInfo,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.green[800],
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Start inspection hint
              Container(
                padding: const EdgeInsets.symmetric(
                  vertical: 8,
                  horizontal: 12,
                ),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.touch_app, size: 16, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Text(
                      'Үзлэг эхлүүлэхийн тулд дарна уу',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.primary,
                        fontWeight: FontWeight.w500,
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
  }

  // Show dialog to choose resume or start new
  void _showResumeOrStartDialog(Map<String, dynamic> device) {
    final nextSection = _incompleteStatus?['nextSection'] as String?;
    final answerId = _incompleteStatus?['answerId'] as String?;
    final lastAnsweredAt = _incompleteStatus?['lastAnsweredAt'] as String?;

    // Format date and time - convert from UTC to local timezone
    String? formattedDate;
    if (lastAnsweredAt != null) {
      try {
        // Parse as UTC and convert to local timezone
        final dateTime = DateTime.parse(lastAnsweredAt).toLocal();
        formattedDate = '${dateTime.year}-${dateTime.month.toString().padLeft(2, '0')}-${dateTime.day.toString().padLeft(2, '0')} ${dateTime.hour.toString().padLeft(2, '0')}:${dateTime.minute.toString().padLeft(2, '0')}';
      } catch (e) {
        debugPrint('Error parsing date: $e');
        formattedDate = lastAnsweredAt;
      }
    }

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Үзлэг үргэлжлүүлэх эсвэл шинээр эхлэх'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Progress information
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.blue[50],
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.blue[200]!),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (formattedDate != null)
                        Row(
                          children: [
                            Icon(Icons.access_time, size: 16, color: Colors.blue[700]),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Сүүлд хийсэн: $formattedDate',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.blue[800],
                                ),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
                if (nextSection != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.orange[50],
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.orange[200]!),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.arrow_forward, size: 18, color: Colors.orange[700]),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Дараагийн хэсэг: $nextSection',
                            style: TextStyle(
                              fontSize: 14,
                              color: Colors.orange[900],
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                const Text(
                  'Та юу хийх вэ?',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                _startNewInspection(device);
              },
              child: const Text('Шинээр эхлэх'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                _resumeInspection(device, answerId);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
              ),
              child: const Text('Үргэлжлүүлэх'),
            ),
          ],
        );
      },
    );
  }

  // Start new inspection (new record)
  void _startNewInspection(Map<String, dynamic> device) {
    debugPrint('=== STARTING NEW INSPECTION ===');
    debugPrint('Inspection ID: ${widget.item.id}');
    debugPrint('Device ID: ${device['id']}');
    debugPrint('Device Info: $device');

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InspectionRunPage(
          inspectionId: widget.item.id,
          deviceInfo: device,
          // answerId = null гэдэг нь шинэ мөрнөөс хадгалах гэсэн үг
          answerId: null,
          resumeData: null,
        ),
      ),
    );
  }

  // Resume incomplete inspection (existing record)
  Future<void> _resumeInspection(
    Map<String, dynamic> device,
    String? answerId,
  ) async {
    debugPrint('=== RESUMING INCOMPLETE INSPECTION ===');
    debugPrint('Inspection ID: ${widget.item.id}');
    debugPrint('Answer ID: $answerId');
    debugPrint('Device ID: ${device['id']}');

    try {
      // Get resume data
      final response = await InspectionAPI.getResumeData(widget.item.id);
      
      Map<String, dynamic>? resumeData;
      if (response is Map<String, dynamic>) {
        resumeData = response['data'] ?? response;
      }

      if (mounted) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => InspectionRunPage(
              inspectionId: widget.item.id,
              deviceInfo: device,
              // answerId дамжуулах - энэ нь одоогийн мөрөнд хадгалах гэсэн үг
              answerId: answerId,
              resumeData: resumeData,
            ),
          ),
        );
      }
    } catch (e) {
      debugPrint('❌ Error getting resume data: $e');
      if (mounted) {
        ErrorHandler.showError(context, ErrorHandler.handleApiError(e));
      }
    }
  }
}
