import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:app/config/app_config.dart';
import 'package:path/path.dart' as path;

// Dio instance with centralized configuration
final Dio api = Dio(
  BaseOptions(
    baseUrl: AppConfig.apiBaseUrl,
    connectTimeout: AppConfig.apiTimeout,
    receiveTimeout: AppConfig.apiTimeout,
    headers: {"Content-Type": "application/json"},
  ),
);

// Interceptors
void setupInterceptors() {
  api.interceptors.clear();
  api.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        try {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('authToken');
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
        } catch (e) {
          debugPrint('Token read error: $e');
        }
        return handler.next(options);
      },
      onError: (error, handler) async {
        // Dio 5.0+ uses DioException instead of DioError
        if (error.response?.statusCode == 401) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('authToken');
          await prefs.remove('user');
        }
        return handler.next(error);
      },
    ),
  );
  api.interceptors.add(
    LogInterceptor(
      request: true,
      requestBody: true,
      responseBody: true,
      responseHeader: false,
      error: true,
      requestHeader: false,
    ),
  );
}

// Auth API methods
class AuthAPI {
  static Future<Map<String, dynamic>> login(
    String email,
    String password,
  ) async {
    try {
      final response = await api.post(
        "/api/auth/login",
        data: {"email": email, "password": password},
      );
      final data = response.data as Map<String, dynamic>;
      final token = data['data']?['token'] as String?;
      final user = data['data']?['user'];
      final prefs = await SharedPreferences.getInstance();
      if (token != null) {
        await prefs.setString('authToken', token);
      }
      if (user != null) {
        await prefs.setString('user', jsonEncode(user));
      }
      return data;
    } catch (e) {
      rethrow;
    }
  }

  static Future<Map<String, dynamic>> register(
    Map<String, dynamic> userData,
  ) async {
    try {
      final response = await api.post("/api/auth/register", data: userData);
      final data = response.data as Map<String, dynamic>;
      final token = data['data']?['token'] as String?;
      final user = data['data']?['user'];
      final prefs = await SharedPreferences.getInstance();
      if (token != null) {
        await prefs.setString('authToken', token);
      }
      if (user != null) {
        await prefs.setString('user', jsonEncode(user));
      }
      return data;
    } catch (e) {
      rethrow;
    }
  }

  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('authToken');
    await prefs.remove('user');
  }

  static Future<Map<String, dynamic>> verify() async {
    final response = await api.get("/api/auth/verify");
    return (response.data as Map<String, dynamic>);
  }

  static Future<Map<String, dynamic>?> getCurrentUser() async {
    final prefs = await SharedPreferences.getInstance();
    final userStr = prefs.getString('user');
    if (userStr == null) return null;
    try {
      return jsonDecode(userStr) as Map<String, dynamic>;
    } catch (e) {
      debugPrint('User decode error: $e');
      return null;
    }
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('authToken');
  }
}

// User API methods
class UserAPI {
  static Future<dynamic> getAll() async {
    final response = await api.get("/api/users/");
    return response.data;
  }

  static Future<dynamic> getById(String id) async {
    final response = await api.get("/api/users/$id");
    return response.data;
  }

  static Future<dynamic> getProfile() async {
    final response = await api.get("/api/users/profile");
    return response.data;
  }

  static Future<dynamic> create(Map<String, dynamic> userData) async {
    final response = await api.post("/api/users/", data: userData);
    return response.data;
  }

  static Future<dynamic> update(
    String id,
    Map<String, dynamic> userData,
  ) async {
    final response = await api.put("/api/users/$id", data: userData);
    return response.data;
  }

  static Future<dynamic> delete(String id) async {
    final response = await api.delete("/api/users/$id");
    return response.data;
  }
}

// Inspection API methods
class InspectionAPI {
  static Future<dynamic> getAll() async {
    final response = await api.get("/api/inspections");
    return response.data;
  }

  // Helper method to try different endpoints for final submission
  static Future<dynamic> submitFinalInspection(
    String inspectionId,
    Map<String, dynamic> payload, {
    String endpoint = '',
    String method = 'POST',
  }) async {
    final String path = endpoint.isEmpty
        ? "/api/inspections/$inspectionId"
        : "/api/inspections/$inspectionId/$endpoint";

    if (method == 'PUT') {
      final response = await api.put(path, data: payload);
      return response.data;
    } else {
      final response = await api.post(path, data: payload);
      return response.data;
    }
  }

  static Future<dynamic> getById(String id) async {
    final response = await api.get("/api/inspections/$id");
    return response.data;
  }

  static Future<dynamic> create(Map<String, dynamic> inspectionData) async {
    final response = await api.post("/api/inspections", data: inspectionData);
    return response.data;
  }

  static Future<dynamic> update(
    String id,
    Map<String, dynamic> inspectionData,
  ) async {
    final response = await api.put(
      "/api/inspections/$id",
      data: inspectionData,
    );
    return response.data;
  }

  static Future<dynamic> delete(String id) async {
    final response = await api.delete("/api/inspections/$id");
    return response.data;
  }

  static Future<dynamic> getAssigned() async {
    final response = await api.get("/api/inspections/assigned");
    return response.data;
  }

  static Future<dynamic> getAssignedByType(String type) async {
    final response = await api.get(
      "/api/inspections/assigned/type/${type.toLowerCase()}",
    );
    return response.data;
  }

  static Future<dynamic> getOpenDailyInspections() async {
    final response = await api.get("/api/inspections/open/daily");
    return response.data;
  }

