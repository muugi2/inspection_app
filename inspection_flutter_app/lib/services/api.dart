import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:app/config/app_config.dart';

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
