package com.ebookreader.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

private val Context.localBookStore by preferencesDataStore(name = "local_books")

/**
 * 本地书籍管理：下载状态、文件存储、空间统计
 */
class LocalBookRepository(private val context: Context) {

    private object Keys {
        val DOWNLOADED_BOOKS = stringPreferencesKey("downloaded_books") // JSON: {bookId: {ext, size, timestamp}}
    }

    private val booksDir: File
        get() = File(context.filesDir, "books").apply { mkdirs() }

    /**
     * 下载状态信息
     */
    data class DownloadInfo(
        val bookId: String,
        val ext: String,
        val size: Long,
        val timestamp: Long
    )

    /**
     * 获取所有已下载书籍的 Flow
     */
    val downloadedBooks: Flow<Map<String, DownloadInfo>> = context.localBookStore.data.map { prefs ->
        val json = prefs[Keys.DOWNLOADED_BOOKS] ?: "{}"
        parseDownloadMap(json)
    }

    /**
     * 检查书籍是否已下载
     */
    suspend fun isDownloaded(bookId: String): Boolean = withContext(Dispatchers.IO) {
        getLocalFile(bookId)?.exists() == true
    }

    /**
     * 获取本地文件路径
     */
    suspend fun getLocalFile(bookId: String): File? = withContext(Dispatchers.IO) {
        val downloads = downloadedBooksFlow()
        val info = downloads[bookId] ?: return@withContext null
        val file = File(booksDir, "$bookId.${info.ext}")
        if (file.exists()) file else null
    }

    /**
     * 保存下载完成的书籍
     */
    suspend fun saveDownload(bookId: String, ext: String, size: Long) = withContext(Dispatchers.IO) {
        context.localBookStore.edit { prefs ->
            val current = parseDownloadMap(prefs[Keys.DOWNLOADED_BOOKS] ?: "{}")
            val updated = current + (bookId to DownloadInfo(bookId, ext, size, System.currentTimeMillis()))
            prefs[Keys.DOWNLOADED_BOOKS] = serializeDownloadMap(updated)
        }
    }

    /**
     * 删除已下载的书籍
     */
    suspend fun deleteDownload(bookId: String): Boolean = withContext(Dispatchers.IO) {
        val info = downloadedBooksFlow()[bookId] ?: return@withContext false
        val file = File(booksDir, "$bookId.${info.ext}")
        val deleted = file.delete()

        context.localBookStore.edit { prefs ->
            val current = parseDownloadMap(prefs[Keys.DOWNLOADED_BOOKS] ?: "{}")
            val updated = current - bookId
            prefs[Keys.DOWNLOADED_BOOKS] = serializeDownloadMap(updated)
        }

        deleted
    }

    /**
     * 清除所有下载
     */
    suspend fun clearAllDownloads(): Long = withContext(Dispatchers.IO) {
        var totalSize = 0L
        booksDir.listFiles()?.forEach { file ->
            totalSize += file.length()
            file.delete()
        }

        context.localBookStore.edit { prefs ->
            prefs[Keys.DOWNLOADED_BOOKS] = "{}"
        }

        totalSize
    }

    /**
     * 获取已下载书籍总大小
     */
    suspend fun getTotalSize(): Long = withContext(Dispatchers.IO) {
        var total = 0L
        booksDir.listFiles()?.forEach { file ->
            total += file.length()
        }
        total
    }

    /**
     * 下载书籍到本地存储
     */
    suspend fun downloadBook(
        bookId: String,
        ext: String,
        onProgress: (Long, Long) -> Unit = { _, _ -> }
    ): File? = withContext(Dispatchers.IO) {
        runCatching {
            val file = File(booksDir, "$bookId.$ext")
            if (file.exists() && file.length() > 0) {
                return@runCatching file
            }

            // 实际下载由 EbookRepository 完成，这里只负责保存文件
            file
        }.getOrNull()
    }

    /**
     * 保存下载的文件
     */
    suspend fun saveFile(bookId: String, ext: String, data: ByteArray): File = withContext(Dispatchers.IO) {
        val file = File(booksDir, "$bookId.$ext")
        FileOutputStream(file).use { it.write(data) }
        file
    }

    private suspend fun downloadedBooksFlow(): Map<String, DownloadInfo> {
        return downloadedBooks.first()
    }

    private fun parseDownloadMap(json: String): Map<String, DownloadInfo> {
        // 简单解析 JSON: {"bookId": {"ext": "epub", "size": 1234, "timestamp": 5678}}
        return try {
            if (json == "{}") return emptyMap()
            val map = mutableMapOf<String, DownloadInfo>()
            val regex = """"([^"]+)":\s*\{"ext":"([^"]+)","size":(\d+),"timestamp":(\d+)\}""".toRegex()
            regex.findAll(json.drop(1).dropLast(1)).forEach { match ->
                val (id, ext, size, timestamp) = match.destructured
                map[id] = DownloadInfo(id, ext, size.toLong(), timestamp.toLong())
            }
            map
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun serializeDownloadMap(map: Map<String, DownloadInfo>): String {
        if (map.isEmpty()) return "{}"
        val entries = map.entries.joinToString(",") { (id, info) ->
            """"$id":{"ext":"${info.ext}","size":${info.size},"timestamp":${info.timestamp}}"""
        }
        return "{$entries}"
    }
}