  static Future<dynamic> getInspectionsByScheduleType(
    String scheduleType,
  ) async {
    final response = await api.get(
      "/api/inspections/by-schedule-type/${scheduleType.toLowerCase()}",
    );
    return response.data;
  }

  // Get device information for an inspection
  // static Future<dynamic> getDeviceInfo(String inspectionId) async {
  //   final response = await api.get("/$inspectionId/device-info");
  //   return response.data;
  // }

  // Get all devices for inspections with organizations and contracts
  static Future<dynamic> getDevices() async {
    try {
      debugPrint('=== API CALL ===');

      // Organizations болон contracts мэдээллийг багтаасан endpoint туршиж үзэх
      try {
        debugPrint(
          'Trying: /api/inspections/devices?include=organizations,contracts',
        );
        final response = await api.get(
          "/api/inspections/devices",
          queryParameters: {'include': 'organizations,contracts'},
        );
        debugPrint('✅ Success with include parameters');
        debugPrint('Response status: ${response.statusCode}');
        debugPrint('Response data: ${response.data}');
        return response.data;
      } catch (e) {
        debugPrint('❌ Include parameters failed: $e');
      }

      // Expand parameter туршиж үзэх
      try {
        debugPrint(
          'Trying: /api/inspections/devices?expand=organizations,contracts',
        );
        final response = await api.get(
          "/api/inspections/devices",
          queryParameters: {'expand': 'organizations,contracts'},
        );
        debugPrint('✅ Success with expand parameters');
        debugPrint('Response status: ${response.statusCode}');
        debugPrint('Response data: ${response.data}');
        return response.data;
      } catch (e) {
        debugPrint('❌ Expand parameters failed: $e');
      }

      // With parameter туршиж үзэх
      try {
        debugPrint(
          'Trying: /api/inspections/devices?with=organizations,contracts',
        );
        final response = await api.get(
          "/api/inspections/devices",
          queryParameters: {'with': 'organizations,contracts'},
        );
        debugPrint('✅ Success with "with" parameters');
        debugPrint('Response status: ${response.statusCode}');
        debugPrint('Response data: ${response.data}');
        return response.data;
      } catch (e) {
        debugPrint('❌ "With" parameters failed: $e');
      }

      // Анхны endpoint (fallback)
      debugPrint('Trying original endpoint: /api/inspections/devices');
      final response = await api.get("/api/inspections/devices");
      debugPrint('Response status: ${response.statusCode}');
      debugPrint('Response data: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('API Error: $e');
      rethrow;
    }
  }

  // Get all device models for inspections
  static Future<dynamic> getDeviceModels() async {
    try {
      debugPrint('=== API CALL ===');
      debugPrint('Calling: /api/inspections/device-models');
      final response = await api.get("/api/inspections/device-models");
      debugPrint('Response status: ${response.statusCode}');
      debugPrint('Response data: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('API Error: $e');
      rethrow;
    }
  }

  // Get device information for an inspection (new endpoint)
  static Future<dynamic> getDeviceDetails(String inspectionId) async {
    try {
      debugPrint('=== API CALL ===');
      debugPrint('Calling: /api/inspections/$inspectionId/devices');
      final response = await api.get("/api/inspections/$inspectionId/devices");
      debugPrint('Response status: ${response.statusCode}');
      debugPrint('Response data: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('API Error: $e');
      rethrow;
    }
  }

  // Get inspection template + device information
  static Future<dynamic> getInspectionTemplate(String inspectionId) async {
    try {
      debugPrint('=== API CALL ===');
      debugPrint('Calling: /api/inspections/$inspectionId/template');
      final response = await api.get("/api/inspections/$inspectionId/template");
      debugPrint('Response status: ${response.statusCode}');
      debugPrint('Response data: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('API Error: $e');
      rethrow;
    }
  }

  static Future<dynamic> submitAnswers(
    String inspectionId,
    Map<String, dynamic> payload,
  ) async {
    try {
      debugPrint('=== SUBMITTING FINAL ANSWERS ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Payload: $payload');

      // Try with inspection ID in URL path first
      try {
        debugPrint('Trying: POST /api/inspections/$inspectionId/answers');
        final response = await api.post(
          "/api/inspections/$inspectionId/answers",
          data: payload,
        );
        debugPrint('✅ Final answers submitted successfully: ${response.data}');
        return response.data;
      } catch (e) {
        debugPrint('❌ Failed with ID in path: $e');

        // Fallback: Try original endpoint
        debugPrint('Trying fallback: POST /api/inspections/answers');
        final response = await api.post(
          "/api/inspections/answers",
          data: payload,
        );
        debugPrint('✅ Final answers submitted (fallback): ${response.data}');
        return response.data;
      }
    } catch (e) {
      debugPrint('❌ Error submitting final answers: $e');
      rethrow;
    }
  }

  // Submit individual question answers
  static Future<dynamic> submitQuestionAnswers(
    String inspectionId,
    Map<String, dynamic> payload,
  ) async {
    try {
      debugPrint(
        'Trying: POST /api/inspections/$inspectionId/question-answers',
      );
      final response = await api.post(
        "/api/inspections/$inspectionId/question-answers",
        data: payload,
      );
      return response.data;
    } catch (e) {
      debugPrint('❌ Failed with ID in path, trying fallback: $e');
      final response = await api.post(
        "/api/inspections/question-answers",
        data: payload,
      );
      return response.data;
    }
  }

  // Submit section answers
  static Future<dynamic> submitSectionAnswers(
    String inspectionId,
    Map<String, dynamic> payload,
  ) async {
    try {
      debugPrint('=== API SUBMIT SECTION ANSWERS DEBUG ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Payload Type: ${payload.runtimeType}');
      debugPrint('Payload Content: $payload');
      debugPrint('Payload Keys: ${payload.keys.toList()}');
      debugPrint('========================================');

      // Use the working endpoint: /api/inspections/section-answers
      // Make sure inspectionId is included in payload
      debugPrint('Using: POST /api/inspections/section-answers');
      final response = await api.post(
        "/api/inspections/section-answers",
        data: payload,
      );
      debugPrint('✅ Section answers submitted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error submitting section answers: $e');
      rethrow;
    }
  }

  // Get section answers for an inspection
  static Future<dynamic> getSectionAnswers(String inspectionId) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/section-answers",
    );
    return response.data;
  }

  // Get section status for an inspection
  static Future<dynamic> getSectionStatus(String inspectionId) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/section-status",
    );
    return response.data;
  }

