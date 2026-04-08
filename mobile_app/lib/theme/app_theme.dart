import 'package:flutter/material.dart';

class AppTheme {
  static const _radius = BorderRadius.all(Radius.circular(32));

  static ThemeData get lightTheme => ThemeData(
        brightness: Brightness.light,
        useMaterial3: true,
        colorSchemeSeed: Colors.cyan,
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            shape: const RoundedRectangleBorder(borderRadius: _radius),
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
            shadowColor: Colors.cyanAccent,
            elevation: 8,
          ),
        ),
      );

  static ThemeData get darkTheme => ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        colorSchemeSeed: Colors.blueAccent,
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            shape: const RoundedRectangleBorder(borderRadius: _radius),
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
            shadowColor: Colors.blueAccent,
            elevation: 8,
          ),
        ),
      );
}
