import 'package:flutter/material.dart';

import '../models/route_model.dart';
import '../services/api_service.dart';
import '../services/routing_service.dart';

class RouteResultsScreen extends StatefulWidget {
  final double startLat;
  final double startLng;
  final double endLat;
  final double endLng;
  final String routeType;

  const RouteResultsScreen({
    super.key,
    required this.startLat,
    required this.startLng,
    required this.endLat,
    required this.endLng,
    required this.routeType,
  });

  @override
  State<RouteResultsScreen> createState() => _RouteResultsScreenState();
}

class _RouteResultsScreenState extends State<RouteResultsScreen> {
  final api = ApiService();
  final routingService = RoutingService();
  late Future<List<RouteModel>> futureRoutes;

  @override
  void initState() {
    super.initState();
    futureRoutes = _load();
  }

  Future<List<RouteModel>> _load() async {
    final json = await api.fetchRoutes(
      startLat: widget.startLat,
      startLng: widget.startLng,
      endLat: widget.endLat,
      endLng: widget.endLng,
      routeType: widget.routeType,
    );
    return routingService.parseRouteResults(json);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Route Results')),
      body: FutureBuilder<List<RouteModel>>(
        future: futureRoutes,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Failed to load routes: ${snapshot.error}'));
          }
          final routes = snapshot.data ?? [];
          if (routes.isEmpty) {
            return const Center(child: Text('No routes found for this selection.'));
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: routes.length,
            itemBuilder: (context, index) {
              final route = routes[index];
              return Card(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: ExpansionTile(
                  title: Text('${route.profile.toUpperCase()} • ${route.timeMin.toStringAsFixed(0)} min'),
                  subtitle: Text('EGP ${route.costEgp.toStringAsFixed(2)} • Score ${route.score.toStringAsFixed(2)}'),
                  children: route.steps
                      .map((s) => ListTile(
                            leading: const Icon(Icons.alt_route),
                            title: Text(s.instruction),
                            subtitle: Text('${s.distanceKm.toStringAsFixed(1)} km • ${s.timeMin.toStringAsFixed(0)} min • EGP ${s.costEgp.toStringAsFixed(1)}'),
                          ))
                      .toList(),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