  // Complete a section
  static Future<dynamic> completeSection(
    String inspectionId,
    String section,
  ) async {
    final response = await api.post(
      "/api/inspections/$inspectionId/complete-section",
      data: {"section": section},
    );
    return response.data;
  }

  // Get section questions
  static Future<dynamic> getSectionQuestions(
    String inspectionId,
    String sectionName,
  ) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/section/$sectionName/questions",
    );
    return response.data;
  }

  // Get section review (template + answers)
  static Future<dynamic> getSectionReview(
    String inspectionId,
    String sectionName,
  ) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/section/$sectionName/review",
    );
    return response.data;
  }

  // Confirm section
  static Future<dynamic> confirmSection(
    String inspectionId,
    String sectionName,
  ) async {
    final response = await api.post(
      "/api/inspections/$inspectionId/section/$sectionName/confirm",
    );
    return response.data;
  }

  // Submit conclusion as remarks to existing inspection (legacy method)
  static Future<dynamic> submitConclusion(
    String inspectionId,
    String conclusionText,
  ) async {
    try {
      debugPrint('=== SUBMITTING CONCLUSION AS REMARKS ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Conclusion Text: $conclusionText');

      // Use section-answers endpoint with remarks section
      final payload = {
        'inspectionId': inspectionId,
        'section': 'remarks',
        'answers': {'remarks': conclusionText},
        'progress': 100,
        'sectionStatus': 'COMPLETED',
        'sectionIndex': 999,
        'isFirstSection': false,
      };

      debugPrint('Using: POST /api/inspections/section-answers');
      debugPrint('Remarks section payload: $payload');

      final response = await api.post(
        "/api/inspections/section-answers",
        data: payload,
      );
      debugPrint('✅ Remarks section submitted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error submitting remarks section: $e');
      rethrow;
    }
  }

  // Submit conclusion as field-structured remarks
  static Future<dynamic> submitConclusionAsField(
    String inspectionId,
    String conclusionText,
    String? answerId,
  ) async {
    try {
      debugPrint('=== SUBMITTING CONCLUSION AS FIELD ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Conclusion Text: $conclusionText');
      debugPrint('Answer ID: $answerId');

      // Use field-structured payload
      final payload = {
        'inspectionId': inspectionId,
        'section': 'remarks',
        'answers': {
          'remarks_field': {
            'status': '', // ← Зөв
            'comment': conclusionText.trim(),
          },
        },
        'progress': 100,
        'sectionStatus': 'COMPLETED',
        'sectionIndex': 0, // ← Зөв
        'isFirstSection': false,
      };

      // AnswerId байвал нэмэх (хүүхэд section-тай холбох)
      if (answerId?.isNotEmpty == true) {
        payload['answerId'] = answerId!;
        debugPrint('🔗 Linking remarks to existing answer ID: $answerId');
      } else {
        debugPrint('⚠️ No answerId provided - creating new record');
      }

      debugPrint('Using: POST /api/inspections/section-answers');
      debugPrint('Field-structured remarks payload: $payload');

      final response = await api.post(
        "/api/inspections/section-answers",
        data: payload,
      );
      debugPrint(
        '✅ Field-structured remarks submitted successfully: ${response.data}',
      );
      return response.data;
    } catch (e) {
      debugPrint('❌ Error submitting field-structured remarks: $e');
      rethrow;
    }
  }

  // Get next section
  static Future<dynamic> getNextSection(
    String inspectionId,
    String currentSection,
  ) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/next-section/$currentSection",
    );
    return response.data;
  }

  // Get inspections with repairs needed (from inspection_answer JSON)
  static Future<dynamic> getInspectionsWithRepairsNeeded() async {
    try {
      debugPrint('🔍 [InspectionAPI.getInspectionsWithRepairsNeeded] Making request');
      final response = await api.get("/api/inspections/repairs-needed");
      debugPrint('✅ [InspectionAPI.getInspectionsWithRepairsNeeded] Response received');
      return response.data;
    } catch (e) {
      debugPrint('❌ [InspectionAPI.getInspectionsWithRepairsNeeded] Error: $e');
      rethrow;
    }
  }

  // Get question images for an inspection
  static Future<dynamic> getQuestionImages(
    String inspectionId, {
    String? fieldId,
    String? section,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (fieldId != null) queryParams['fieldId'] = fieldId;
      if (section != null) queryParams['section'] = section;

      final response = await api.get(
        "/api/inspections/$inspectionId/question-images",
        queryParameters: queryParams.isEmpty ? null : queryParams,
      );
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting question images: $e');
      rethrow;
    }
  }

  // Get section review data (saved answers)
  static Future<dynamic> getSectionReviewData(
    String inspectionId,
    String section,
  ) async {
    final response = await api.get(
      "/api/inspections/$inspectionId/section-review/$section",
    );
    return response.data;
  }

  // Get latest inspection answer ID (for remarks/signature updates)
  static Future<dynamic> getLatestInspectionAnswerId(
    String inspectionId,
  ) async {
    try {
      debugPrint('=== GETTING LATEST INSPECTION ANSWER ID ===');
      debugPrint('Inspection ID: $inspectionId');

      final response = await api.get(
        "/api/inspections/$inspectionId/latest-answer-id",
      );

      debugPrint('✅ Latest answer ID retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting latest answer ID: $e');
      rethrow;
    }
  }

  // Get incomplete inspections for current user
  static Future<dynamic> getIncompleteInspections({String? type}) async {
    try {
      debugPrint('=== GETTING INCOMPLETE INSPECTIONS ===');
      debugPrint('Type: ${type ?? 'all'}');

      final queryParams = type != null ? {'type': type} : null;
      final response = await api.get(
        "/api/inspections/incomplete",
        queryParameters: queryParams,
      );

      debugPrint('✅ Incomplete inspections retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting incomplete inspections: $e');
      rethrow;
    }
  }

  // Get incomplete inspection status
  static Future<dynamic> getIncompleteInspectionStatus(
    String inspectionId,
  ) async {
    try {
      debugPrint('=== GETTING INCOMPLETE INSPECTION STATUS ===');
      debugPrint('Inspection ID: $inspectionId');

      final response = await api.get(
        "/api/inspections/$inspectionId/incomplete-status",
      );

      debugPrint('✅ Incomplete inspection status retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting incomplete inspection status: $e');
      rethrow;
    }
  }

  // Get resume data for incomplete inspection
  static Future<dynamic> getResumeData(String inspectionId) async {
    try {
      debugPrint('=== GETTING RESUME DATA ===');
      debugPrint('Inspection ID: $inspectionId');

      final response = await api.get(
        "/api/inspections/$inspectionId/resume-data",
      );

      debugPrint('✅ Resume data retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting resume data: $e');
      rethrow;
    }
  }

  // Submit signature image (base64) - using section-answers endpoint
  static Future<dynamic> submitSignatureImage(
    String inspectionId,
    String signatureImage, {
    String signatureType = 'inspector',
    String? answerId,
  }) async {
    try {
      debugPrint('=== SUBMITTING SIGNATURE IMAGE ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Signature Type: $signatureType');
      debugPrint('Answer ID: $answerId');
      debugPrint('Image Length: ${signatureImage.length}');

      // Use section-answers endpoint (same as remarks)
      final Map<String, dynamic> payload = {
        'inspectionId': inspectionId,
        'section': 'signatures',
        'answers': {'inspector': signatureImage},
        'progress': 100,
        'sectionStatus': 'COMPLETED',
        'sectionIndex': 0,
        'isFirstSection': false,
      };

      // AnswerId байвал нэмэх (хүүхэд section-тай холбох)
      if (answerId?.isNotEmpty == true) {
        payload['answerId'] = answerId!;
        debugPrint('🔗 Linking signature to existing answer ID: $answerId');
      } else {
        debugPrint('⚠️ No answerId provided - creating new record');
      }

      debugPrint('Using: POST /api/inspections/section-answers');
      debugPrint('Signature section payload: $payload');

      final response = await api.post(
        "/api/inspections/section-answers",
        data: payload,
      );
      debugPrint('✅ Signature image submitted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error submitting signature image: $e');
      rethrow;
    }
  }

  // Submit multiple signatures
  static Future<dynamic> submitSignatures(
    String inspectionId,
    Map<String, String> signatures,
  ) async {
    try {
      debugPrint('=== SUBMITTING MULTIPLE SIGNATURES ===');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Signatures: ${signatures.keys.toList()}');

      final payload = {
        'data': {'signatures': signatures},
      };

      debugPrint('Using: POST /api/inspections/$inspectionId/signatures');
      final response = await api.post(
        "/api/inspections/$inspectionId/signatures",
        data: payload,
      );
      debugPrint('✅ Signatures submitted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error submitting signatures: $e');
      rethrow;
    }
  }

  // Upload question images for an inspection via HTTP (ngrok-compatible)
  static Future<dynamic> uploadQuestionImages({
    required String inspectionId,
    required String answerId,
    required String fieldId,
    required String section,
    required String questionText,
    required List<File> images,
  }) async {
    try {
      debugPrint('=== UPLOADING QUESTION IMAGES VIA HTTP ===');
      debugPrint('Base URL: ${AppConfig.apiBaseUrl}');
      debugPrint('Inspection ID: $inspectionId');
      debugPrint('Answer ID: $answerId');
      debugPrint('Field ID: $fieldId');
      debugPrint('Section: $section');
      debugPrint('Question Text: $questionText');
      debugPrint('Images count: ${images.length}');

      // Step 1: Upload images to backend via HTTP multipart
      debugPrint('📤 Step 1: Uploading images via HTTP multipart...');

      final formData = FormData();

      // Add metadata fields
      formData.fields.add(MapEntry('inspectionId', inspectionId));
      formData.fields.add(MapEntry('answerId', answerId));
      formData.fields.add(MapEntry('fieldId', fieldId));
      formData.fields.add(MapEntry('section', section));
      formData.fields.add(MapEntry('questionText', questionText));

      // Add image files
      for (int i = 0; i < images.length; i++) {
        final file = images[i];
        final fileName =
            'inspection_${inspectionId}_answer_${answerId}_field_${fieldId}_${DateTime.now().millisecondsSinceEpoch}_$i.jpg';

        formData.files.add(
          MapEntry(
            'images',
            await MultipartFile.fromFile(file.path, filename: fileName),
          ),
        );
        debugPrint('  Adding image ${i + 1}: $fileName');
      }

      // Upload to backend via ngrok
      final uploadUrl = '/api/inspections/$inspectionId/upload-images';
      final fullUrl = '${AppConfig.apiBaseUrl}$uploadUrl';
      debugPrint('Full upload URL: $fullUrl');

      final uploadResponse = await api.post(
        uploadUrl,
        data: formData,
        options: Options(headers: {'Content-Type': 'multipart/form-data'}),
      );

      if (uploadResponse.statusCode != 200 &&
          uploadResponse.statusCode != 201) {
        throw Exception(
          'Image upload failed with status: ${uploadResponse.statusCode}',
        );
      }

      final uploadData = uploadResponse.data['data'] as Map<String, dynamic>;
      final uploadedImages = uploadData['uploadedImages'] as List<dynamic>;

      debugPrint(
        '✅ HTTP upload successful. Uploaded ${uploadedImages.length} file(s)',
      );

      // Step 2: Prepare image metadata from upload response
      debugPrint('📝 Step 2: Images uploaded successfully:');
      uploadedImages.asMap().entries.forEach((entry) {
        final index = entry.key;
        final image = entry.value as Map<String, dynamic>;
        debugPrint('  Image ${index + 1}: ${image['imageUrl']}');
      });

      debugPrint('✅ Question images uploaded successfully via HTTP!');
      debugPrint('Response: ${uploadResponse.data}');
      return uploadResponse.data;
    } on DioException catch (e) {
      debugPrint('❌ DioException error uploading question images:');
      debugPrint('  Error type: ${e.type}');
      debugPrint('  Error message: ${e.message}');
      if (e.response != null) {
        debugPrint('  Response status: ${e.response?.statusCode}');
        debugPrint('  Response data: ${e.response?.data}');
        debugPrint('  Response headers: ${e.response?.headers}');
      } else {
        debugPrint('  No response received (connection error)');
      }
      debugPrint('  Request options: ${e.requestOptions.uri}');
      rethrow;
    } catch (e, stackTrace) {
      debugPrint('❌ Error uploading question images: $e');
      debugPrint('Stack trace: $stackTrace');
      rethrow;
    }
  }
}

