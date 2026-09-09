# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Capacitor discovers plugin methods and manifest components reflectively.
# Keep these small native entry-point classes while allowing R8 to optimize
# the rest of the application and its dependencies.
-keep class com.sikkago.app.SikkaAdMobPlugin { *; }
-keep class com.sikkago.app.SikkaAppInfoPlugin { *; }
-keep class com.sikkago.app.SikkaDiscoveryPlugin { *; }
-keep class com.sikkago.app.SikkaLocationSettingsPlugin { *; }
-keep class com.sikkago.app.SikkaMapUiPlugin { *; }
-keep class com.sikkago.app.SikkaRatePlugin { *; }
-keep class com.sikkago.app.SikkaSharePlugin { *; }
-keep class com.sikkago.app.SikkaTripNotificationPlugin { *; }
-keep class com.sikkago.app.SikkaDiscoveryService { *; }
-keep class com.sikkago.app.SikkaBootReceiver { *; }

# Retain line mappings for Play Console crash diagnostics while still hiding
# original source file names in the shipped artifact.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
