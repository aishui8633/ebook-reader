# Keep Gson model classes
-keep class com.ebookreader.app.data.model.** { *; }
-keepattributes Signature
-keepattributes *Annotation*

# Retrofit
-keepattributes Exceptions
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-dontwarn org.slf4j.**
-dontwarn nl.siegmann.epublib.**
