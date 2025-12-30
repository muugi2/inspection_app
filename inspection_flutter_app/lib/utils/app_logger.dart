import 'package:flutter/foundation.dart';

/// Centralized logging utility for better performance
class AppLogger {
  /// Log debug messages only in debug mode
  static void debug(String message) {
    if (kDebugMode) {
      debugPrint('🔍 DEBUG: $message');
    }
  }

  /// Log info messages
  static void info(String message) {
    if (kDebugMode) {
      debugPrint('ℹ️ INFO: $message');
    }
  }

  /// Log warning messages
  static void warning(String message) {
    if (kDebugMode) {
      debugPrint('⚠️ WARNING: $message');
    }
  }

  /// Log error messages
  static void error(String message) {
    if (kDebugMode) {
      debugPrint('❌ ERROR: $message');
    }
  }

  /// Log API calls with structured format
  static void apiCall(
    String method,
    String endpoint, {
    Map<String, dynamic>? data,
  }) {
    if (kDebugMode) {
      debugPrint('🌐 API $method: $endpoint');
      if (data != null) {
        debugPrint('📦 Data: $data');
      }
    }
  }

  /// Log API responses
  static void apiResponse(String endpoint, int statusCode, {dynamic data}) {
    if (kDebugMode) {
      debugPrint('📡 Response $statusCode: $endpoint');
      if (data != null) {
        debugPrint('📦 Response Data: $data');
      }
    }
  }

  /// Log performance metrics
  static void performance(String operation, Duration duration) {
    if (kDebugMode) {
      debugPrint('⚡ PERFORMANCE: $operation took ${duration.inMilliseconds}ms');
    }
  }
}







































