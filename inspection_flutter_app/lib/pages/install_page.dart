import 'package:flutter/material.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/install_type_selection_page.dart';
import 'package:app/services/api.dart';
import 'package:app/services/api.dart' as api_service;

class InstallPage extends StatefulWidget {
  const InstallPage({super.key});

  @override
  State<InstallPage> createState() => _InstallPageState();
}

class _InstallPageState extends State<InstallPage> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _assignments = [];

  @override
  void initState() {
    super.initState();
    _loadAssignments();
  }

  Future<void> _loadAssignments() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      debugPrint('=== LOADING INSTALLATION ASSIGNMENTS ===');
      
      // Get current user ID
      final user = await api_service.AuthAPI.getCurrentUser();
      if (user == null || user['id'] == null) {
        throw Exception('Хэрэглэгчийн мэдээлэл олдсонгүй');
      }

      final userId = user['id'].toString();
      debugPrint('Current user ID: $userId');

      // Get installation assignments for current user
      final response = await InstallationAssignmentAPI.getByUser(userId);
      
      debugPrint('Response type: ${response.runtimeType}');
      debugPrint('Response: $response');
      
      List<Map<String, dynamic>> assignments = [];
      
      // Parse response
      if (response is Map<String, dynamic>) {
        debugPrint('Response is Map, keys: ${response.keys}');
        final data = response['data'] ?? response['items'] ?? response['result'] ?? response['rows'];
        debugPrint('Data type: ${data.runtimeType}');
        debugPrint('Data: $data');
        
        if (data is List) {
          debugPrint('Data is List, length: ${data.length}');
          assignments = data.cast<Map<String, dynamic>>();
        } else if (data != null) {
          debugPrint('Data is not a List, trying to convert...');
        }
      } else if (response is List) {
        debugPrint('Response is List, length: ${response.length}');
        assignments = response.cast<Map<String, dynamic>>();
      } else {
        debugPrint('Unexpected response type: ${response.runtimeType}');
      }

      // Filter for PENDING and IN_PROGRESS status
      assignments = assignments.where((assignment) {
        final status = assignment['status']?.toString().toUpperCase() ?? '';
        return status == 'PENDING' || status == 'IN_PROGRESS';
      }).toList();

      // Group by organization first, then by title
      // Structure: {orgId: {orgName: '...', titles: {title: {...}}}}
      final Map<String, Map<String, dynamic>> groupedByOrg = {};
      
      for (var assignment in assignments) {
        final orgId = assignment['orgId']?.toString() ?? 'unknown';
        final orgName = assignment['orgName']?.toString() ?? 'Тодорхойгүй байгууллага';
        final title = assignment['title']?.toString() ?? 'Тодорхойгүй';
        
        // Initialize organization if not exists
        if (!groupedByOrg.containsKey(orgId)) {
          groupedByOrg[orgId] = {
            'orgId': orgId,
            'orgName': orgName,
            'titles': <String, Map<String, dynamic>>{},
          };
        }
        
        // Initialize title if not exists
        if (!groupedByOrg[orgId]!['titles']!.containsKey(title)) {
          groupedByOrg[orgId]!['titles']![title] = {
            'title': title,
            'assignments': <Map<String, dynamic>>[],
            'templates': <Map<String, dynamic>>[],
          };
        }
        
        // Add assignment to title
        groupedByOrg[orgId]!['titles']![title]!['assignments']!.add(assignment);
        
        // Collect template IDs for this assignment
        final templateId = assignment['templateId']?.toString();
        final templateName = assignment['templateName']?.toString();
        if (templateId != null && templateName != null) {
          final templates = groupedByOrg[orgId]!['titles']![title]!['templates'] as List<Map<String, dynamic>>;
          final existingTemplate = templates.firstWhere(
            (t) => t['id'] == templateId,
            orElse: () => <String, dynamic>{},
          );
          if (existingTemplate.isEmpty) {
            templates.add({
              'id': templateId,
              'name': templateName,
              'deviceType': assignment['deviceType']?.toString(),
            });
          }
        }
      }

      // Convert to list format: [{orgId, orgName, titles: [{title, templates, assignments}]}]
      final uniqueAssignments = groupedByOrg.values.map((org) {
        final titles = org['titles'] as Map<String, Map<String, dynamic>>;
        return {
          'orgId': org['orgId'],
          'orgName': org['orgName'],
          'titles': titles.values.toList(),
        };
      }).toList();

      debugPrint('Found ${uniqueAssignments.length} organizations with installation assignments');
      for (var org in uniqueAssignments) {
        final orgName = org['orgName']?.toString() ?? 'Тодорхойгүй';
        final titles = org['titles'] as List<Map<String, dynamic>>? ?? [];
        debugPrint('  - $orgName (${titles.length} titles)');
      }
      
      setState(() {
        _assignments = uniqueAssignments;
      });
    } catch (e) {
      debugPrint('Error loading assignments: $e');
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

  void _onTitleTap(Map<String, dynamic> titleData, String orgId, String orgName) {
    final title = titleData['title']?.toString() ?? 'Тодорхойгүй';
    final templates = titleData['templates'] as List<Map<String, dynamic>>? ?? [];
    // Get first assignment ID (all assignments in the group have the same title)
    final firstAssignment = titleData['assignments'] as List<Map<String, dynamic>>?;
    final assignmentId = firstAssignment?.isNotEmpty == true 
        ? firstAssignment![0]['id']?.toString() 
        : null;
    
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => InstallTypeSelectionPage(
          parentSection: title,
          assignmentTemplates: templates,
          assignmentId: assignmentId,
          orgId: orgId,
          title: title,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: double.infinity,
      color: Colors.grey[50],
      child: _buildBody(),
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
              onPressed: _loadAssignments,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }

    if (_assignments.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.assignment, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Томилолт олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Одоогоор танд томилогдсон суурьлуулалт байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadAssignments,
              child: const Text('Дахин шалгах'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadAssignments,
      child: ListView.separated(
        padding: const EdgeInsets.all(16.0),
        itemCount: _assignments.length,
        separatorBuilder: (_, __) => const SizedBox(height: 16),
        itemBuilder: (context, index) {
          final orgData = _assignments[index];
          final orgName = orgData['orgName']?.toString() ?? 'Тодорхойгүй байгууллага';
          final titles = orgData['titles'] as List<Map<String, dynamic>>? ?? [];

          return Card(
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            child: ExpansionTile(
              leading: Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppColors.centerGradient,
                ),
                child: const Icon(
                  Icons.business,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              title: Text(
                orgName,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                '${titles.length} гарчиг',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey[600],
                ),
              ),
              children: titles.map((titleData) {
                final title = titleData['title']?.toString() ?? 'Тодорхойгүй';
                final templates = titleData['templates'] as List<Map<String, dynamic>>? ?? [];
                final templateCount = templates.length;

                return ListTile(
                  leading: const Icon(
                    Icons.label_outline,
                    color: AppColors.textSecondary,
                  ),
                  title: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  subtitle: templateCount > 0
                      ? Text(
                          '$templateCount template',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey[600],
                          ),
                        )
                      : null,
                  trailing: const Icon(
                    Icons.arrow_forward_ios,
                    color: AppColors.textSecondary,
                    size: 16,
                  ),
                  onTap: () => _onTitleTap(titleData, orgData['orgId']?.toString() ?? '', orgName),
                );
              }).toList(),
            ),
          );
        },
      ),
    );
  }
}
