import 'package:flutter/foundation.dart';

/// Centralized application configuration
class AppConfig {
  // ==========================================
  // API CONFIGURATION
  // ==========================================
  // Production server configuration
  static const String _productionServerIp = '192.168.1.54';
  static const int _productionServerPort = 4555;

  // Ngrok configuration
  // Хэрэв ngrok ашиглах бол доорх comment-үүдийг арилгаж URL оруулна
  static const String _ngrokBaseUrl =
      'https://digestible-betsey-aberrantly.ngrok-free.dev';

  /// Check if ngrok URL is configured
  static bool get _isNgrokConfigured {
    return _ngrokBaseUrl.isNotEmpty && _ngrokBaseUrl.startsWith('https://');
  }

  /// Get API base URL - uses ngrok if configured, otherwise falls back to production server
  static String get apiBaseUrl {
    if (_isNgrokConfigured) {
      // Remove trailing slash if present
      return _ngrokBaseUrl.replaceAll(RegExp(r'/$'), '');
    }
    // Use production server directly
    if (kIsWeb) {
      return 'http://localhost:$_productionServerPort';
    }
    return 'http://$_productionServerIp:$_productionServerPort';
  }

  /// API timeout duration (increased for network connectivity issues)
  static const Duration apiTimeout = Duration(seconds: 60);

  /// Enable debug logging
  static const bool enableDebugLogging = kDebugMode;

  /// App version
  static const String appVersion = '1.0.0';

  /// Supported inspection types
  static const List<String> supportedInspectionTypes = [
    'inspection',
    'maintenance',
    'installation',
  ];

  /// Default page size for lists
  static const int defaultPageSize = 20;

  /// Maximum image file size in bytes (5MB)
  static const int maxImageFileSize = 5 * 1024 * 1024;

  /// Supported image formats
  static const List<String> supportedImageFormats = [
    'jpg',
    'jpeg',
    'png',
    'webp',
  ];

  /// FTP configuration
  static const String ftpHost = '192.168.1.54';
  static const int ftpPort = 2121;
  static const String ftpUser = 'test';
  static const String ftpPassword = 'T3st!234';

  /// Remote directory inside FTP server where images are stored.
  /// Keep leading slash for clarity; the upload service will handle fallbacks.
  static const String ftpRemoteDirectory = '/ftp/test';

  /// Public-facing base URL for referencing uploaded images.
  /// Images are served via HTTP through the backend /uploads endpoint
  static String get ftpPublicBaseUrl {
    final base = apiBaseUrl;
    // Ensure /uploads path is added for image serving
    return '$base/uploads';
  }

  /// Timeout for FTP operations (increased for USB/network connections)
  static const Duration ftpTimeout = Duration(seconds: 60);
}