// Repairs API methods
class RepairAPI {
  // Analyze inspection and create repairs
  static Future<dynamic> analyzeRepairs(String inspectionId) async {
    final response = await api.post(
      "/api/repairs/analyze/$inspectionId",
    );
    return response.data;
  }

  // Get all repairs
  static Future<dynamic> getAll({
    String? inspectionId,
    String? status,
    int? page,
    int? limit,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (inspectionId != null) queryParams['inspectionId'] = inspectionId;
      if (status != null) queryParams['status'] = status;
      if (page != null) queryParams['page'] = page;
      if (limit != null) queryParams['limit'] = limit;

      debugPrint('🔍 [RepairAPI.getAll] Making request');
      debugPrint('   URL: /api/repairs');
      debugPrint('   Query params: $queryParams');
      debugPrint('   Base URL: ${api.options.baseUrl}');
      debugPrint('   Full URL: ${api.options.baseUrl}/api/repairs');

      final response = await api.get(
        "/api/repairs",
        queryParameters: queryParams.isEmpty ? null : queryParams,
      );
      
      debugPrint('✅ [RepairAPI.getAll] Response received');
      debugPrint('   Status code: ${response.statusCode}');
      debugPrint('   Response keys: ${response.data?.keys ?? 'N/A'}');
      
      return response.data;
    } catch (e) {
      debugPrint('❌ [RepairAPI.getAll] Error occurred');
      debugPrint('   Error: $e');
      debugPrint('   Error type: ${e.runtimeType}');
      if (e is DioException) {
        debugPrint('   DioException details:');
        debugPrint('     Type: ${e.type}');
        debugPrint('     Message: ${e.message}');
        debugPrint('     Response: ${e.response}');
        debugPrint('     Request path: ${e.requestOptions.path}');
        debugPrint('     Request base URL: ${e.requestOptions.baseUrl}');
      }
      rethrow;
    }
  }

