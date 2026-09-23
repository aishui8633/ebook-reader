package com.ebookreader.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Indigo = Color(0xFF6366F1)
private val IndigoLight = Color(0xFF818CF8)
private val Violet = Color(0xFF8B5CF6)

private val DarkColors = darkColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF2A2A4A),
    onPrimaryContainer = Color(0xFFDDE1FF),
    secondary = Violet,
    background = Color(0xFF0F0F0F),
    onBackground = Color(0xFFF0F0F0),
    surface = Color(0xFF1A1A1A),
    onSurface = Color(0xFFF0F0F0),
    surfaceVariant = Color(0xFF222222),
    onSurfaceVariant = Color(0xFFAAAAAA),
    outline = Color(0xFF2A2A2A),
    error = Color(0xFFEF4444),
)

private val LightColors = lightColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E1FF),
    onPrimaryContainer = Color(0xFF1A1B3A),
    secondary = Violet,
    background = Color(0xFFF8F9FA),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFF0F0F0),
    onSurfaceVariant = Color(0xFF666666),
    outline = Color(0xFFE5E7EB),
    error = Color(0xFFDC2626),
)

@Composable
fun EbookReaderTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
