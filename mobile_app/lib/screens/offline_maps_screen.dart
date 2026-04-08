import 'package:flutter/material.dart';

class OfflineMapsScreen extends StatelessWidget {
  const OfflineMapsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Offline Regions')),
      body: const Center(child: Text('Download Cairo, Giza, Alexandria, Luxor offline packs.')),
    );
  }
}