  // Get repair by ID
  static Future<dynamic> getById(String repairId) async {
    final response = await api.get("/api/repairs/$repairId");
    return response.data;
  }

  // Get repairs for an inspection
  static Future<dynamic> getByInspection(String inspectionId) async {
    final response = await api.get(
      "/api/repairs/inspection/$inspectionId",
    );
    return response.data;
  }

  // Update repair
  static Future<dynamic> update(
    String repairId,
    Map<String, dynamic> data,
  ) async {
    final response = await api.put(
      "/api/repairs/$repairId",
      data: data,
    );
    return response.data;
  }

  // Upload repair images
  static Future<dynamic> uploadImages({
    required String repairId,
    required List<File> images,
  }) async {
    try {
      final formData = FormData();

      for (int i = 0; i < images.length; i++) {
        final file = images[i];
        final fileName =
            'repair_${repairId}_${DateTime.now().millisecondsSinceEpoch}_$i.jpg';

        formData.files.add(
          MapEntry(
            'images',
            await MultipartFile.fromFile(file.path, filename: fileName),
          ),
        );
      }

      final response = await api.post(
        "/api/repairs/$repairId/upload-images",
        data: formData,
        options: Options(headers: {'Content-Type': 'multipart/form-data'}),
      );
      return response.data;
    } catch (e) {
      debugPrint('❌ Error uploading repair images: $e');
      rethrow;
    }
  }
}

