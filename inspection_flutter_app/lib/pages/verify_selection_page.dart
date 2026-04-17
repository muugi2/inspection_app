import 'package:flutter/material.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/pages/verify_page.dart';
import 'package:app/services/api.dart';
import 'package:app/services/api.dart' as api_service;

class VerifySelectionPage extends StatefulWidget {
  const VerifySelectionPage({super.key});

  @override
  State<VerifySelectionPage> createState() => _VerifySelectionPageState();
}

class _VerifySelectionPageState extends State<VerifySelectionPage> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _verifications = [];

  @override
  void initState() {
    super.initState();
    _loadVerifications();
  }

  Future<void> _loadVerifications() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      debugPrint('=== LOADING VERIFICATIONS ===');
      
      // Get current user ID
      final user = await api_service.AuthAPI.getCurrentUser();
      if (user == null || user['id'] == null) {
        throw Exception('Хэрэглэгчийн мэдээлэл олдсонгүй');
      }

      final userId = user['id'].toString();
      debugPrint('Current user ID: $userId');

      // Get verifications for current user
      final response = await VerificationAPI.getByUser(userId);
      
      debugPrint('Response type: ${response.runtimeType}');
      debugPrint('Response: $response');
      
      List<Map<String, dynamic>> verifications = [];
      
      // Parse response
      if (response is Map<String, dynamic>) {
        debugPrint('Response is Map, keys: ${response.keys}');
        final data = response['data'] ?? response['items'] ?? response['result'] ?? response['rows'];
        debugPrint('Data type: ${data.runtimeType}');
        debugPrint('Data: $data');
        
        if (data is List) {
          debugPrint('Data is List, length: ${data.length}');
          verifications = data.cast<Map<String, dynamic>>();
        } else if (data != null) {
          debugPrint('Data is not a List, trying to convert...');
        }
      } else if (response is List) {
        debugPrint('Response is List, length: ${response.length}');
        verifications = response.cast<Map<String, dynamic>>();
      } else {
        debugPrint('Unexpected response type: ${response.runtimeType}');
      }

      // Filter for PENDING and IN_PROGRESS status
      verifications = verifications.where((verification) {
        final status = verification['status']?.toString().toUpperCase() ?? '';
        return status == 'PENDING' || status == 'IN_PROGRESS';
      }).toList();

      // Group by title to show unique verifications
      final Map<String, Map<String, dynamic>> groupedVerifications = {};
      for (var verification in verifications) {
        final title = verification['title']?.toString() ?? 'Тодорхойгүй';
        if (!groupedVerifications.containsKey(title)) {
          groupedVerifications[title] = {
            'title': title,
            'verifications': <Map<String, dynamic>>[],
          };
        }
        groupedVerifications[title]!['verifications']!.add(verification);
      }

      final uniqueVerifications = groupedVerifications.values.toList();

      debugPrint('Found ${uniqueVerifications.length} unique verification titles');
      for (var verification in uniqueVerifications) {
        debugPrint('  - ${verification['title']} (${verification['verifications']!.length} verification(s))');
      }
      
      setState(() {
        _verifications = uniqueVerifications;
      });
    } catch (e) {
      debugPrint('Error loading verifications: $e');
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

  void _onTitleTap(Map<String, dynamic> verification) {
    final title = verification['title']?.toString() ?? 'Тодорхойгүй';
    // Get first verification ID (all verifications in the group have the same title)
    final firstVerification = verification['verifications'] as List<Map<String, dynamic>>?;
    final verificationId = firstVerification?.isNotEmpty == true 
        ? firstVerification![0]['id']?.toString() 
        : null;
    
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VerifyPage(
          title: title,
          verificationId: verificationId,
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
              onPressed: _loadVerifications,
              child: const Text('Дахин ачаалах'),
            ),
          ],
        ),
      );
    }

    if (_verifications.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.verified_user_outlined, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              'Баталгаажуулалт олдсонгүй',
              style: TextStyle(fontSize: 18, color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              'Одоогоор баталгаажуулах ажил байхгүй байна',
              style: TextStyle(fontSize: 14, color: Colors.grey[500]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadVerifications,
              child: const Text('Дахин шалгах'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadVerifications,
      child: ListView.separated(
        padding: const EdgeInsets.all(16.0),
        itemCount: _verifications.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final verification = _verifications[index];
          final title = verification['title']?.toString() ?? 'Тодорхойгүй';
          final verifications = verification['verifications'] as List<Map<String, dynamic>>? ?? [];
          final count = verifications.length;

          return Card(
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => _onTitleTap(verification),
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
                        Icons.verified_user,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (count > 0)
                            Text(
                              '$count баталгаажуулалт',
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey[600],
                              ),
                            ),
                        ],
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
}
