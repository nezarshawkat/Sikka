import '../models/route_model.dart';

class RoutingService {
  List<RouteModel> parseRouteResults(Map<String, dynamic> json) {
    final scenarios = (json['scenarios'] as List<dynamic>? ?? []);
    return scenarios.map((item) => RouteModel.fromJson(item as Map<String, dynamic>)).toList();
  }
}
