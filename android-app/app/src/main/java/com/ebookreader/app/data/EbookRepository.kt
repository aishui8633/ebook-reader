package com.ebookreader.app.data

import android.content.Context
import com.ebookreader.app.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * 统一数据入口：按当前服务器地址动态构建 Retrofit，
 * 地址变更后自动重建客户端。
 */
class EbookRepository(
    private val context: Context,
    private val settingsRepo: SettingsRepository
) {
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(
            HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            }
        )
        .build()

    @Volatile private var cachedBase: String? = null
    @Volatile private var cachedApi: EbookApi? = null

    private suspend fun api(): EbookApi {
        val base = settingsRepo.current().serverUrl
        cachedApi?.let { if (cachedBase == base) return it }
        return synchronized(this) {
            if (cachedBase == base && cachedApi != null) {
                cachedApi!!
            } else {
                val built = Retrofit.Builder()
                    .baseUrl(base.trimEnd('/') + "/")
                    .client(client)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                    .create(EbookApi::class.java)
                cachedBase = base
                cachedApi = built
                built
            }
        }
    }

    suspend fun currentBaseUrl(): String = settingsRepo.current().serverUrl

    /** 测试连接：拉一次统计接口 */
    suspend fun testConnection(url: String): Result<StatsResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val api = Retrofit.Builder()
                .baseUrl(url.trimEnd('/') + "/")
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(EbookApi::class.java)
            val stats = api.getStats()
            if (!stats.success) throw IllegalStateException("服务器返回异常")
            stats
        }
    }

    suspend fun getBooks(limit: Int = 120, offset: Int = 0): BooksResponse =
        withContext(Dispatchers.IO) { api().getBooks(limit, offset) }

    suspend fun getBookIndex(): BookIndexResponse =
        withContext(Dispatchers.IO) { api().getBookIndex() }

    suspend fun getBook(id: String): Book? =
        withContext(Dispatchers.IO) { api().getBook(id).book }

    suspend fun getFolders(): FoldersResponse =
        withContext(Dispatchers.IO) { api().getFolders() }

    suspend fun getTags(): TagsResponse =
        withContext(Dispatchers.IO) { api().getTags() }

    suspend fun getStats(): StatsResponse =
        withContext(Dispatchers.IO) { api().getStats() }

    suspend fun getContent(id: String): BookContent? =
        withContext(Dispatchers.IO) { api().getContent(id).content }

    suspend fun markRead(id: String) {
        withContext(Dispatchers.IO) { runCatching { api().markRead(id) } }
    }

    suspend fun getProgress(id: String): ProgressData? =
        withContext(Dispatchers.IO) {
            runCatching { api().getProgress(id).progress }.getOrNull()
        }

    suspend fun saveProgress(id: String, percentage: Int, extra: Map<String, Any> = emptyMap()) {
        withContext(Dispatchers.IO) {
            runCatching {
                api().saveProgress(id, mapOf("percentage" to percentage) + extra)
            }
        }
    }

    suspend fun getBookmarks(id: String): List<Bookmark> =
        withContext(Dispatchers.IO) {
            runCatching { api().getBookmarks(id).bookmarks }.getOrDefault(emptyList())
        }

    suspend fun addBookmark(id: String, label: String, position: Map<String, Any?>): List<Bookmark> =
        withContext(Dispatchers.IO) {
            runCatching {
                api().addBookmark(id, mapOf("label" to label, "position" to position)).bookmarks
            }.getOrDefault(emptyList())
        }

    suspend fun deleteBookmark(id: String, bookmarkId: String) {
        withContext(Dispatchers.IO) { runCatching { api().deleteBookmark(id, bookmarkId) } }
    }

    /** 文件绝对 URL（供下载 / 图片加载） */
    suspend fun downloadBook(bookId: String): okhttp3.ResponseBody =
        withContext(Dispatchers.IO) { api().downloadBook(bookId) }

    suspend fun fileUrl(bookId: String): String = "${currentBaseUrl()}/api/books/$bookId/file"

    suspend fun coverUrl(bookId: String): String = "${currentBaseUrl()}/api/books/$bookId/cover"
}
