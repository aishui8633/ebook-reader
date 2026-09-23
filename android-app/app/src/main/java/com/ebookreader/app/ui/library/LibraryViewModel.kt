package com.ebookreader.app.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ebookreader.app.data.DownloadManager
import com.ebookreader.app.data.DownloadState
import com.ebookreader.app.data.EbookRepository
import com.ebookreader.app.data.SettingsRepository
import com.ebookreader.app.data.model.Book
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SortMode { LAST_READ, MODIFIED, TITLE, SIZE }
enum class ViewMode { GRID, LIST }

data class LibraryUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val books: List<Book> = emptyList(),
    val allBooks: List<Book> = emptyList(),   // 全量索引（用于筛选）
    val folders: List<String> = emptyList(),
    val folderCounts: Map<String, Int> = emptyMap(),
    val allTags: List<String> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val error: String? = null,
    val search: String = "",
    val folder: String = "all",
    val format: String = "all",
    val tag: String? = null,
    val sort: SortMode = SortMode.LAST_READ,
    val viewMode: ViewMode = ViewMode.GRID,
    val recent: List<Book> = emptyList(),
    val serverUrl: String = "",
    val downloadStates: Map<String, com.ebookreader.app.data.DownloadState> = emptyMap()
)

private const val PAGE_SIZE = 120
private const val MAX_RENDER = 600

class LibraryViewModel(
    private val repo: EbookRepository,
    private val settingsRepo: SettingsRepository,
    private val downloadManager: DownloadManager
) : ViewModel() {

    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()

    private var offset = 0
    private var loadedAll = false

    init {
        refresh()
        // 监听下载状态
        viewModelScope.launch {
            downloadManager.downloadStates.collect { states ->
                _state.update { it.copy(downloadStates = states) }
            }
        }
    }

    fun downloadBook(book: Book) {
        downloadManager.downloadBook(book)
    }

    fun deleteDownload(bookId: String) {
        downloadManager.deleteDownload(bookId)
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true, error = null) }
            offset = 0
            loadedAll = false

            val settings = settingsRepo.current()
            _state.update { it.copy(serverUrl = settings.serverUrl) }

            try {
                // 全量索引（用于筛选 + 统计）
                val index = repo.getBookIndex()
                val all = index.books.map { it.toBook() }
                loadedAll = true

                val page = repo.getBooks(PAGE_SIZE, 0)
                val folders = repo.getFolders()
                val tags = repo.getTags()

                val counts = mutableMapOf<String, Int>()
                all.forEach { b ->
                    val top = b.path.substringBefore('/', "")
                    if (top.isNotEmpty()) counts[top] = (counts[top] ?: 0) + 1
                }
                val tagSet = tags.tags.values.flatten().distinct().sorted()

                _state.update {
                    it.copy(
                        loading = false,
                        refreshing = false,
                        allBooks = all,
                        books = page.books,
                        total = page.total,
                        hasMore = page.hasMore,
                        folders = folders.folders,
                        folderCounts = counts,
                        allTags = tagSet,
                        recent = all.filter { b -> !b.lastRead.isNullOrEmpty() }
                            .sortedByDescending { b -> b.lastRead }
                            .take(12),
                        error = null
                    )
                }
                offset = page.books.size
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        loading = false,
                        refreshing = false,
                        error = e.message ?: "加载失败"
                    )
                }
            }
        }
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || s.refreshing || !s.hasMore) return
        if (s.search.isNotBlank() || s.folder != "all" || s.format != "all" || s.tag != null) return
        if (loadedAll) return  // 已有全量索引时不需要分页累积

        viewModelScope.launch {
            try {
                val page = repo.getBooks(PAGE_SIZE, offset)
                offset += page.books.size
                _state.update {
                    it.copy(books = it.books + page.books, hasMore = page.hasMore, total = page.total)
                }
            } catch (_: Exception) { /* 静默 */ }
        }
    }

    fun setSearch(q: String) { _state.update { it.copy(search = q) }; applyFilter() }
    fun setFolder(f: String) { _state.update { it.copy(folder = f) }; applyFilter() }
    fun setFormat(f: String) { _state.update { it.copy(format = f) }; applyFilter() }
    fun setTag(t: String?) { _state.update { it.copy(tag = if (it.tag == t) null else t) }; applyFilter() }
    fun setSort(s: SortMode) { _state.update { it.copy(sort = s) }; applyFilter() }
    fun setViewMode(v: ViewMode) { _state.update { it.copy(viewMode = v) } }

    private fun applyFilter() {
        val s = _state.value
        val noFilter = s.search.isBlank() && s.folder == "all" &&
                s.format == "all" && s.tag == null && s.sort == SortMode.LAST_READ
        if (noFilter) {
            _state.update { it.copy(books = fallbackPage()) }
            return
        }

        var list = s.allBooks

        if (s.folder != "all") list = list.filter { it.path.startsWith("${s.folder}/") }

        if (s.format != "all") {
            val fmts = when (s.format) {
                "mobi" -> listOf("mobi", "azw", "azw3")
                "cbz" -> listOf("cbz", "cbr")
                else -> listOf(s.format)
            }
            list = list.filter { fmts.contains(it.format) }
        }

        s.tag?.let { tag -> list = list.filter { it.tags.contains(tag) } }

        if (s.search.isNotBlank()) {
            val q = s.search.lowercase().trim()
            list = list.filter {
                it.title.lowercase().contains(q) ||
                        it.path.lowercase().contains(q) ||
                        it.format.lowercase().contains(q) ||
                        it.tags.any { t -> t.lowercase().contains(q) }
            }
        }

        list = when (s.sort) {
            SortMode.LAST_READ -> list.sortedWith(
                compareByDescending<Book> { it.lastRead == null }.thenByDescending { it.lastRead }
            )
            SortMode.MODIFIED -> list.sortedByDescending { it.modified ?: "" }
            SortMode.TITLE -> list.sortedBy { it.title }
            SortMode.SIZE -> list.sortedByDescending { it.size }
        }

        _state.update { it.copy(books = list.take(MAX_RENDER)) }
    }

    /** 无筛选时展示已加载的分页数据；若索引已就绪，直接用索引前 N 条 */
    private fun fallbackPage(): List<Book> {
        val s = _state.value
        return if (s.allBooks.isNotEmpty()) s.allBooks.take(PAGE_SIZE) else s.books
    }
}

class LibraryViewModelFactory(
    private val repo: EbookRepository,
    private val settingsRepo: SettingsRepository,
    private val downloadManager: DownloadManager
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        LibraryViewModel(repo, settingsRepo, downloadManager) as T
}
