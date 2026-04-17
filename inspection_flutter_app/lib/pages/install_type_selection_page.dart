import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/install_section_page.dart';
import 'package:app/services/api.dart';
import 'package:app/providers/auth_provider.dart';

class InstallTypeSelectionPage extends StatefulWidget {
  final String? parentSection;
  final List<Map<String, dynamic>>? assignmentTemplates;
  final String? assignmentId; // Assignment ID for saving data
  final String? orgId; // Organization ID
  final String? title; // Title (пүү-1, пүү-2, etc.)

  const InstallTypeSelectionPage({
    super.key,
    this.parentSection,
    this.assignmentTemplates,
    this.assignmentId,
    this.orgId,
    this.title,
  });

  @override
  State<InstallTypeSelectionPage> createState() => _InstallTypeSelectionPageState();
}

class _InstallTypeSelectionPageState extends State<InstallTypeSelectionPage> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _templates = [];
  bool _isCreatingVerification = false;

  @override
  void initState() {
    super.initState();
    _loadTemplates();
  }

  Future<void> _loadTemplates() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      // If assignment templates are provided, use them directly
      if (widget.assignmentTemplates != null && widget.assignmentTemplates!.isNotEmpty) {
        debugPrint('=== USING ASSIGNMENT TEMPLATES ===');
        debugPrint('Assignment templates count: ${widget.assignmentTemplates!.length}');
        
        // Fetch full template details for each assignment template
        List<Map<String, dynamic>> templates = [];
        for (var assignmentTemplate in widget.assignmentTemplates!) {
          try {
            final templateId = assignmentTemplate['id']?.toString();
            debugPrint('Loading template ID: $templateId');
            if (templateId != null) {
              final templateResponse = await SettlementTemplateAPI.getById(templateId);
              debugPrint('Template response type: ${templateResponse.runtimeType}');
              debugPrint('Template response: $templateResponse');
              
              if (templateResponse is Map<String, dynamic>) {
                final templateData = templateResponse['data'] ?? templateResponse;
                debugPrint('Template data type: ${templateData.runtimeType}');
                debugPrint('Template data keys: ${templateData is Map ? templateData.keys : 'N/A'}');
                
                if (templateData is Map<String, dynamic>) {
                  // Check if questions field exists
                  final questions = templateData['questions'];
                  debugPrint('Template questions type: ${questions.runtimeType}');
                  debugPrint('Template questions: $questions');
                  
                  templates.add(templateData);
                  debugPrint('✅ Added template: ${templateData['name']} (ID: ${templateData['id']})');
                }
              }
            }
          } catch (e) {
            debugPrint('❌ Error loading template ${assignmentTemplate['id']}: $e');
            debugPrint('Error stack: ${StackTrace.current}');
            // If we can't load the template, use the assignment template data
            templates.add(assignmentTemplate);
          }
        }
        
        debugPrint('Loaded ${templates.length} templates from assignments');
        for (var template in templates) {
          debugPrint('  - ${template['name']} (ID: ${template['id']})');
          debugPrint('    Questions: ${template['questions']}');
        }
        setState(() {
          _templates = templates;
        });
        return;
      }

      // Otherwise, load all templates (fallback for backward compatibility)
      debugPrint('=== LOADING SETTLEMENT TEMPLATES ===');
      final response = await SettlementTemplateAPI.getAll();
      
      debugPrint('Response type: ${response.runtimeType}');
      debugPrint('Response: $response');
      
      List<Map<String, dynamic>> templates = [];
      
      // Parse response
      if (response is Map<String, dynamic>) {
        debugPrint('Response is Map, keys: ${response.keys}');
        final data = response['data'] ?? response['items'] ?? response['result'] ?? response['rows'];
        debugPrint('Data type: ${data.runtimeType}');
        debugPrint('Data: $data');
        
        if (data is List) {
          debugPrint('Data is List, length: ${data.length}');
          templates = data.cast<Map<String, dynamic>>();
        } else if (data != null) {
          debugPrint('Data is not a List, trying to convert...');
        }
      } else if (response is List) {
        debugPrint('Response is List, length: ${response.length}');
        templates = response.cast<Map<String, dynamic>>();
      } else {
        debugPrint('Unexpected response type: ${response.runtimeType}');
      }

      debugPrint('Templates before filtering: ${templates.length}');

      // Filter for slab_base and ramp device types
      templates = templates.where((template) {
        final deviceType = template['deviceType']?.toString().toLowerCase() ?? 
                          template['device_type']?.toString().toLowerCase() ?? '';
        debugPrint('Template: ${template['name']}, deviceType: $deviceType');
        return deviceType == 'slab_base' || deviceType == 'ramp';
      }).toList();

      debugPrint('Templates after filtering: ${templates.length}');

      // Sort templates: slab_base first, then ramp
      templates.sort((a, b) {
        final aType = a['deviceType']?.toString().toLowerCase() ?? 
                      a['device_type']?.toString().toLowerCase() ?? '';
        final bType = b['deviceType']?.toString().toLowerCase() ?? 
                      b['device_type']?.toString().toLowerCase() ?? '';
        if (aType == 'slab_base' && bType != 'slab_base') return -1;
        if (aType != 'slab_base' && bType == 'slab_base') return 1;
        return aType.compareTo(bType);
      });

      debugPrint('Found ${templates.length} settlement templates');
      for (var template in templates) {
        debugPrint('  - ${template['name']} (deviceType: ${template['deviceType'] ?? template['device_type']})');
      }
      
      setState(() {
        _templates = templates;
      });
    } catch (e) {
      debugPrint('Error loading templates: $e');
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

  String _getDeviceTypeLabel(Map<String, dynamic> template) {
    final deviceType = template['deviceType']?.toString().toLowerCase() ?? 
                      template['device_type']?.toString().toLowerCase() ?? '';
    switch (deviceType) {
      case 'slab_base':
        return 'Нил суурь';
      case 'ramp':
        return 'Налуу зам';
      default:
        return deviceType.isNotEmpty ? deviceType : 'Тодорхойгүй';
    }
  }

  void _onTypeSelected(Map<String, dynamic> template) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InstallSectionPage(
          template: template,
          assignmentId: widget.assignmentId,
          orgId: widget.orgId,
          title: widget.title,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text(widget.parentSection ?? 'Суурьлуулалтын төрөл сонгох'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0.5,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          if (widget.orgId != null && widget.title != null)
            Padding(
              padding: const EdgeInsets.only(right: 8.0),
              child: ElevatedButton.icon(
                onPressed: _isCreatingVerification ? null : _createVerification,
                icon: _isCreatingVerification
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : const Icon(Icons.check_circle, size: 18),
                label: const Text(
                  'Суурьлуулалт дуусгах, баталгаажуулалт эхлэх',
                  style: TextStyle(fontSize: 12),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                ),
              ),
            ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
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

    if (_error.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: Colors.red[300]),
            const SizedBox(height: 16),
            Text(
              _error,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.redAccent),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadTemplates,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }

    if (_templates.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.construction, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Суурьлуулалтын template олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Одоогоор бэлэн template байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadTemplates,
              child: const Text('Дахин шалгах'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadTemplates,
      child: ListView.separated(
        padding: const EdgeInsets.all(16.0),
        itemCount: _templates.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final template = _templates[index];
          final label = _getDeviceTypeLabel(template);

          return Card(
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => _onTypeSelected(template),
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
                        Icons.construction,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        label,
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
      ),
    );
  }

  Future<void> _createVerification() async {
    if (widget.orgId == null || widget.title == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Шаардлагатай мэдээлэл дутуу байна'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    // Get current user ID
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final user = authProvider.currentUser;
    if (user == null || user['id'] == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Хэрэглэгчийн мэдээлэл олдсонгүй'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final userId = user['id'].toString();

    setState(() {
      _isCreatingVerification = true;
    });

    try {
      // Create verification
      await VerificationAPI.create(
        orgId: widget.orgId!,
        title: widget.title!,
        userIds: [userId],
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Баталгаажуулалт амжилттай үүсгэгдлээ'),
            backgroundColor: Colors.green,
          ),
        );

        // Navigate back to dashboard
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      debugPrint('❌ Error creating verification: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Баталгаажуулалт үүсгэхэд алдаа гарлаа: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isCreatingVerification = false;
        });
      }
    }
  }
}
