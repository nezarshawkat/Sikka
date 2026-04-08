import 'package:flutter/material.dart';

class NavigationScreen extends StatelessWidget {
  const NavigationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Live Navigation')),
      body: const Center(child: Text('Turn-by-turn guidance with transport transfer hints.')),
    );
  }
}
