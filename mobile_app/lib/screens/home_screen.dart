import 'package:flutter/material.dart';
import '../widgets/glass_card.dart';
import 'route_results_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _startLat = TextEditingController(text: '30.0444');
  final _startLng = TextEditingController(text: '31.2357');
  final _endLat = TextEditingController(text: '31.2001');
  final _endLng = TextEditingController(text: '29.9187');
  String routeType = 'balanced';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(colors: [Color(0xFF0F172A), Color(0xFF1E3A8A)]),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(height: 80, alignment: Alignment.center, child: const Text('LOGO SPACE', style: TextStyle(color: Colors.white70))),
                const SizedBox(height: 16),
                const GlassCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Sikka — Move Egypt Brilliantly ✨', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                    SizedBox(height: 8),
                    Text('Plan cheapest, fastest, comfort, and tourist-safe routes with one tap.', style: TextStyle(color: Colors.white70))
                  ]),
                ),
                const SizedBox(height: 18),
                _buildInput('Start Lat', _startLat),
                _buildInput('Start Lng', _startLng),
                _buildInput('End Lat', _endLat),
                _buildInput('End Lng', _endLng),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: routeType,
                  items: const ['cheapest', 'fastest', 'balanced', 'comfort', 'tourist']
                      .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                      .toList(),
                  onChanged: (v) => setState(() => routeType = v ?? 'balanced'),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => RouteResultsScreen(
                        startLat: double.parse(_startLat.text),
                        startLng: double.parse(_startLng.text),
                        endLat: double.parse(_endLat.text),
                        endLng: double.parse(_endLng.text),
                        routeType: routeType,
                      ),
                    ),
                  ),
                  child: const Text('Plan Your Journey'),
                ),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: () {}, child: const Text('Sign up with Google')),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: () {}, child: const Text('Sign up with Phone Number')),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildInput(String label, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(labelText: label, labelStyle: const TextStyle(color: Colors.white70)),
      ),
    );
  }
}
