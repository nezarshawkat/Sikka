class RouteStep {
  final String instruction;
  final String mode;
  final double distanceKm;
  final double timeMin;
  final double costEgp;

  RouteStep({
    required this.instruction,
    required this.mode,
    required this.distanceKm,
    required this.timeMin,
    required this.costEgp,
  });

  factory RouteStep.fromJson(Map<String, dynamic> json) => RouteStep(
        instruction: json['instruction'] ?? '',
        mode: json['mode'] ?? '',
        distanceKm: (json['distanceKm'] ?? 0).toDouble(),
        timeMin: (json['timeMin'] ?? 0).toDouble(),
        costEgp: (json['costEgp'] ?? 0).toDouble(),
      );
}

class RouteModel {
  final String profile;
  final String from;
  final String to;
  final double costEgp;
  final double timeMin;
  final double score;
  final List<RouteStep> steps;

  RouteModel({
    required this.profile,
    required this.from,
    required this.to,
    required this.costEgp,
    required this.timeMin,
    required this.score,
    required this.steps,
  });

  factory RouteModel.fromJson(Map<String, dynamic> json) => RouteModel(
        profile: json['profile'] ?? 'balanced',
        from: json['from'] ?? '',
        to: json['to'] ?? '',
        costEgp: (json['costEgp'] ?? 0).toDouble(),
        timeMin: (json['timeMin'] ?? 0).toDouble(),
        score: (json['score'] ?? 0).toDouble(),
        steps: ((json['steps'] ?? []) as List)
            .map((step) => RouteStep.fromJson(step as Map<String, dynamic>))
            .toList(),
      );
}
