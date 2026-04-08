import 'package:dio/dio.dart';

class ApiService {
  final Dio dio = Dio(
    BaseOptions(baseUrl: 'http://localhost:4000/api/v1', connectTimeout: const Duration(seconds: 10)),
  );

  Future<Map<String, dynamic>> fetchRoutes({
    required double startLat,
    required double startLng,
    required double endLat,
    required double endLng,
    required String routeType,
  }) async {
    final response = await dio.get('/route', queryParameters: {
      'start_lat': startLat,
      'start_lng': startLng,
      'end_lat': endLat,
      'end_lng': endLng,
      'route_type': routeType,
    });

    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<void> signupGoogle(String idToken) async {
    await dio.post('/auth/google-signup', data: {'idToken': idToken});
  }

  Future<void> startPhoneSignup(String phone) async {
    await dio.post('/auth/phone-signup/start', data: {'phone': phone});
  }

  Future<void> verifyPhoneSignup(String phone, String code) async {
    await dio.post('/auth/phone-signup/verify', data: {'phone': phone, 'code': code});
  }
}
