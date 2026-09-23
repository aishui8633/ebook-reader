package com.ebookreader.app.data.model

import com.google.gson.annotations.SerializedName

/** 书籍（/api/books 分页响应里的元素） */
data class Book(
    val id: String,
    val filename: String = "",
    val title: String = "",
    val format: String = "",
    val mime: String = "",
    val size: Long = 0,
    val modified: String? = null,
    val path: String = "",
    val coverUrl: String? = null,
    val lastRead: String? = null,
    val readCount: Int = 0,
    val progress: Int = 0,
    val tags: List<String> = emptyList()
)

/** 分页响应 */
data class BooksResponse(
    val success: Boolean = false,
    val books: List<Book> = emptyList(),
    val total: Int = 0,
    val offset: Int = 0,
    val limit: Int = 0,
    val hasMore: Boolean = false,
    val error: String? = null
)

/** 轻量索引（/api/books/index） */
data class BookIndexItem(
    val id: String,
    @SerializedName("t") val title: String = "",
    @SerializedName("f") val format: String = "",
    @SerializedName("s") val size: Long = 0,
    @SerializedName("m") val modified: String? = null,
    @SerializedName("p") val path: String = "",
    @SerializedName("lr") val lastRead: String? = null,
    @SerializedName("pg") val progress: Int = 0,
    @SerializedName("tg") val tags: List<String> = emptyList()
) {
    fun toBook(): Book = Book(
        id = id,
        filename = path,
        title = title,
        format = format,
        size = size,
        modified = modified,
        path = path,
        coverUrl = "/api/books/$id/cover",
        lastRead = lastRead,
        progress = progress,
        tags = tags
    )
}

data class BookIndexResponse(
    val success: Boolean = false,
    val books: List<BookIndexItem> = emptyList(),
    val total: Int = 0
)

/** 文件夹列表 */
data class FoldersResponse(
    val success: Boolean = false,
    val folders: List<String> = emptyList(),
    val totalBooks: Int = 0
)

/** 标签映射 {bookId: [tags]} */
data class TagsResponse(
    val success: Boolean = false,
    val tags: Map<String, List<String>> = emptyMap()
)

/** 统计 */
data class StatsResponse(
    val success: Boolean = false,
    val totalBooks: Int = 0,
    val totalSize: Long = 0,
    val byFormat: Map<String, Int> = emptyMap()
)

/** 阅读进度 */
data class ProgressResponse(
    val success: Boolean = false,
    val progress: ProgressData? = null
)

data class ProgressData(
    val lastRead: String? = null,
    val readCount: Int = 0,
    val percentage: Int = 0,
    val lastUpdated: String? = null
)

/** 书签 */
data class BookmarksResponse(
    val success: Boolean = false,
    val bookmarks: List<Bookmark> = emptyList()
)

data class Bookmark(
    val id: String = "",
    val label: String = "",
    val position: BookmarkPosition? = null,
    val timestamp: String = ""
)

data class BookmarkPosition(
    val cfi: String? = null,
    val href: String? = null,
    val scrollRatio: Float? = null
)

/** 通用简单响应 */
data class SimpleResponse(
    val success: Boolean = false,
    val message: String? = null,
    val error: String? = null
)

/** TXT/HTML 内容响应 */
data class ContentResponse(
    val success: Boolean = false,
    val content: BookContent? = null
)

data class BookContent(
    val type: String = "",
    val content: String? = null,
    val url: String? = null,
    val mime: String? = null
)
