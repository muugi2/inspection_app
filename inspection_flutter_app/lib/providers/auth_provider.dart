import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:app/services/api.dart';
import 'package:app/utils/error_handler.dart';

/// Centralized authentication state management
class AuthProvider extends ChangeNotifier {
  Map<String, dynamic>? _currentUser;
  String? _authToken;
  bool _isLoading = false;
  String? _error;

  // Getters
  Map<String, dynamic>? get currentUser => _currentUser;
  String? get authToken => _authToken;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _authToken != null && _authToken!.isNotEmpty;

  /// Initialize auth state from stored data
  Future<void> initialize() async {
    _isLoading = true;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      _authToken = prefs.getString('authToken');

      final userStr = prefs.getString('user');
      if (userStr != null) {
        _currentUser = jsonDecode(userStr) as Map<String, dynamic>;
      }
    } catch (e) {
      _error = 'Failed to initialize auth: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Login user
  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await AuthAPI.login(email, password);
      final data = response['data'] as Map<String, dynamic>?;

      if (data != null) {
        _authToken = data['token'] as String?;
        _currentUser = data['user'] as Map<String, dynamic>?;

        // Store in SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        if (_authToken != null) {
          await prefs.setString('authToken', _authToken!);
        }
        if (_currentUser != null) {
          await prefs.setString('user', jsonEncode(_currentUser));
        }

        return true;
      }
      return false;
    } catch (e) {
      _error = _friendlyLoginError(e);
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  String _friendlyLoginError(dynamic error) {
    if (error is DioException) {
      final statusCode = error.response?.statusCode;
      final serverMessage = ErrorHandler.handleApiError(error);
      final rawMessage = _extractMessage(error.response?.data);

      if (statusCode == 401) {
        if (rawMessage != null &&
            rawMessage.toLowerCase().contains('email or password')) {
          return 'Имэйл эсвэл нууц үг буруу байна.';
        }
        return 'Нэвтрэх мэдээлэл буруу байна.';
      }

      if (statusCode == 403) {
        // Account disabled error
        if (rawMessage != null &&
            (rawMessage.toLowerCase().contains('disabled') ||
                rawMessage.toLowerCase().contains('account'))) {
          return 'Таны бүртгэл идэвхгүй байна. Админтай холбогдоно уу.';
        }
        return rawMessage ?? 'Энэ үйлдлийг хийх эрх байхгүй.';
      }

      if (statusCode == 404) {
        return 'И-мэйл бүртгэлгүй байна.';
      }

      return serverMessage;
    }

    return ErrorHandler.handleApiError(error);
  }

  String? _extractMessage(dynamic data) {
    if (data is Map && data['message'] is String) {
      return data['message'] as String;
    }
    if (data is String && data.isNotEmpty) {
      return data;
    }
    return null;
  }

  /// Register user
  Future<bool> register(Map<String, dynamic> userData) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await AuthAPI.register(userData);
      final data = response['data'] as Map<String, dynamic>?;

      if (data != null) {
        _authToken = data['token'] as String?;
        _currentUser = data['user'] as Map<String, dynamic>?;

        // Store in SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        if (_authToken != null) {
          await prefs.setString('authToken', _authToken!);
        }
        if (_currentUser != null) {
          await prefs.setString('user', jsonEncode(_currentUser));
        }

        return true;
      }
      return false;
    } catch (e) {
      _error = 'Registration failed: $e';
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Logout user
  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    try {
      await AuthAPI.logout();
    } catch (e) {
      // Continue with logout even if API call fails
    } finally {
      _currentUser = null;
      _authToken = null;
      _error = null;
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Clear error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  /// Get user's full name
  String getUserFullName() {
    if (_currentUser == null) return 'Current User';

    String? fullName = _currentUser!['fullName']?.toString();
    if (fullName == null || fullName.isEmpty) {
      fullName = _currentUser!['full_name']?.toString();
    }

    return fullName ?? 'Current User';
  }
}
