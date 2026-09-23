package com.ebookreader.app.data

import android.content.Context
import com.ebookreader.app.data.model.Book
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * 下载任务状态
 */
sealed class DownloadState {
    data object None : DownloadState()
    data class Downloading(val progress: Float = 0f) : DownloadState()
    data class Downloaded(val localPath: String) : DownloadState()
    data class Failed(val error: String) : DownloadState()
}

/**
 * 下载管理器：协调 EbookRepository（网络）和 LocalBookRepository（本地存储）
 */
class DownloadManager(
    private val context: Context,
    private val ebookRepo: EbookRepository,
    private val localRepo: LocalBookRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // 下载状态 Flow: bookId -> DownloadState
    private val _downloadStates = MutableStateFlow<Map<String, DownloadState>>(emptyMap())
    val downloadStates: StateFlow<Map<String, DownloadState>> = _downloadStates.asStateFlow()

    // 已下载书籍 Map
    val downloadedBooks: Flow<Map<String, LocalBookRepository.DownloadInfo>> = localRepo.downloadedBooks

    init {
        // 启动时加载已下载状态
        scope.launch {
            localRepo.downloadedBooks.collect { downloads ->
                val current = _downloadStates.value.toMutableMap()
                downloads.forEach { (id, info) ->
                    val file = localRepo.getLocalFile(id)
                    if (file != null) {
                        current[id] = DownloadState.Downloaded(file.absolutePath)
                    } else {
                        current.remove(id)
                    }
                }
                // 清理本地已不存在的记录
                val validIds = downloads.keys.filter { localRepo.getLocalFile(it) != null }
                _downloadStates.value = current.filterKeys { validIds.contains(it) || current[it] is DownloadState.Downloading }
            }
        }
    }

    /**
     * 获取指定书籍的下载状态
     */
    fun getDownloadState(bookId: String): DownloadState {
        return _downloadStates.value[bookId] ?: DownloadState.None
    }

    /**
     * 下载状态 Flow（单个书籍）
     */
    fun downloadStateFlow(bookId: String): Flow<DownloadState> {
        return downloadStates.map { it[bookId] ?: DownloadState.None }.distinctUntilChanged()
    }

    /**
     * 开始下载书籍
     */
    fun downloadBook(book: Book) {
        val currentState = _downloadStates.value[book.id]
        if (currentState is DownloadState.Downloading || currentState is DownloadState.Downloaded) {
            return // 已在下载或已下载
        }

        scope.launch {
            _downloadStates.update { it + (book.id to DownloadState.Downloading(0f)) }

            try {
                val ext = book.format.lowercase().ifEmpty { "txt" }
                val body = ebookRepo.downloadBook(book.id)

                val bytes = body.byteStream().use { input ->
                    input.readBytes()
                }

                val file = localRepo.saveFile(book.id, ext, bytes)
                localRepo.saveDownload(book.id, ext, file.length())

                _downloadStates.update {
                    it + (book.id to DownloadState.Downloaded(file.absolutePath))
                }
            } catch (e: Exception) {
                _downloadStates.update {
                    it + (book.id to DownloadState.Failed(e.message ?: "下载失败"))
                }
            }
        }
    }

    /**
     * 删除下载
     */
    fun deleteDownload(bookId: String) {
        scope.launch {
            localRepo.deleteDownload(bookId)
            _downloadStates.update { it - bookId }
        }
    }

    /**
     * 清除所有下载
     */
    suspend fun clearAllDownloads(): Long {
        val size = localRepo.clearAllDownloads()
        _downloadStates.value = emptyMap()
        return size
    }

    /**
     * 获取本地文件路径（如果已下载）
     */
    suspend fun getLocalFile(bookId: String): File? {
        return localRepo.getLocalFile(bookId)
    }

    /**
     * 检查是否已下载
     */
    suspend fun isDownloaded(bookId: String): Boolean {
        return localRepo.isDownloaded(bookId)
    }

    /**
     * 获取已下载总大小
     */
    suspend fun getTotalSize(): Long {
        return localRepo.getTotalSize()
    }
}