// Templates API methods
class TemplateAPI {
  static Future<dynamic> getTemplates({
    required String type,
    bool isActive = true,
  }) async {
    final response = await api.get(
      "/api/templates/type/${type.toLowerCase()}",
      queryParameters: {"isActive": isActive},
    );
    return response.data;
  }

  static Future<dynamic> getTemplatesWithQuery({
    required String type,
    bool isActive = true,
    String? name,
    int? page,
    int? limit,
    String? sortBy,
    String? sortOrder,
  }) async {
    final queryParams = <String, dynamic>{"isActive": isActive};
    if (name != null) queryParams["name"] = name;
    if (page != null) queryParams["page"] = page;
    if (limit != null) queryParams["limit"] = limit;
    if (sortBy != null) queryParams["sortBy"] = sortBy;
    if (sortOrder != null) queryParams["sortOrder"] = sortOrder;

    final response = await api.get(
      "/api/templates/type/${type.toLowerCase()}",
      queryParameters: queryParams,
    );
    return response.data;
  }

  static Future<dynamic> getTemplateById(String id) async {
    final response = await api.get("/api/templates/$id");
    return response.data;
  }

  // Legacy support for backward compatibility
  static Future<dynamic> getTemplatesLegacy({
    required String type,
    bool isActive = true,
  }) async {
    final response = await api.get(
      "/api/templates",
      queryParameters: {"type": type.toUpperCase(), "isActive": isActive},
    );
    return response.data;
  }
}

// Device API methods
class DeviceAPI {
  static Future<dynamic> create(Map<String, dynamic> data) async {
    final response = await api.post("/api/devices", data: data);
    return response.data;
  }

  static Future<dynamic> update(String id, Map<String, dynamic> data) async {
    final response = await api.put("/api/devices/$id", data: data);
    return response.data;
  }

  static Future<dynamic> getById(String id) async {
    final response = await api.get("/api/devices/$id");
    return response.data;
  }
}

// Device Model API methods
class DeviceModelAPI {
  static Future<dynamic> create(Map<String, dynamic> data) async {
    final response = await api.post("/api/device-models", data: data);
    return response.data;
  }

  static Future<dynamic> getAll() async {
    final response = await api.get("/api/device-models");
    return response.data;
  }
}

// Settlement Template API methods
class SettlementTemplateAPI {
  // Get all settlement templates
  static Future<dynamic> getAll() async {
    try {
      debugPrint('=== GETTING SETTLEMENT TEMPLATES ===');
      // Direct SQL query эсвэл backend endpoint ашиглах
      // Одоогоор inspection_templates-ээс INSTALLATION type-тай template-уудыг авах
      final response = await api.get(
        "/api/templates/type/INSTALLATION",
        queryParameters: {"isActive": true},
      );
      debugPrint('✅ Settlement templates retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting settlement templates: $e');
      rethrow;
    }
  }

  // Get settlement template by device_type
  static Future<dynamic> getByDeviceType(String deviceType) async {
    try {
      debugPrint('=== GETTING SETTLEMENT TEMPLATE BY DEVICE TYPE ===');
      debugPrint('Device Type: $deviceType');
      
      final response = await api.get(
        "/api/templates/type/INSTALLATION",
        queryParameters: {
          "isActive": true,
          "deviceType": deviceType,
        },
      );
      
      debugPrint('✅ Settlement template retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting settlement template: $e');
      rethrow;
    }
  }

  // Get settlement template by ID
  static Future<dynamic> getById(String id) async {
    try {
      debugPrint('=== GETTING SETTLEMENT TEMPLATE BY ID ===');
      debugPrint('Template ID: $id');
      
      final response = await api.get("/api/templates/$id");
      debugPrint('✅ Settlement template retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting settlement template: $e');
      rethrow;
    }
  }
}

// Organization API methods
class OrganizationAPI {
  static Future<dynamic> getAll() async {
    final response = await api.get("/api/organizations");
    return response.data;
  }
}

// Site API methods
class SiteAPI {
  static Future<dynamic> getAll() async {
    final response = await api.get("/api/sites");
    return response.data;
  }

  static Future<dynamic> getByOrganization(String orgId) async {
    final response = await api.get("/api/sites/organization/$orgId");
    return response.data;
  }
}

// Contract API methods
class ContractAPI {
  static Future<dynamic> getAll() async {
    final response = await api.get("/api/contracts");
    return response.data;
  }

  static Future<dynamic> getByOrganization(String orgId) async {
    final response = await api.get("/api/contracts/organization/$orgId");
    return response.data;
  }
}

// Installation Assignment API methods
class InstallationAssignmentAPI {
  // Get all installation assignments for current user
  static Future<dynamic> getByUser(String userId) async {
    try {
      debugPrint('=== GETTING INSTALLATION ASSIGNMENTS FOR USER ===');
      debugPrint('User ID: $userId');
      final response = await api.get("/api/installation-assignments/user/$userId");
      debugPrint('✅ Installation assignments retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting installation assignments: $e');
      rethrow;
    }
  }

  // Get all installation assignments with filters
  static Future<dynamic> getAll({
    String? contractId,
    String? templateId,
    String? userId,
    String? status,
    int? page,
    int? limit,
  }) async {
    try {
      debugPrint('=== GETTING ALL INSTALLATION ASSIGNMENTS ===');
      final queryParams = <String, dynamic>{};
      if (contractId != null) queryParams['contractId'] = contractId;
      if (templateId != null) queryParams['templateId'] = templateId;
      if (userId != null) queryParams['userId'] = userId;
      if (status != null) queryParams['status'] = status;
      if (page != null) queryParams['page'] = page;
      if (limit != null) queryParams['limit'] = limit;

      final response = await api.get(
        "/api/installation-assignments",
        queryParameters: queryParams,
      );
      debugPrint('✅ Installation assignments retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting installation assignments: $e');
      rethrow;
    }
  }

