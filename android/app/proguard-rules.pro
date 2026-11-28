# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- Peguei (release build, R8) ---------------------------------------------
# React Native, Hermes and the @react-native-firebase modules ship their own
# consumer rules; these cover what is specific to this app.

# Readable Crashlytics stack traces (the mapping is uploaded by the
# Crashlytics Gradle plugin).
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
-keep public class * extends java.lang.Exception

# Our native modules and views are found by React Native by name
# (getName(), @ReactMethod, @ReactProp): keep them and their members.
-keep class com.felipenunes.pegueiapp.** { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
    @com.facebook.react.uimanager.annotations.ReactProp *;
    @com.facebook.react.uimanager.annotations.ReactPropGroup *;
}

# Firebase (Analytics, Crashlytics, Performance, Remote Config) and Play
# services ship consumer rules; silence warnings about optional classes.
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Media3 Transformer (video export) uses reflection for optional decoders.
-dontwarn androidx.media3.**
