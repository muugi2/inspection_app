import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

/// Centralized error handling utilities
class ErrorHandler {
  /// Show error snackbar
  static void showError(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  /// Show success snackbar
  static void showSuccess(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  /// Show info snackbar
  static void showInfo(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.blue,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  /// Handle API errors and return user-friendly message
  static String handleApiError(dynamic error) {
    if (error is DioException) {
      // Check for internet connection issues first
      if (error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.sendTimeout ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.connectionError ||
          (error.response == null && error.type != DioExceptionType.badResponse)) {
        return 'Интернет холболтоо шалгана уу';
      }

      final statusCode = error.response?.statusCode;
      final serverMessage = _extractServerMessage(error.response?.data);

      switch (statusCode) {
        case 401:
          return serverMessage ?? 'Нэвтрэх эрх шаардлагатай';
        case 403:
          return serverMessage ?? 'Энэ үйлдлийг хийх эрх байхгүй';
        case 404:
          return serverMessage ?? 'Хүссэн мэдээлэл олдсонгүй';
        case 409:
          return serverMessage ??
              'Энэ талбарт аль хэдийн зураг байна. Өмнөх зургийг устгана уу.';
        case 500:
          return serverMessage ?? 'Серверийн алдаа гарлаа';
        default:
          if (statusCode != null) {
            return serverMessage ?? 'Серверийн алдаа гарлаа (код: $statusCode)';
          }
      }
    }

    final errorStr = error.toString();
    if (errorStr.contains('SocketException') ||
        errorStr.contains('Failed host lookup') ||
        errorStr.contains('Network is unreachable') ||
        errorStr.contains('No address associated with hostname')) {
      return 'Интернет холболтоо шалгана уу';
    }
    if (errorStr.contains('TimeoutException') ||
        errorStr.contains('Timeout')) {
      return 'Интернет холболтоо шалгана уу';
    }
    if (errorStr.contains('409')) {
      return 'Энэ талбарт аль хэдийн зураг байна. Өмнөх зургийг устгана уу.';
    }
    if (errorStr.contains('401')) {
      return 'Нэвтрэх эрх шаардлагатай';
    }
    if (errorStr.contains('403')) {
      return 'Энэ үйлдлийг хийх эрх байхгүй';
    }
    if (errorStr.contains('404')) {
      return 'Хүссэн мэдээлэл олдсонгүй';
    }
    if (errorStr.contains('500')) {
      return 'Серверийн алдаа гарлаа';
    }
    return 'Алдаа гарлаа: ${error.toString()}';
  }

  static String? _extractServerMessage(dynamic data) {
    if (data == null) return null;
    if (data is String && data.isNotEmpty) return data;
    if (data is Map) {
      final message = data['message'];
      final errorMsg = data['error'];
      if (message is String && message.isNotEmpty) return message;
      if (errorMsg is String && errorMsg.isNotEmpty) return errorMsg;
    }
    return null;
  }

  /// Show loading dialog
  static void showLoading(BuildContext context, {String? message}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        content: Row(
          children: [
            const CircularProgressIndicator(),
            const SizedBox(width: 16),
            Text(message ?? 'Ачаалж байна...'),
          ],
        ),
      ),
    );
  }

  /// Hide loading dialog
  static void hideLoading(BuildContext context) {
    Navigator.of(context).pop();
  }
}
