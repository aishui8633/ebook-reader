package com.ebookreader.app.data

import com.ebookreader.app.data.model.*
import okhttp3.ResponseBody
import retrofit2.http.*

/**
 * 书库服务 API（与网页版 server.js 对接）
 * baseUrl 由 SettingsRepository 动态提供
 */
interface EbookApi {

    @GET("api/books")
    suspend fun getBooks(
        @Query("limit") limit: Int = 120,
        @Query("offset") offset: Int = 0
    ): BooksResponse

    @GET("api/books/index")
    suspend fun getBookIndex(): BookIndexResponse

    @GET("api/books/{id}")
    suspend fun getBook(@Path("id") id: String): BookDetailResponse

    @GET("api/folders")
    suspend fun getFolders(): FoldersResponse

    @GET("api/tags")
    suspend fun getTags(): TagsResponse

    @GET("api/stats")
    suspend fun getStats(): StatsResponse

    /** 下载书籍原文件 */
    @Streaming
    @GET("api/books/{id}/file")
    suspend fun downloadBook(@Path("id") id: String): ResponseBody

    /** 读取 TXT/HTML/MD 文本内容 */
    @GET("api/books/{id}/content")
    suspend fun getContent(@Path("id") id: String): ContentResponse

    /** 记录一次阅读 */
    @POST("api/books/{id}/read")
    suspend fun markRead(@Path("id") id: String): SimpleResponse

    /** 读取服务端进度 */
    @GET("api/books/{id}/progress")
    suspend fun getProgress(@Path("id") id: String): ProgressResponse

    /** 同步进度 */
    @POST("api/books/{id}/progress")
    suspend fun saveProgress(
        @Path("id") id: String,
        @Body body: Map<String, @JvmSuppressWildcards Any>
    ): SimpleResponse

    /** 书签列表 */
    @GET("api/books/{id}/bookmarks")
    suspend fun getBookmarks(@Path("id") id: String): BookmarksResponse

    /** 新增书签 */
    @POST("api/books/{id}/bookmarks")
    suspend fun addBookmark(
        @Path("id") id: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): BookmarksResponse

    /** 删除书签 */
    @DELETE("api/books/{id}/bookmarks/{bookmarkId}")
    suspend fun deleteBookmark(
        @Path("id") id: String,
        @Path("bookmarkId") bookmarkId: String
    ): SimpleResponse

    @GET("api/books/{id}/cover")
    suspend fun getCover(@Path("id") id: String): ResponseBody
}

data class BookDetailResponse(
    val success: Boolean = false,
    val book: Book? = null,
    val error: String? = null
)
