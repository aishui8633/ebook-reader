package com.ebookreader.app.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.ebookreader.app.data.DownloadState
import com.ebookreader.app.data.model.Book

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    viewModel: LibraryViewModel,
    onOpenBook: (String) -> Unit,
    onOpenSettings: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    var searchActive by remember { mutableStateOf(false) }
    var showFilterSheet by remember { mutableStateOf(false) }
    var selectedBook by remember { mutableStateOf<Book?>(null) }
    var showContextMenu by remember { mutableStateOf(false) }

    // 服务器地址前缀，用于拼封面绝对 URL（服务端返回的是相对路径）
    val baseUrl = state.serverUrl.trimEnd('/')
    fun coverOf(book: Book): String {
        val rel = book.coverUrl ?: "/api/books/${book.id}/cover"
        return if (rel.startsWith("http")) rel else "$baseUrl$rel"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (searchActive) {
                        OutlinedTextField(
                            value = state.search,
                            onValueChange = viewModel::setSearch,
                            placeholder = { Text("搜索书名、路径、标签") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    } else {
                        Column {
                            Text("郑在旅途的书库", fontWeight = FontWeight.Bold)
                            Text(
                                "${state.total} 本书 · ${state.serverUrl}",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                },
                navigationIcon = {
                    if (searchActive) {
                        IconButton(onClick = {
                            searchActive = false
                            viewModel.setSearch("")
                        }) { Icon(Icons.Default.Close, "关闭搜索") }
                    }
                },
                actions = {
                    if (!searchActive) {
                        IconButton(onClick = { searchActive = true }) {
                            Icon(Icons.Default.Search, "搜索")
                        }
                    }
                    IconButton(onClick = {
                        viewModel.setViewMode(
                            if (state.viewMode == ViewMode.GRID) ViewMode.LIST else ViewMode.GRID
                        )
                    }) {
                        Icon(
                            if (state.viewMode == ViewMode.GRID) Icons.Default.ViewList
                            else Icons.Default.GridView,
                            "切换视图"
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, "设置")
                    }
                }
            )
        }
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                state.loading -> LoadingView()
                state.error != null && state.books.isEmpty() -> ErrorView(
                    message = state.error!!,
                    onRetry = viewModel::refresh
                )
                else -> Column(Modifier.fillMaxSize()) {
                    FilterBar(
                        state = state,
                        onFolder = viewModel::setFolder,
                        onFormat = viewModel::setFormat,
                        onTag = viewModel::setTag,
                        onSort = viewModel::setSort,
                        onMoreFilter = { showFilterSheet = true }
                    )

                    if (state.recent.isNotEmpty() && state.search.isBlank() &&
                        state.folder == "all" && state.tag == null
                    ) {
                        RecentRow(recent = state.recent, coverOf = ::coverOf, onOpen = onOpenBook)
                    }

                    if (state.books.isEmpty()) {
                        EmptyView()
                    } else if (state.viewMode == ViewMode.GRID) {
                        BookGrid(
                            books = state.books,
                            coverOf = ::coverOf,
                            downloadStates = state.downloadStates,
                            onOpen = onOpenBook,
                            onLoadMore = viewModel::loadMore,
                            hasMore = state.hasMore,
                            onLongPress = { book -> selectedBook = book; showContextMenu = true }
                        )
                    } else {
                        BookList(
                            books = state.books,
                            coverOf = ::coverOf,
                            downloadStates = state.downloadStates,
                            onOpen = onOpenBook,
                            onLoadMore = viewModel::loadMore,
                            hasMore = state.hasMore,
                            onLongPress = { book -> selectedBook = book; showContextMenu = true }
                        )
                    }
                }
            }

            if (state.refreshing) {
                LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            }

            if (showFilterSheet) {
                SortSheet(
                    current = state.sort,
                    onSelect = { viewModel.setSort(it); showFilterSheet = false },
                    onDismiss = { showFilterSheet = false }
                )
            }

            // 长按书籍弹出的上下文菜单
            selectedBook?.let { book ->
                if (showContextMenu) {
                    val dlState = state.downloadStates[book.id]
                    val isDownloaded = dlState is com.ebookreader.app.data.DownloadState.Downloaded

                    AlertDialog(
                        onDismissRequest = { showContextMenu = false; selectedBook = null },
                        title = { Text(book.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        text = {
                            Text("${book.format.uppercase()} · ${formatSize(book.size)}", fontSize = 12.sp)
                        },
                        confirmButton = {
                            if (isDownloaded) {
                                TextButton(onClick = {
                                    viewModel.deleteDownload(book.id)
                                    showContextMenu = false
                                    selectedBook = null
                                }) {
                                    Text("删除下载", color = MaterialTheme.colorScheme.error)
                                }
                            } else {
                                TextButton(onClick = {
                                    viewModel.downloadBook(book)
                                    showContextMenu = false
                                    selectedBook = null
                                }) {
                                    Text("下载")
                                }
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { showContextMenu = false; selectedBook = null }) {
                                Text("取消")
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun FilterBar(
    state: LibraryUiState,
    onFolder: (String) -> Unit,
    onFormat: (String) -> Unit,
    onTag: (String?) -> Unit,
    onSort: (SortMode) -> Unit,
    onMoreFilter: () -> Unit
) {
    Column {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                FilterChip(
                    selected = state.folder == "all",
                    onClick = { onFolder("all") },
                    label = { Text("全部 (${state.total})") }
                )
            }
            items(state.folders) { folder ->
                FilterChip(
                    selected = state.folder == folder,
                    onClick = { onFolder(folder) },
                    label = { Text("$folder (${state.folderCounts[folder] ?: 0})") }
                )
            }
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val formats = listOf(
                "all" to "全部格式", "epub" to "EPUB", "pdf" to "PDF",
                "txt" to "TXT", "mobi" to "MOBI", "cbz" to "漫画"
            )
            items(formats) { (key, label) ->
                FilterChip(
                    selected = state.format == key,
                    onClick = { onFormat(key) },
                    label = { Text(label) }
                )
            }
            item {
                AssistChip(
                    onClick = onMoreFilter,
                    label = { Text(sortLabel(state.sort)) },
                    leadingIcon = { Icon(Icons.Default.Sort, null, Modifier.size(16.dp)) }
                )
            }
        }

        if (state.allTags.isNotEmpty()) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                item { Text("标签:", fontSize = 12.sp) }
                items(state.allTags) { tag ->
                    FilterChip(
                        selected = state.tag == tag,
                        onClick = { onTag(tag) },
                        label = { Text(tag, fontSize = 12.sp) }
                    )
                }
            }
        }
    }
}

private fun sortLabel(s: SortMode) = when (s) {
    SortMode.LAST_READ -> "最近阅读"
    SortMode.MODIFIED -> "修改日期"
    SortMode.TITLE -> "书名"
    SortMode.SIZE -> "大小"
}

@Composable
private fun RecentRow(recent: List<Book>, coverOf: (Book) -> String, onOpen: (String) -> Unit) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Text(
            "📖 最近阅读",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(recent, key = { it.id }) { book ->
                Column(
                    Modifier.width(84.dp).clickable { onOpen(book.id) }
                ) {
                    Box(
                        Modifier
                            .size(width = 84.dp, height = 112.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        AsyncImage(
                            model = coverOf(book),
                            contentDescription = book.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    Text(
                        book.title,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun BookGrid(
    books: List<Book>,
    coverOf: (Book) -> String,
    downloadStates: Map<String, DownloadState>,
    onOpen: (String) -> Unit,
    onLoadMore: () -> Unit,
    hasMore: Boolean,
    onLongPress: (Book) -> Unit
) {
    val gridState = rememberLazyGridState()
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            hasMore && last >= books.size - 12
        }
    }
    LaunchedEffect(shouldLoadMore) { if (shouldLoadMore) onLoadMore() }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 104.dp),
        state = gridState,
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(books, key = { it.id }) { book ->
            BookGridItem(
                book = book,
                coverOf = coverOf,
                downloadState = downloadStates[book.id],
                onClick = { onOpen(book.id) },
                onLongPress = { onLongPress(book) }
            )
        }
        if (hasMore) {
            item {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun BookGridItem(
    book: Book,
    coverOf: (Book) -> String,
    downloadState: DownloadState?,
    onClick: () -> Unit,
    onLongPress: () -> Unit
) {
    val isDownloaded = downloadState is DownloadState.Downloaded
    val isDownloading = downloadState is DownloadState.Downloading

    Column(
        Modifier
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongPress
            )
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            AsyncImage(
                model = coverOf(book),
                contentDescription = book.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            // 格式标签
            Surface(
                color = Color.Black.copy(alpha = 0.65f),
                shape = RoundedCornerShape(4.dp),
                modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
            ) {
                Text(
                    book.format.uppercase(),
                    fontSize = 9.sp,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                )
            }
            // 已下载图标
            if (isDownloaded) {
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.align(Alignment.TopStart).padding(4.dp).size(22.dp)
                ) {
                    Icon(
                        Icons.Default.CheckCircle,
                        "已下载",
                        tint = Color.White,
                        modifier = Modifier.padding(3.dp)
                    )
                }
            }
            // 下载进度条
            if (isDownloading) {
                val progress = (downloadState as DownloadState.Downloading).progress
                LinearProgressIndicator(
                    progress = { if (progress > 0f) progress else 0.3f },
                    modifier = Modifier.align(Alignment.BottomStart)
                        .fillMaxWidth().height(3.dp),
                    color = MaterialTheme.colorScheme.tertiary,
                    trackColor = Color.Black.copy(alpha = 0.3f)
                )
            } else if (book.progress > 0) {
                LinearProgressIndicator(
                    progress = { book.progress / 100f },
                    modifier = Modifier.align(Alignment.BottomStart)
                        .fillMaxWidth().height(3.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.Black.copy(alpha = 0.3f)
                )
            }
        }
        Text(
            book.title,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp,
            modifier = Modifier.padding(top = 6.dp)
        )
        Text(
            formatSize(book.size),
            fontSize = 10.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun BookList(
    books: List<Book>,
    coverOf: (Book) -> String,
    downloadStates: Map<String, DownloadState>,
    onOpen: (String) -> Unit,
    onLoadMore: () -> Unit,
    hasMore: Boolean,
    onLongPress: (Book) -> Unit
) {
    val gridState = rememberLazyGridState()
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            hasMore && last >= books.size - 12
        }
    }
    LaunchedEffect(shouldLoadMore) { if (shouldLoadMore) onLoadMore() }

    LazyVerticalGrid(
        columns = GridCells.Fixed(1),
        state = gridState,
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(books, key = { it.id }) { book ->
            val dlState = downloadStates[book.id]
            val isDownloaded = dlState is DownloadState.Downloaded
            val isDownloading = dlState is DownloadState.Downloading

            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .combinedClickable(
                        onClick = { onOpen(book.id) },
                        onLongClick = { onLongPress(book) }
                    )
                    .padding(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box {
                    AsyncImage(
                        model = coverOf(book),
                        contentDescription = book.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(width = 46.dp, height = 62.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                    )
                    if (isDownloaded) {
                        Icon(
                            Icons.Default.CheckCircle,
                            "已下载",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                                .align(Alignment.BottomEnd)
                                .background(
                                    MaterialTheme.colorScheme.surface,
                                    RoundedCornerShape(50)
                                )
                        )
                    }
                }
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(book.title, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${book.format.uppercase()} · ${formatSize(book.size)}",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (isDownloading) {
                            Spacer(Modifier.width(6.dp))
                            CircularProgressIndicator(
                                modifier = Modifier.size(12.dp).width(2.dp),
                                strokeWidth = 2.dp
                            )
                        }
                    }
                }
                Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (hasMore) {
            item {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SortSheet(current: SortMode, onSelect: (SortMode) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Text(
                "排序方式",
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(16.dp)
            )
            SortMode.entries.forEach { mode ->
                ListItem(
                    headlineContent = { Text(sortLabel(mode)) },
                    leadingContent = {
                        RadioButton(selected = current == mode, onClick = { onSelect(mode) })
                    },
                    modifier = Modifier.clickable { onSelect(mode) }
                )
            }
        }
    }
}

@Composable
private fun LoadingView() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(Modifier.height(12.dp))
            Text("加载书库中…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun EmptyView() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("📚", fontSize = 40.sp)
            Spacer(Modifier.height(8.dp))
            Text("没有找到书籍", fontWeight = FontWeight.Medium)
            Text("试试其他搜索词或筛选条件", fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ErrorView(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(24.dp)) {
            Icon(Icons.Default.CloudOff, null, Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Text("无法连接书库服务器", fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(4.dp))
            Text(message, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry) { Text("重试") }
        }
    }
}

fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024)
    else -> "%.1f GB".format(bytes / 1024.0 / 1024 / 1024)
}