  // Get installation assignment by ID
  static Future<dynamic> getById(String id) async {
    try {
      debugPrint('=== GETTING INSTALLATION ASSIGNMENT BY ID ===');
      debugPrint('Assignment ID: $id');
      final response = await api.get("/api/installation-assignments/$id");
      debugPrint('✅ Installation assignment retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting installation assignment: $e');
      rethrow;
    }
  }
}

// Verification API methods
class VerificationAPI {
  // Get all verifications for current user
  static Future<dynamic> getByUser(String userId) async {
    try {
      debugPrint('=== GETTING VERIFICATIONS FOR USER ===');
      debugPrint('User ID: $userId');
      final response = await api.get("/api/verifications/user/$userId");
      debugPrint('✅ Verifications retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting verifications: $e');
      rethrow;
    }
  }

  // Get verification by ID
  static Future<dynamic> getById(String id) async {
    try {
      debugPrint('=== GETTING VERIFICATION BY ID ===');
      debugPrint('Verification ID: $id');
      final response = await api.get("/api/verifications/$id");
      debugPrint('✅ Verification retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting verification: $e');
      rethrow;
    }
  }

  // Update verification
  static Future<dynamic> update(String id, Map<String, dynamic> data) async {
    try {
      debugPrint('=== UPDATING VERIFICATION ===');
      debugPrint('Verification ID: $id');
      debugPrint('Data: $data');
      final response = await api.put("/api/verifications/$id", data: data);
      debugPrint('✅ Verification updated: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error updating verification: $e');
      rethrow;
    }
  }

  // Create verification
  static Future<dynamic> create({
    required String orgId,
    String? siteId,
    String? contractId,
    required String title,
    required List<String> userIds,
  }) async {
    try {
      debugPrint('=== CREATING VERIFICATION ===');
      debugPrint('Org ID: $orgId');
      debugPrint('Title: $title');
      debugPrint('User IDs: $userIds');
      
      final data = <String, dynamic>{
        'orgId': orgId,
        'title': title,
        'userIds': userIds,
      };
      if (siteId != null) data['siteId'] = siteId;
      if (contractId != null) data['contractId'] = contractId;
      
      final response = await api.post("/api/verifications", data: data);
      debugPrint('✅ Verification created: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error creating verification: $e');
      rethrow;
    }
  }
}

// Installation Answer API methods
class InstallationAnswerAPI {
  // Save field answer (comment)
  static Future<dynamic> saveFieldAnswer({
    required String assignmentId,
    required String templateId,
    required String section,
    required String fieldId,
    required String question,
    required String comment,
    String? status,
  }) async {
    try {
      debugPrint('=== SAVING INSTALLATION FIELD ANSWER ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Template ID: $templateId');
      debugPrint('Section: $section');
      debugPrint('Field ID: $fieldId');
      debugPrint('Comment: $comment');

      final response = await api.post(
        "/api/installation-assignments/$assignmentId/answers",
        data: {
          'templateId': templateId,
          'section': section,
          'fieldId': fieldId,
          'question': question,
          'comment': comment,
          'status': status ?? '',
        },
      );

      debugPrint('✅ Field answer saved successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error saving field answer: $e');
      rethrow;
    }
  }

  // Get answers for a template
  static Future<dynamic> getAnswers({
    required String assignmentId,
    required String templateId,
  }) async {
    try {
      debugPrint('=== GETTING INSTALLATION ANSWERS ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Template ID: $templateId');

      final response = await api.get(
        "/api/installation-assignments/$assignmentId/answers/$templateId",
      );

      debugPrint('✅ Answers retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting answers: $e');
      rethrow;
    }
  }

  // Upload images for a field
  static Future<dynamic> uploadImages({
    required String assignmentId,
    required String templateId,
    required String section,
    required String fieldId,
    required List<File> images,
  }) async {
    try {
      debugPrint('=== UPLOADING INSTALLATION IMAGES ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Template ID: $templateId');
      debugPrint('Section: $section');
      debugPrint('Field ID: $fieldId');
      debugPrint('Images count: ${images.length}');

      final formData = FormData();

      // Add metadata fields
      formData.fields.add(MapEntry('templateId', templateId));
      formData.fields.add(MapEntry('section', section));
      formData.fields.add(MapEntry('fieldId', fieldId));

      // Add image files
      for (int i = 0; i < images.length; i++) {
        final file = images[i];
        final fileName =
            'installation_${assignmentId}_template_${templateId}_field_${fieldId}_${DateTime.now().millisecondsSinceEpoch}_$i.jpg';

        formData.files.add(
          MapEntry(
            'images',
            await MultipartFile.fromFile(file.path, filename: fileName),
          ),
        );
        debugPrint('  Adding image ${i + 1}: $fileName');
      }

      final uploadUrl = '/api/installation-assignments/$assignmentId/upload-images';
      debugPrint('Upload URL: $uploadUrl');

      final uploadResponse = await api.post(
        uploadUrl,
        data: formData,
        options: Options(headers: {'Content-Type': 'multipart/form-data'}),
      );

      if (uploadResponse.statusCode != 200 &&
          uploadResponse.statusCode != 201) {
        throw Exception(
          'Image upload failed with status: ${uploadResponse.statusCode}',
        );
      }

      debugPrint('✅ Images uploaded successfully: ${uploadResponse.data}');
      return uploadResponse.data;
    } on DioException catch (e) {
      debugPrint('❌ DioException uploading images: $e');
      debugPrint('   Response: ${e.response?.data}');
      debugPrint('   Status: ${e.response?.statusCode}');
      rethrow;
    } catch (e) {
      debugPrint('❌ Error uploading images: $e');
      rethrow;
    }
  }

