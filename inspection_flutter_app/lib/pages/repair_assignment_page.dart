import 'package:flutter/material.dart';
import 'package:app/services/api.dart';
import 'package:app/assets/app_colors.dart';
import 'package:app/utils/error_handler.dart';
import 'package:app/pages/repair_assignment_detail_page.dart';

class RepairAssignmentPage extends StatefulWidget {
  const RepairAssignmentPage({super.key});

  @override
  State<RepairAssignmentPage> createState() => _RepairAssignmentPageState();
}

class _RepairAssignmentPageState extends State<RepairAssignmentPage> {
  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _assignments = [];

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
      debugPrint('🔍 Loading repair assignments (MAINTENANCE inspections)...');
      final response = await InspectionAPI.getAssignedByType('MAINTENANCE');
      debugPrint('✅ Response received');

      final data = response['data'] ?? [];
      final List<Map<String, dynamic>> assignments = [];

      for (var item in data) {
        if (item is Map<String, dynamic>) {
          assignments.add(item);
        }
      }

      setState(() {
        _assignments = assignments;
        _loading = false;
      });

      debugPrint('✅ Loaded ${assignments.length} repair assignment(s)');
    } catch (e) {
      debugPrint('❌ Error loading repair assignments: $e');
      setState(() {
        _error = ErrorHandler.handleApiError(e);
        _loading = false;
      });
    }
  }

  void _onTap(Map<String, dynamic> assignment) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RepairAssignmentDetailPage(
          inspectionId: assignment['id']?.toString() ?? '',
          assignment: assignment,
        ),
      ),
    );
  }

  String _buildSubtitle(Map<String, dynamic> assignment) {
    List<String> parts = [];

    final site = assignment['site'] as Map<String, dynamic>?;
    if (site != null && site['name'] != null) {
      parts.add(site['name'].toString());
    }

    final device = assignment['device'] as Map<String, dynamic>?;
    if (device != null) {
      final model = device['model'] as Map<String, dynamic>?;
      if (model != null) {
        final manufacturer = model['manufacturer']?.toString();
        final modelName = model['model']?.toString();
        if (manufacturer != null && modelName != null) {
          parts.add('$manufacturer $modelName');
        }
      }
    } else {
      parts.add('Төхөөрөмж сонгоогүй');
    }

    if (parts.isEmpty) {
      return 'Мэдээлэл оруулаагүй';
    }

    return parts.join(' • ');
  }

  Widget _buildAssignmentCard(Map<String, dynamic> assignment) {
    final title = assignment['title']?.toString() ?? 'Засварын томилолт';
    final status = assignment['status']?.toString() ?? 'DRAFT';

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
        onPressed: () => _onTap(assignment),
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
                Icons.assignment,
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
                    _buildSubtitle(assignment),
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
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: status == 'DRAFT' 
                    ? Colors.orange.withOpacity(0.1)
                    : Colors.blue.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                status == 'DRAFT' ? 'Ноорог' : status,
                style: TextStyle(
                  fontSize: 10,
                  color: status == 'DRAFT' ? Colors.orange : Colors.blue,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 8),
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

    if (_assignments.isEmpty) {
      return const Center(
        child: Text('Одоогоор засварын томилолт алга.'),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 100),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                'Засварын томилолт',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _assignments.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  return _buildAssignmentCard(_assignments[index]);
                },
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
