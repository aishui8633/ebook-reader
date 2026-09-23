package com.ebookreader.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "ebook_settings")

/** 阅读偏好 + 服务器配置 */
data class AppSettings(
    val serverUrl: String = DEFAULT_SERVER,
    val fontSize: Int = 18,
    val lineHeight: Float = 1.8f,
    val fontFamily: String = "system",   // system / serif / sans / kai
    val themeMode: String = "system",    // system / light / dark
    val readerBg: String = "default",    // default / paper / eye / white / dark
    val pageMode: String = "scroll"      // scroll / page
) {
    companion object {
        const val DEFAULT_SERVER = "http://zsl86.cn:8374"
    }
}

class SettingsRepository(private val context: Context) {

    private object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val FONT_SIZE = intPreferencesKey("font_size")
        val LINE_HEIGHT = floatPreferencesKey("line_height")
        val FONT_FAMILY = stringPreferencesKey("font_family")
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val READER_BG = stringPreferencesKey("reader_bg")
        val PAGE_MODE = stringPreferencesKey("page_mode")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { prefs ->
        AppSettings(
            serverUrl = prefs[Keys.SERVER_URL] ?: AppSettings.DEFAULT_SERVER,
            fontSize = prefs[Keys.FONT_SIZE] ?: 18,
            lineHeight = prefs[Keys.LINE_HEIGHT] ?: 1.8f,
            fontFamily = prefs[Keys.FONT_FAMILY] ?: "system",
            themeMode = prefs[Keys.THEME_MODE] ?: "system",
            readerBg = prefs[Keys.READER_BG] ?: "default",
            pageMode = prefs[Keys.PAGE_MODE] ?: "scroll"
        )
    }

    suspend fun current(): AppSettings = settings.first()

    suspend fun setServerUrl(url: String) {
        context.dataStore.edit { it[Keys.SERVER_URL] = normalize(url) }
    }

    suspend fun setFontSize(size: Int) {
        context.dataStore.edit { it[Keys.FONT_SIZE] = size.coerceIn(12, 32) }
    }

    suspend fun setLineHeight(lh: Float) {
        context.dataStore.edit { it[Keys.LINE_HEIGHT] = lh }
    }

    suspend fun setFontFamily(f: String) {
        context.dataStore.edit { it[Keys.FONT_FAMILY] = f }
    }

    suspend fun setThemeMode(m: String) {
        context.dataStore.edit { it[Keys.THEME_MODE] = m }
    }

    suspend fun setReaderBg(bg: String) {
        context.dataStore.edit { it[Keys.READER_BG] = bg }
    }

    suspend fun setPageMode(mode: String) {
        context.dataStore.edit { it[Keys.PAGE_MODE] = mode }
    }

    /** 确保 URL 以 http(s):// 开头、不以 / 结尾 */
    private fun normalize(raw: String): String {
        var u = raw.trim()
        if (u.isEmpty()) return AppSettings.DEFAULT_SERVER
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://$u"
        u = u.trimEnd('/')
        return u
    }
}