  // Get images for a field
  static Future<dynamic> getImages({
    required String assignmentId,
    String? templateId,
    String? section,
    String? fieldId,
  }) async {
    try {
      debugPrint('=== GETTING INSTALLATION IMAGES ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Template ID: $templateId');
      debugPrint('Section: $section');
      debugPrint('Field ID: $fieldId');

      final queryParams = <String, dynamic>{};
      if (templateId != null) queryParams['templateId'] = templateId;
      if (section != null) queryParams['section'] = section;
      if (fieldId != null) queryParams['fieldId'] = fieldId;

      final response = await api.get(
        "/api/installation-assignments/$assignmentId/images",
        queryParameters: queryParams,
      );

      debugPrint('✅ Images retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting images: $e');
      rethrow;
    }
  }

  // Delete an image
  static Future<dynamic> deleteImage({
    required String assignmentId,
    required String imageId,
  }) async {
    try {
      debugPrint('=== DELETING INSTALLATION IMAGE ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Image ID: $imageId');

      final response = await api.delete(
        "/api/installation-assignments/$assignmentId/images/$imageId",
      );

      debugPrint('✅ Image deleted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error deleting image: $e');
      rethrow;
    }
  }
}

// Installation Act API methods
class InstallationActAPI {
  // Get acts for a specific assignment and template
  static Future<dynamic> getByAssignmentAndTemplate({
    required String assignmentId,
    required String templateId,
  }) async {
    try {
      debugPrint('=== GETTING INSTALLATION ACTS ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Template ID: $templateId');

      final response = await api.get(
        "/api/installation-acts/assignment/$assignmentId/template/$templateId",
      );

      debugPrint('✅ Acts retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting acts: $e');
      rethrow;
    }
  }

  // Get a single act by ID
  static Future<dynamic> getById(String id) async {
    try {
      debugPrint('=== GETTING INSTALLATION ACT ===');
      debugPrint('Act ID: $id');

      final response = await api.get("/api/installation-acts/$id");

      debugPrint('✅ Act retrieved: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error getting act: $e');
      rethrow;
    }
  }

  // Create a new act
  static Future<dynamic> create({
    required String assignmentId,
    required String orgId,
    required String title,
    required String templateId,
    String? actTitle,
    String? comment,
  }) async {
    try {
      debugPrint('=== CREATING INSTALLATION ACT ===');
      debugPrint('Assignment ID: $assignmentId');
      debugPrint('Org ID: $orgId');
      debugPrint('Title: $title');
      debugPrint('Template ID: $templateId');
      debugPrint('Act Title: $actTitle');

      final response = await api.post(
        "/api/installation-acts",
        data: {
          'assignmentId': assignmentId,
          'orgId': orgId,
          'title': title,
          'templateId': templateId,
          if (actTitle != null && actTitle.isNotEmpty) 'actTitle': actTitle,
          if (comment != null) 'comment': comment,
        },
      );

      debugPrint('✅ Act created successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error creating act: $e');
      rethrow;
    }
  }

  // Update an act
  static Future<dynamic> update({
    required String id,
    String? actTitle,
    String? comment,
    String? imageUrl,
    String? fileName,
    int? fileSize,
  }) async {
    try {
      debugPrint('=== UPDATING INSTALLATION ACT ===');
      debugPrint('Act ID: $id');

      final data = <String, dynamic>{};
      if (actTitle != null) data['actTitle'] = actTitle;
      if (comment != null) data['comment'] = comment;
      if (imageUrl != null) data['imageUrl'] = imageUrl;
      if (fileName != null) data['fileName'] = fileName;
      if (fileSize != null) data['fileSize'] = fileSize;

      final response = await api.put(
        "/api/installation-acts/$id",
        data: data,
      );

      debugPrint('✅ Act updated successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error updating act: $e');
      rethrow;
    }
  }

  // Upload act file
  static Future<dynamic> uploadFile({
    required String actId,
    required File file,
  }) async {
    try {
      debugPrint('=== UPLOADING INSTALLATION ACT FILE ===');
      debugPrint('Act ID: $actId');
      debugPrint('File: ${file.path}');

      final formData = FormData();
      formData.files.add(
        MapEntry(
          'file',
          await MultipartFile.fromFile(
            file.path,
            filename: path.basename(file.path),
          ),
        ),
      );

      final response = await api.post(
        "/api/installation-acts/$actId/upload-file",
        data: formData,
        options: Options(headers: {'Content-Type': 'multipart/form-data'}),
      );

      debugPrint('✅ Act file uploaded successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error uploading act file: $e');
      rethrow;
    }
  }

  // Delete an act
  static Future<dynamic> delete(String id) async {
    try {
      debugPrint('=== DELETING INSTALLATION ACT ===');
      debugPrint('Act ID: $id');

      final response = await api.delete("/api/installation-acts/$id");

      debugPrint('✅ Act deleted successfully: ${response.data}');
      return response.data;
    } catch (e) {
      debugPrint('❌ Error deleting act: $e');
      rethrow;
    }
  }
}
