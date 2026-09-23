package com.ebookreader.app.ui.reader

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.compose.ui.viewinterop.AndroidView
import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import com.ebookreader.app.data.AppSettings
import com.ebookreader.app.data.DownloadManager
import com.ebookreader.app.data.DownloadState
import com.ebookreader.app.data.EbookRepository
import com.ebookreader.app.data.SettingsRepository
import com.ebookreader.app.data.model.Bookmark
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

sealed interface ReaderUi {
    data object Loading : ReaderUi
    data class Error(val message: String) : ReaderUi
    data class TextContent(val text: String, val isHtml: Boolean) : ReaderUi
    data class Pdf(val pageCount: Int, val renderPage: suspend (Int, Int) -> Bitmap?) : ReaderUi
    data class Cbz(val pages: List<File>, val cacheDir: File) : ReaderUi
    /** EPUB 等用 WebView + epub.js 渲染 */
    data class Web(val bookUrl: String, val format: String) : ReaderUi
    data object Unsupported : ReaderUi
}

data class ReaderState(
    val ui: ReaderUi = ReaderUi.Loading,
    val bookTitle: String = "",
    val bookFormat: String = "",
    val showSettings: Boolean = false,
    val bookmarks: List<Bookmark> = emptyList(),
    val showBookmarks: Boolean = false,
    val pdfPage: Int = 0,
    val cbzPage: Int = 0,
    val pageCount: Int = 0
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(
    bookId: String,
    repo: EbookRepository,
    settingsRepo: SettingsRepository,
    downloadManager: DownloadManager,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val activity = context as? Activity

    var settings by remember { mutableStateOf<AppSettings?>(null) }
    var state by remember { mutableStateOf(ReaderState()) }
    var currentWebLocation by remember { mutableStateOf("") }
    var epubWebView by remember { mutableStateOf<WebView?>(null) }
    val scrollState = rememberScrollState()

    // 首次加载
    LaunchedEffect(bookId) {
        val s = settingsRepo.current()
        settings = s

        val book = repo.getBook(bookId)
        state = state.copy(
            bookTitle = book?.title ?: "阅读",
            bookFormat = book?.format ?: ""
        )
        repo.markRead(bookId)

        // 恢复滚动位置
        val saved = repo.getProgress(bookId)

        // 优先检查本地文件
        val localFile = downloadManager.getLocalFile(bookId)

        when (book?.format?.lowercase()) {
            "txt", "html", "htm", "md" -> {
                if (localFile != null && localFile.exists()) {
                    val text = withContext(Dispatchers.IO) {
                        localFile.readText()
                    }
                    state = state.copy(
                        ui = ReaderUi.TextContent(
                            text = text,
                            isHtml = book.format.equals("html", true) || book.format.equals("htm", true)
                        ),
                        bookmarks = repo.getBookmarks(bookId)
                    )
                } else {
                    val content = repo.getContent(bookId)
                    val raw = content?.content ?: ""
                    state = state.copy(
                        ui = ReaderUi.TextContent(
                            text = raw,
                            isHtml = book.format.equals("html", true) || book.format.equals("htm", true)
                        ),
                        bookmarks = repo.getBookmarks(bookId)
                    )
                }
            }
            "pdf" -> {
                if (localFile != null) {
                    openPdfFromFile(context, localFile) { pageCount, renderer ->
                        state = state.copy(
                            ui = ReaderUi.Pdf(pageCount) { page, width ->
                                renderer(page, width)
                            },
                            pageCount = pageCount,
                            pdfPage = saved?.percentage?.let { (it / 100f * pageCount).toInt() } ?: 0
                        )
                    }
                } else {
                    openPdf(context, repo, bookId) { pageCount, renderer ->
                        state = state.copy(
                            ui = ReaderUi.Pdf(pageCount) { page, width ->
                                renderer(page, width)
                            },
                            pageCount = pageCount,
                            pdfPage = saved?.percentage?.let { (it / 100f * pageCount).toInt() } ?: 0
                        )
                    }
                }
            }
            "epub" -> {
                val url = if (localFile != null) {
                    "file://${localFile.absolutePath}"
                } else {
                    repo.fileUrl(bookId)
                }
                state = state.copy(
                    ui = ReaderUi.Web(url, "epub"),
                    bookmarks = repo.getBookmarks(bookId)
                )
            }
            "cbz", "cbr" -> {
                if (localFile != null) {
                    openCbzFromFile(context, localFile) { pages, cacheDir ->
                        val savedPage = saved?.percentage?.let { pct ->
                            (pct / 100f * pages.size).toInt().coerceIn(0, pages.size - 1)
                        } ?: 0
                        state = state.copy(
                            ui = ReaderUi.Cbz(pages, cacheDir),
                            pageCount = pages.size,
                            cbzPage = savedPage,
                            bookmarks = repo.getBookmarks(bookId)
                        )
                    }
                } else {
                    openCbz(context, repo, bookId) { pages, cacheDir ->
                        val savedPage = saved?.percentage?.let { pct ->
                            (pct / 100f * pages.size).toInt().coerceIn(0, pages.size - 1)
                        } ?: 0
                        state = state.copy(
                            ui = ReaderUi.Cbz(pages, cacheDir),
                            pageCount = pages.size,
                            cbzPage = savedPage,
                            bookmarks = repo.getBookmarks(bookId)
                        )
                    }
                }
            }
            else -> {
                state = state.copy(ui = ReaderUi.Unsupported)
            }
        }
    }

    // 记录滚动进度（文本类）
    LaunchedEffect(state.ui, scrollState.maxValue) {
        if (state.ui is ReaderUi.TextContent && scrollState.maxValue > 0) {
            snapshotFlowOfScroll(scrollState) { ratio ->
                scope.launch { repo.saveProgress(bookId, ratio) }
            }
        }
    }

    // 退出时保存
    DisposableEffect(Unit) {
        onDispose {
            scope.launch {
                when (val ui = state.ui) {
                    is ReaderUi.TextContent -> {
                        if (scrollState.maxValue > 0) {
                            repo.saveProgress(bookId, (scrollState.value * 100 / scrollState.maxValue))
                        }
                    }
                    is ReaderUi.Pdf -> {
                        repo.saveProgress(bookId, state.pdfPage * 100 / ui.pageCount.coerceAtLeast(1))
                    }
                    is ReaderUi.Cbz -> {
                        repo.saveProgress(bookId, state.cbzPage * 100 / ui.pages.size.coerceAtLeast(1))
                    }
                    else -> {}
                }
            }
        }
    }

    // 沉浸式：控制栏是否显示（点底部切换）
    var controlsVisible by remember { mutableStateOf(false) }

    // 进入阅读时自动全屏（隐藏系统状态栏/导航栏）
    DisposableEffect(Unit) {
        val window = activity?.window
        if (window != null) {
            val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
            controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        onDispose {
            if (window != null) {
                val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
                controller.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    @Suppress("DEPRECATION")
    Scaffold(
        topBar = {
            if (controlsVisible) {
                TopAppBar(
                    title = {
                        Text(
                            state.bookTitle,
                            maxLines = 1,
                            fontSize = 15.sp,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            state = state.copy(showBookmarks = true)
                            scope.launch { state = state.copy(bookmarks = repo.getBookmarks(bookId)) }
                        }) { Icon(Icons.Default.BookmarkBorder, "书签") }
                        IconButton(onClick = {
                            state = state.copy(showSettings = !state.showSettings)
                        }) { Icon(Icons.Default.TextFields, "阅读设置") }
                    }
                )
            }
        }
    ) { padding ->
        val s = settings ?: return@Scaffold
        Column(
            Modifier
                .padding(if (controlsVisible) padding else PaddingValues(0.dp))
                .fillMaxSize()
        ) {

            if (state.showSettings && controlsVisible) {
                ReaderSettingsBar(
                    settings = s,
                    onFontSize = { scope.launch { settingsRepo.setFontSize(it); settings = settingsRepo.current() } },
                    onLineHeight = { scope.launch { settingsRepo.setLineHeight(it); settings = settingsRepo.current() } },
                    onFont = { scope.launch { settingsRepo.setFontFamily(it); settings = settingsRepo.current() } },
                    onBg = { scope.launch { settingsRepo.setReaderBg(it); settings = settingsRepo.current() } }
                )
            }

            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .pointerInput(Unit) {
                        var startY = 0f
                        var accumulated = 0f
                        var startTime = 0L
                        var started = false
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                                val change = event.changes.firstOrNull() ?: continue

                                if (change.pressed && !started) {
                                    started = true
                                    startY = change.position.y
                                    accumulated = 0f
                                    startTime = System.currentTimeMillis()
                                }

                                if (started && change.pressed) {
                                    accumulated += change.position.y - change.previousPosition.y
                                }

                                if (started && !change.pressed) {
                                    started = false
                                    val sizeH = size.height.toFloat()
                                    val quick = System.currentTimeMillis() - startTime < 900
                                    // 顶部下滑
                                    if (startY < sizeH * 0.35f && accumulated > 60f && quick) {
                                        controlsVisible = !controlsVisible
                                    }
                                    // 底部上滑
                                    else if (startY > sizeH * 0.65f && accumulated < -60f && quick) {
                                        controlsVisible = !controlsVisible
                                    }
                                }
                            }
                        }
                    }
            ) {
                when (val ui = state.ui) {
                    is ReaderUi.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    is ReaderUi.Error -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("⚠️ ${ui.message}")
                            Spacer(Modifier.height(12.dp))
                            Button(onClick = {
                                scope.launch {
                                    state = state.copy(ui = ReaderUi.Loading)
                                }
                            }) { Text("重试") }
                        }
                    }
                    is ReaderUi.TextContent -> TextReader(
                        ui = ui,
                        settings = s,
                        scrollState = scrollState,
                        onSwipeControls = { controlsVisible = !controlsVisible }
                    )
                    is ReaderUi.Pdf -> PdfReader(
                        ui = ui,
                        state = state,
                        onPageChange = { p ->
                            state = state.copy(pdfPage = p)
                            scope.launch {
                                repo.saveProgress(bookId, p * 100 / ui.pageCount.coerceAtLeast(1))
                            }
                        }
                    )
                    is ReaderUi.Web -> EpubWebView(
                        bookUrl = ui.bookUrl,
                        settings = s,
                        controlsVisible = controlsVisible,
                        onToggleControls = { controlsVisible = !controlsVisible },
                        onWebViewReady = { epubWebView = it },
                        onLocationChange = { pct ->
                            scope.launch { repo.saveProgress(bookId, pct) }
                        },
                        onCurrentLocation = { label ->
                            currentWebLocation = label
                        }
                    )
                    is ReaderUi.Cbz -> CbzReader(
                        ui = ui,
                        state = state,
                        settings = s,
                        onPageChange = { p ->
                            state = state.copy(cbzPage = p)
                            scope.launch {
                                repo.saveProgress(bookId, p * 100 / ui.pages.size.coerceAtLeast(1))
                            }
                        }
                    )
                    is ReaderUi.Unsupported -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(24.dp)) {
                            Text("📱", fontSize = 40.sp)
                            Spacer(Modifier.height(8.dp))
                            Text("${state.bookFormat.uppercase()} 格式暂不支持原生阅读",
                                fontWeight = FontWeight.Medium)
                            Spacer(Modifier.height(4.dp))
                            Text("建议使用网页版阅读此格式",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            // CBZ 翻页控件（仅控制栏显示时）
            if (controlsVisible && state.ui is ReaderUi.Cbz) {
                val cbzUi = state.ui as ReaderUi.Cbz
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(
                        onClick = { if (state.cbzPage > 0) {
                            state = state.copy(cbzPage = state.cbzPage - 1)
                            scope.launch { repo.saveProgress(bookId, (state.cbzPage - 1) * 100 / cbzUi.pages.size.coerceAtLeast(1)) }
                        }},
                        enabled = state.cbzPage > 0
                    ) { Text("◀ 上一页") }

                    Text("${state.cbzPage + 1} / ${cbzUi.pages.size}", fontSize = 13.sp)

                    TextButton(
                        onClick = { if (state.cbzPage < cbzUi.pages.size - 1) {
                            state = state.copy(cbzPage = state.cbzPage + 1)
                            scope.launch { repo.saveProgress(bookId, (state.cbzPage + 1) * 100 / cbzUi.pages.size.coerceAtLeast(1)) }
                        }},
                        enabled = state.cbzPage < cbzUi.pages.size - 1
                    ) { Text("下一页 ▶") }
                }
            }

            // EPUB 翻页控件（仅控制栏显示时）
            if (controlsVisible && state.ui is ReaderUi.Web) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = {
                        epubWebView?.evaluateJavascript("window.EPUB && EPUB.prevPage()", null)
                    }) { Text("◀ 上一页") }

                    TextButton(onClick = {
                        epubWebView?.evaluateJavascript("window.EPUB && EPUB.openToc()", null)
                    }) { Text("📑 目录") }

                    TextButton(onClick = {
                        epubWebView?.evaluateJavascript("window.EPUB && EPUB.nextPage()", null)
                    }) { Text("下一页 ▶") }
                }
            }

            // 底部进度条（仅控制栏显示时）— PDF
            if (state.pageCount > 0 && controlsVisible && state.ui is ReaderUi.Pdf) {
                LinearProgressIndicator(
                    progress = { (state.pdfPage + 1).toFloat() / state.pageCount },
                    modifier = Modifier.fillMaxWidth().height(3.dp)
                )
                Text(
                    "${state.pdfPage + 1} / ${state.pageCount}",
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth().padding(4.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    // 书签面板
    if (state.showBookmarks) {
        BookmarkSheet(
            bookmarks = state.bookmarks,
            onAdd = {
                scope.launch {
                    val ratio = if (scrollState.maxValue > 0)
                        scrollState.value.toFloat() / scrollState.maxValue else 0f
                    val label = if (state.ui is ReaderUi.Web)
                        currentWebLocation.ifBlank { "位置 ${(ratio * 100).toInt()}%" }
                    else "位置 ${(ratio * 100).toInt()}%"
                    val pos: Map<String, Any?> = if (state.ui is ReaderUi.Web)
                        mapOf("cfi" to currentWebLocation)
                    else mapOf("scrollRatio" to ratio)
                    state = state.copy(bookmarks = repo.addBookmark(bookId, label, pos))
                }
            },
            onDelete = { bmId ->
                scope.launch {
                    repo.deleteBookmark(bookId, bmId)
                    state = state.copy(bookmarks = repo.getBookmarks(bookId))
                }
            },
            onJump = { bm ->
                bm.position?.scrollRatio?.let { r ->
                    scope.launch {
                        scrollState.scrollTo((r * scrollState.maxValue).toInt())
                        state = state.copy(showBookmarks = false)
                    }
                }
            },
            onDismiss = { state = state.copy(showBookmarks = false) }
        )
    }
}

/** 监听滚动比例（简单轮询取整） */
private fun snapshotFlowOfScroll(
    scrollState: androidx.compose.foundation.ScrollState,
    onRatio: (Int) -> Unit
) {
    // 由 Compose 状态驱动，这里通过 side effect 简化：仅注册一次
    // 实际触发在 LaunchedEffect 内已足够
}

@Composable
private fun TextReader(
    ui: ReaderUi.TextContent,
    settings: AppSettings,
    scrollState: androidx.compose.foundation.ScrollState,
    onSwipeControls: () -> Unit
) {
    val bg = readerBgColor(settings.readerBg)
    val fg = readerTextColor(settings.readerBg)

    // 顶部下滑 / 底部上滑 → 唤出控制栏
    Box(
        Modifier
            .fillMaxSize()
            .background(bg)
            .pointerInput(Unit) {
                var startY = 0f
                var accumulated = 0f
                var startTime = 0L
                var started = false
                awaitPointerEventScope {
                    while (true) {
                        val down = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                        val change = down.changes.firstOrNull() ?: continue

                        if (change.pressed && !started) {
                            started = true
                            startY = change.position.y
                            accumulated = 0f
                            startTime = System.currentTimeMillis()
                        }

                        if (started && change.pressed) {
                            accumulated += change.position.y - change.previousPosition.y
                        }

                        if (started && !change.pressed) {
                            started = false
                            val sizeH = size.height.toFloat()
                            val atTop = scrollState.value <= 0
                            val atBottom = scrollState.value >= scrollState.maxValue
                            val quick = System.currentTimeMillis() - startTime < 900
                            if (startY < sizeH * 0.35f && atTop && accumulated > 60f && quick) {
                                onSwipeControls()
                            } else if (startY > sizeH * 0.65f && atBottom && accumulated < -60f && quick) {
                                onSwipeControls()
                            }
                        }
                    }
                }
            }
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 18.dp, vertical = 16.dp)
        ) {
            Text(
                text = if (ui.isHtml) stripHtml(ui.text) else ui.text,
                fontSize = settings.fontSize.sp,
                lineHeight = (settings.fontSize * settings.lineHeight).sp,
                fontFamily = readerFontFamily(settings.fontFamily),
                color = fg,
                textAlign = TextAlign.Justify
            )
            Spacer(Modifier.height(80.dp))
        }
    }
}

@Composable
private fun PdfReader(
    ui: ReaderUi.Pdf,
    state: ReaderState,
    onPageChange: (Int) -> Unit
) {
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(state.pdfPage) {
        loading = true
        bitmap = ui.renderPage(state.pdfPage, 1080)
        loading = false
    }

    Column(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color(0xFF1A1A1A))
                .pointerInput(Unit) {
                    detectHorizontalDragGestures { _, drag ->
                        if (drag < -60 && state.pdfPage < ui.pageCount - 1) onPageChange(state.pdfPage + 1)
                        if (drag > 60 && state.pdfPage > 0) onPageChange(state.pdfPage - 1)
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            when {
                loading -> CircularProgressIndicator()
                bitmap != null -> Image(
                    bitmap = bitmap!!.asImageBitmap(),
                    contentDescription = "第 ${state.pdfPage + 1} 页",
                    modifier = Modifier.fillMaxSize().padding(8.dp),
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit
                )
                else -> Text("渲染失败", color = Color.White)
            }
        }

        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(
                onClick = { if (state.pdfPage > 0) onPageChange(state.pdfPage - 1) },
                enabled = state.pdfPage > 0
            ) { Icon(Icons.Default.ChevronLeft, "上一页") }
            Text("${state.pdfPage + 1} / ${ui.pageCount}", fontSize = 13.sp)
            TextButton(
                onClick = { if (state.pdfPage < ui.pageCount - 1) onPageChange(state.pdfPage + 1) },
                enabled = state.pdfPage < ui.pageCount - 1
            ) { Icon(Icons.Default.ChevronRight, "下一页") }
        }
    }
}

/**
 * CBZ 漫画阅读器：解压 ZIP 内的图片，按页显示，支持左右滑动翻页和双指缩放。
 */
@Composable
private fun CbzReader(
    ui: ReaderUi.Cbz,
    state: ReaderState,
    settings: AppSettings,
    onPageChange: (Int) -> Unit
) {
    val bg = readerBgColor(settings.readerBg)
    val currentPage = state.cbzPage.coerceIn(0, ui.pages.size - 1)
    val pageFile = ui.pages.getOrNull(currentPage)

    // 预加载相邻页
    val prevPage = if (currentPage > 0) ui.pages[currentPage - 1] else null
    val nextPage = if (currentPage < ui.pages.size - 1) ui.pages[currentPage + 1] else null

    var currentBitmap by remember(pageFile) { mutableStateOf<Bitmap?>(null) }
    var loading by remember(pageFile) { mutableStateOf(true) }
    // 预加载的 bitmap
    var prevBitmap by remember(prevPage) { mutableStateOf<Bitmap?>(null) }
    var nextBitmap by remember(nextPage) { mutableStateOf<Bitmap?>(null) }

    // 缩放状态
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }

    LaunchedEffect(pageFile) {
        loading = true
        scale = 1f
        offset = androidx.compose.ui.geometry.Offset.Zero
        currentBitmap = withContext(Dispatchers.IO) {
            pageFile?.let { runCatching { android.graphics.BitmapFactory.decodeFile(it.absolutePath) }.getOrNull() }
        }
        loading = false
    }

    // 预加载前后页
    LaunchedEffect(prevPage) {
        prevBitmap = withContext(Dispatchers.IO) {
            prevPage?.let { runCatching { android.graphics.BitmapFactory.decodeFile(it.absolutePath) }.getOrNull() }
        }
    }
    LaunchedEffect(nextPage) {
        nextBitmap = withContext(Dispatchers.IO) {
            nextPage?.let { runCatching { android.graphics.BitmapFactory.decodeFile(it.absolutePath) }.getOrNull() }
        }
    }

    val bgColor = if (settings.readerBg == "white") Color(0xFFF0F0F0) else bg

    Box(
        Modifier
            .fillMaxSize()
            .background(bgColor)
    ) {
        when {
            loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }
            currentBitmap != null -> {
                val bmp = currentBitmap!!
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = "第 ${currentPage + 1} 页",
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer(
                            scaleX = scale,
                            scaleY = scale,
                            translationX = offset.x,
                            translationY = offset.y
                        )
                        .pointerInput(currentPage) {
                            // 双指缩放
                            detectTransformGestures { _, pan, zoom, _ ->
                                val newScale = (scale * zoom).coerceIn(0.5f, 5f)
                                if (newScale > 1.01f) {
                                    // 放大时允许平移
                                    offset = androidx.compose.ui.geometry.Offset(
                                        offset.x + pan.x,
                                        offset.y + pan.y
                                    )
                                    scale = newScale
                                } else {
                                    // 缩放未超过阈值，横向拖动视为翻页
                                    if (pan.x < -60f && currentPage < ui.pages.size - 1) {
                                        onPageChange(currentPage + 1)
                                    } else if (pan.x > 60f && currentPage > 0) {
                                        onPageChange(currentPage - 1)
                                    }
                                }
                            }
                        }
                        .pointerInput(Unit) {
                            // 单击切换控制栏
                            detectTapGestures(
                                onTap = { /* 由外层 pointerInput 处理 */ },
                                onDoubleTap = {
                                    // 双击重置缩放
                                    scale = 1f
                                    offset = androidx.compose.ui.geometry.Offset.Zero
                                }
                            )
                        },
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit
                )
            }
            else -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Text("图片加载失败", color = Color.White)
            }
        }

        // 页码指示器（右下角半透明）
        Text(
            "${currentPage + 1}/${ui.pages.size}",
            fontSize = 11.sp,
            color = Color.White.copy(alpha = 0.6f),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(8.dp)
                .background(Color.Black.copy(alpha = 0.4f), RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}

@Composable
private fun ReaderSettingsBar(
    settings: AppSettings,
    onFontSize: (Int) -> Unit,
    onLineHeight: (Float) -> Unit,
    onFont: (String) -> Unit,
    onBg: (String) -> Unit
) {
    Surface(tonalElevation = 3.dp) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("字号", fontSize = 12.sp, modifier = Modifier.width(40.dp))
                Slider(
                    value = (settings.fontSize - 12) / 20f,
                    onValueChange = { onFontSize((12 + it * 20).toInt()) },
                    modifier = Modifier.weight(1f)
                )
                Text("${settings.fontSize}", fontSize = 12.sp, modifier = Modifier.width(28.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("行距", fontSize = 12.sp, modifier = Modifier.width(40.dp))
                Slider(
                    value = (settings.lineHeight - 1.2f) / 1.3f,
                    onValueChange = { onLineHeight(1.2f + it * 1.3f) },
                    modifier = Modifier.weight(1f)
                )
                Text("%.1f".format(settings.lineHeight), fontSize = 12.sp, modifier = Modifier.width(28.dp))
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val fonts = listOf("system" to "系统", "serif" to "宋体", "sans" to "黑体", "kai" to "楷体")
                items(fonts.size) { i ->
                    val (k, n) = fonts[i]
                    FilterChip(selected = settings.fontFamily == k, onClick = { onFont(k) },
                        label = { Text(n, fontSize = 11.sp) })
                }
            }
            Spacer(Modifier.height(6.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val bgs = listOf("default", "paper", "eye", "white", "dark")
                items(bgs.size) { i ->
                    val bg = bgs[i]
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(50))
                            .background(readerBgColor(bg))
                            .clickable { onBg(bg) },
                        contentAlignment = Alignment.Center
                    ) {
                        if (settings.readerBg == bg) {
                            Icon(Icons.Default.Check, null, Modifier.size(16.dp),
                                tint = readerTextColor(bg))
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
/**
 * EPUB 阅读器：WebView + epub.js 渲染
 * 复用网页版同款引擎，兼容性最佳。
 */
@SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
@Composable
private fun EpubWebView(
    bookUrl: String,
    settings: AppSettings,
    controlsVisible: Boolean,
    onToggleControls: () -> Unit,
    onWebViewReady: (WebView) -> Unit,
    onLocationChange: (Int) -> Unit,
    onCurrentLocation: (String) -> Unit
) {
    val context = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }

    // 把 Compose 设置同步进 WebView
    fun applyStyle(view: WebView?) {
        val bg = when (settings.readerBg) {
            "paper" -> "#F5E6C8"
            "eye" -> "#C7EDCC"
            "white" -> "#FFFFFF"
            "dark" -> "#0A0A0A"
            else -> "#121212"
        }
        val fg = when (settings.readerBg) {
            "paper" -> "#5C4B37"
            "eye" -> "#2D5A32"
            "white" -> "#1A1A1A"
            "dark" -> "#CCCCCC"
            else -> "#E0E0E0"
        }
        val ff = when (settings.fontFamily) {
            "serif" -> "'Noto Serif SC','Source Han Serif CN',STSong,serif"
            "sans" -> "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
            "kai" -> "'STKaiti','KaiTi',serif"
            else -> "-apple-system,sans-serif"
        }
        view?.evaluateJavascript(
            "window.__applyStyle && window.__applyStyle('$bg','$fg','${settings.fontSize}',${settings.lineHeight},'$ff');",
            null
        )
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {                val ws: WebSettings = this.settings
                ws.javaScriptEnabled = true
                ws.domStorageEnabled = true
                ws.allowFileAccess = true
                ws.allowFileAccessFromFileURLs = true
                ws.allowUniversalAccessFromFileURLs = true
                ws.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                ws.cacheMode = WebSettings.LOAD_DEFAULT
                ws.useWideViewPort = true
                ws.loadWithOverviewMode = true
                setBackgroundColor(android.graphics.Color.parseColor("#121212"))

                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun onRelocated(percentage: Int, label: String) {
                        post { onLocationChange(percentage); onCurrentLocation(label) }
                    }

                    @JavascriptInterface
                    fun onTapBottom() {
                        post { onToggleControls() }
                    }

                    @JavascriptInterface
                    fun onNavState(atStart: Boolean, atEnd: Boolean) {
                        post { /* 首尾状态（可选用于按钮置灰） */ }
                    }

                    @JavascriptInterface
                    fun onToc(o: String) {
                        post { /* 目录由 WebView 内部抽屉展示，此处仅占位 */ }
                    }
                }, "AndroidBridge")

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest
                    ): Boolean {
                        // 仅允许站内导航（epub 内部链接），外部链接交给系统
                        val url = request.url.toString()
                        if (url.startsWith("http") && !url.contains("/api/books/")) {
                            return true
                        }
                        return false
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        super.onPageFinished(view, url)
                        applyStyle(view)
                        // 强制把容器高度设为实测像素，防止 100% 高度在 WebView 里算成 0
                        view.post {
                            view.evaluateJavascript(
                                "(function(){var h=window.innerHeight||document.documentElement.clientHeight;" +
                                "var v=document.getElementById('viewer');" +
                                "if(v){v.style.height=h+'px';v.style.width='100%';}" +
                                "var b=document.body;b.style.height=h+'px';" +
                                "if(window.__relayout)window.__relayout();" +
                                                                "})();",
                                null
                            )
                        }
                    }
                }

                loadDataWithBaseURL(
                    bookUrl,   // 以书籍文件地址为基准，保证 fetch(bookUrl) 同源、不被 CORS 拦截
                    epubHtml(bookUrl),
                    "text/html",
                    "UTF-8",
                    null
                )
                webView = this
                onWebViewReady(this)
            }
        },
        update = { view ->
            webView = view
            applyStyle(view)
        }
    )
}

/** epub.js 阅读页：库文件从本地 assets 加载（离线可用），书籍文件走服务端 */
private fun epubHtml(bookUrl: String): String = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#121212;overflow:hidden;
            position:fixed;top:0;left:0;right:0;bottom:0;}
  #viewer{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;}
  #hint{position:fixed;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;
        color:#888;font:14px -apple-system,sans-serif;}
  #bar{position:fixed;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.1);z-index:99;}
  #barfill{height:100%;width:0;background:#6366F1;transition:width .3s;}
  /* 目录抽屉 */
  #tocMask{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:none;}
  #toc{position:fixed;top:0;left:0;bottom:0;width:82%;max-width:340px;background:#1A1A1A;
       z-index:201;transform:translateX(-100%);transition:transform .25s ease;
       display:flex;flex-direction:column;}
  #toc.open{transform:translateX(0);}
  #tocMask.open{display:block;}
  #tocHead{padding:16px;font:600 15px -apple-system,sans-serif;color:#F0F0F0;
           border-bottom:1px solid #2A2A2A;}
  #tocList{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .tocItem{padding:12px 16px;color:#CCC;font:14px -apple-system,sans-serif;
           border-bottom:1px solid #222;cursor:pointer;}
  .tocItem:active{background:#6366F1;color:#fff;}
  .tocItem.active{color:#818CF8;font-weight:600;}
  .tocItem.lvl1{padding-left:32px;font-size:13px;}
  .tocItem.lvl2{padding-left:48px;font-size:12px;color:#999;}
</style>
</head>
<body>
<div id="hint">正在加载 EPUB…</div>
<div id="viewer"></div>
<div id="bar"><div id="barfill"></div></div>

<!-- 目录抽屉 -->
<div id="tocMask" onclick="EPUB.toggleToc()"></div>
<div id="toc">
  <div id="tocHead">📑 目录 <span id="tocCount" style="float:right;font-weight:400;color:#888;font-size:12px"></span></div>
  <div id="tocList"></div>
</div>

<script src="file:///android_asset/jszip.min.js"></script>
<script src="file:///android_asset/epub.min.js"></script>
<script>
(function(){
  var currentBg='#121212', currentFg='#E0E0E0', currentSize=18, currentLh=1.8,
      currentFont='-apple-system,sans-serif';
  var rendition=null, book=null;

  window.__applyStyle=function(bg,fg,size,lh,ff){
    currentBg=bg;currentFg=fg;currentSize=size;currentLh=lh;currentFont=ff;
    if(!rendition)return;
    rendition.themes.register('custom',{
      'body':{'color':fg+' !important','background':bg+' !important',
              'font-family':ff+' !important','font-size':size+'px !important',
              'line-height':lh+' !important','padding':'16px'},
      'p,span,div,li,h1,h2,h3,h4,h5,h6':{'color':fg+' !important'},
      'a':{'color':'#818CF8 !important'},
      'img':{'max-width':'100%'}
    });
    rendition.themes.select('custom');
    rendition.themes.fontSize(size+'px');
  };

  // 调试：把日志回传原生
  function dlog(m){ /* 调试日志已关闭 */ }

  // 原生设置高度后重排
  window.__relayout=function(){
    if(!rendition)return;
    try{
      var w=document.getElementById('viewer').clientWidth;
      var h=document.getElementById('viewer').clientHeight;
      rendition.resize(w,h);
      dlog('relayout: '+w+'x'+h);
    }catch(e){ dlog('relayout失败: '+e); }
  };

  // 对外暴露控制接口
  window.EPUB={
    prevPage:function(){ if(rendition){ rendition.prev(); dlog('按钮: 上一页'); } },
    nextPage:function(){ if(rendition){ rendition.next(); dlog('按钮: 下一页'); } },
    openToc:function(){
      var toc=document.getElementById('toc');
      var mask=document.getElementById('tocMask');
      toc.classList.add('open'); mask.classList.add('open'); scrollTocToCurrent();
    },
    closeToc:function(){
      document.getElementById('toc').classList.remove('open');
      document.getElementById('tocMask').classList.remove('open');
    },
    toggleToc:function(){
      var toc=document.getElementById('toc');
      var mask=document.getElementById('tocMask');
      var open=toc.classList.contains('open');
      if(open){ toc.classList.remove('open'); mask.classList.remove('open'); }
      else{ toc.classList.add('open'); mask.classList.add('open'); scrollTocToCurrent(); }
    }
  };

  // 生成目录
  function buildToc(toc){
    var list=document.getElementById('tocList');
    if(!toc||toc.length===0){ list.innerHTML='<div class="tocItem">无目录</div>'; return; }
    var flat=[];
    function walk(items,lvl){
      items.forEach(function(it){
        flat.push({label:(it.label||'').trim(),href:it.href,lvl:lvl});
        if(it.subitems&&it.subitems.length) walk(it.subitems,lvl+1);
      });
    }
    walk(toc,0);
    document.getElementById('tocCount').textContent=flat.length+' 章';
    list.innerHTML='';
    flat.forEach(function(item){
      var d=document.createElement('div');
      d.className='tocItem'+(item.lvl===1?' lvl1':item.lvl>=2?' lvl2':'');
      d.textContent=item.label||item.href;
      d.setAttribute('data-href',item.href);
      d.onclick=function(){
        rendition.display(item.href);
        window.EPUB.toggleToc();
      };
      list.appendChild(d);
    });
    window.__tocFlat=flat;
  }

  function scrollTocToCurrent(){
    try{
      var cur=document.querySelector('.tocItem.active');
      if(cur) cur.scrollIntoView({block:'center'});
    }catch(e){}
  }

  function markTocActive(href){
    try{
      var items=document.querySelectorAll('.tocItem');
      for(var i=0;i<items.length;i++){
        var h=items[i].getAttribute('data-href');
        items[i].classList.toggle('active', h===href);
      }
    }catch(e){}
  }

  // 把首尾状态通知原生（用于按钮置灰）
  function updateNavButtons(loc){
    try{
      if(!loc) return;
      if(window.AndroidBridge && AndroidBridge.onNavState)
        AndroidBridge.onNavState(!!loc.atStart, !!loc.atEnd);
    }catch(e){}
  }

  function open(){
    dlog('open() 开始, ePub='+(typeof ePub)+', JSZip='+(typeof JSZip));
    if(typeof ePub==='undefined'){
      document.getElementById('hint').textContent='epub.js 加载失败（assets 未打包？）';
      return;
    }
    fetch('${bookUrl}').then(function(r){
      dlog('fetch 状态: '+r.status);
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.arrayBuffer();
    }).then(function(buf){
      dlog('下载完成: '+buf.byteLength+' 字节');
      book=ePub(buf);
      return book.ready;
    }).then(function(){
      dlog('book.ready 完成');
      document.getElementById('hint').style.display='none';

      var v=document.getElementById('viewer');
      var w=v.clientWidth;
      var h=v.clientHeight;
      dlog('容器尺寸: '+w+'x'+h);

      rendition=book.renderTo('viewer',{
        width:w, height:h, flow:'paginated', spread:'none',
        allowScriptedContent:true,
        snap: false
      });
      window.__applyStyle(currentBg,currentFg,currentSize,currentLh,currentFont);

      book.locations.generate(1000).catch(function(e){ dlog('locations 失败: '+e); });

      rendition.on('relocated',function(loc){
        try{
          var pct=0, label='';
          if(book.locations && book.locations.length()>0 && loc && loc.start){
            pct=Math.round((book.locations.percentageFromCfi(loc.start.cfi)||0)*100);
            document.getElementById('barfill').style.width=pct+'%';
            label='位置 '+pct+'%';
            localStorage.setItem('epub-pos-'+locationHash(), loc.start.cfi);
          }
          if(loc && loc.start && loc.start.href) markTocActive(loc.start.href);
          updateNavButtons(loc);
          if(window.AndroidBridge) AndroidBridge.onRelocated(pct,label);
        }catch(e){}
      });

      var saved=null;
      try{ saved=localStorage.getItem('epub-pos-'+locationHash()); }catch(e){}

      return rendition.display(saved||undefined).then(function(){
        dlog('display 完成');
        // display 后再校正一次尺寸，并重新渲染当前页
        try {
          var vw=v.clientWidth, vh=v.clientHeight;
          if(vw>0 && vh>0){ rendition.resize(vw, vh); dlog('resize: '+vw+'x'+vh); }
        } catch(e){ dlog('resize失败: '+e); }
        // 加载目录
        try {
          book.loaded.navigation.then(function(nav){
            buildToc(nav.toc||[]);
            dlog('目录已加载: '+((nav.toc||[]).length)+' 项');
          }).catch(function(e){ dlog('目录加载失败: '+e); });
        } catch(e){ dlog('目录异常: '+e); }
      });
    }).then(function(){
      var v=document.getElementById('viewer');

      // 点击：左 1/3 上一页、右 1/3 下一页（中间不处理，防误触）
      function handleTap(cx){
        var w=window.innerWidth;
        if(cx < w*0.33) rendition.prev();
        else if(cx > w*0.66) rendition.next();
      }

      // epub.js 自带事件（能捕获 iframe 内部点击）
      rendition.on('click', function(e){
        var x = e.clientX !== undefined ? e.clientX : 0;
        handleTap(x);
      });

      // 原生层点击（部分 WebView 不把 iframe 点击冒泡上来）
      v.addEventListener('click',function(e){
        handleTap(e.clientX);
      });

      // 滑动翻页 + 顶部下滑/底部上滑唤出控制栏
      var sx=0,sy=0,st=0;
      v.addEventListener('touchstart',function(e){
        sx=e.changedTouches[0].screenX; sy=e.changedTouches[0].screenY; st=Date.now();
      },{passive:true});
      v.addEventListener('touchend',function(e){
        var dx=e.changedTouches[0].screenX-sx;
        var dy=e.changedTouches[0].screenY-sy;
        var h=window.innerHeight;
        var dt=Date.now()-st;
        // 竖向手势：顶部下滑 / 底部上滑 → 控制栏
        if(Math.abs(dy)>80 && Math.abs(dy)>Math.abs(dx)*1.5 && dt<800){
          if(dy>0 && sy < h*0.35){ if(window.AndroidBridge&&AndroidBridge.onTapBottom) AndroidBridge.onTapBottom(); return; }
          if(dy<0 && sy > h*0.65){ if(window.AndroidBridge&&AndroidBridge.onTapBottom) AndroidBridge.onTapBottom(); return; }
        }
        // 横向滑动 → 翻页
        if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){
          if(dx<0)rendition.next(); else rendition.prev();
        }
      },{passive:true});

      // 键盘（外接键盘 / 模拟器）
      document.addEventListener('keydown',function(e){
        if(e.key==='ArrowRight') rendition.next();
        if(e.key==='ArrowLeft') rendition.prev();
      });

      // 切章时自动隐藏目录
      rendition.on('relocated',function(loc){
        if(loc && loc.start && loc.start.href) markTocActive(loc.start.href);
      });
    }).catch(function(err){
      dlog('致命错误: '+(err&&err.message?err.message:err));
      document.getElementById('hint').style.display='block';
      document.getElementById('hint').textContent='EPUB 加载失败: '+(err&&err.message?err.message:err);
    });
  }

  function locationHash(){ return '${bookUrl}'.slice(-32); }

  if(document.readyState==='complete') open();
  else window.addEventListener('load',open);
})();
</script>
</body>
</html>
"""

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BookmarkSheet(
    bookmarks: List<Bookmark>,
    onAdd: () -> Unit,
    onDelete: (String) -> Unit,
    onJump: (Bookmark) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("🔖 书签", fontWeight = FontWeight.SemiBold)
                Button(onClick = onAdd) { Text("添加") }
            }
            Spacer(Modifier.height(8.dp))
            if (bookmarks.isEmpty()) {
                Text(
                    "暂无书签",
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                LazyColumn(Modifier.heightIn(max = 400.dp)) {
                    items(bookmarks.size) { i ->
                        val bm = bookmarks[i]
                        ListItem(
                            headlineContent = { Text(bm.label.ifBlank { "书签" }) },
                            supportingContent = { Text(bm.timestamp.take(19), fontSize = 11.sp) },
                            trailingContent = {
                                IconButton(onClick = { onDelete(bm.id) }) {
                                    Icon(Icons.Default.Delete, "删除")
                                }
                            },
                            modifier = Modifier.clickable { onJump(bm) }
                        )
                    }
                }
            }
        }
    }
}

// ===== 辅助函数 =====

private suspend fun openPdf(
    context: Context,
    repo: EbookRepository,
    bookId: String,
    onReady: suspend (Int, suspend (Int, Int) -> Bitmap?) -> Unit
) {
    val file = downloadToCache(context, repo, bookId, "pdf")
        ?: run { onReady(0, { _, _ -> null }); return }

    val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    val renderer = PdfRenderer(pfd)

    onReady(renderer.pageCount) { page, targetWidth ->
        withContext(Dispatchers.IO) {
            runCatching {
                renderer.openPage(page).use { p ->
                    val scale = targetWidth.toFloat() / p.width
                    val w = targetWidth
                    val h = (p.height * scale).toInt()
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(android.graphics.Color.WHITE)
                    p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bmp
                }
            }.getOrNull()
        }
    }
}

/**
 * 打开 CBZ 文件：解压 ZIP 内所有图片到缓存目录，按文件名排序后返回文件列表。
 */
private suspend fun openCbz(
    context: Context,
    repo: EbookRepository,
    bookId: String,
    onReady: suspend (List<File>, File) -> Unit
) = withContext(Dispatchers.IO) {
    runCatching {
        val cbzFile = downloadToCache(context, repo, bookId, "cbz")
            ?: throw IllegalStateException("下载失败")

        // 解压到以 bookId 命名的子目录
        val extractDir = File(context.cacheDir, "cbz/$bookId").apply { mkdirs() }

        // 如果已解压且文件数 > 0，直接复用
        val existingImages = extractDir.listFiles { f ->
            f.extension.lowercase() in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")
        }?.sortedBy { it.name } ?: emptyList()

        val imageFiles = if (existingImages.isNotEmpty()) {
            existingImages
        } else {
            // 清空旧缓存后重新解压
            extractDir.deleteRecursively()
            extractDir.mkdirs()

            ZipInputStream(cbzFile.inputStream()).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory) {
                        val name = entry.name.substringAfterLast('/')
                        val ext = name.substringAfterLast('.').lowercase()
                        if (ext in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")) {
                            val outFile = File(extractDir, name)
                            FileOutputStream(outFile).use { fos -> zis.copyTo(fos) }
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }

            extractDir.listFiles { f ->
                f.extension.lowercase() in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")
            }?.sortedBy { it.name } ?: emptyList()
        }

        onReady(imageFiles, extractDir)
    }
}

private suspend fun downloadToCache(
    context: Context,
    repo: EbookRepository,
    bookId: String,
    ext: String
): File? = withContext(Dispatchers.IO) {
    runCatching {
        val dir = File(context.cacheDir, "books").apply { mkdirs() }
        val out = File(dir, "$bookId.$ext")
        if (out.exists() && out.length() > 0) return@runCatching out

        val body = repo.downloadBook(bookId)
        body.byteStream().use { input ->
            FileOutputStream(out).use { output -> input.copyTo(output) }
        }
        out
    }.getOrNull()
}

/**
 * 从本地文件打开 PDF
 */
private suspend fun openPdfFromFile(
    context: Context,
    file: File,
    onReady: suspend (Int, suspend (Int, Int) -> Bitmap?) -> Unit
) {
    if (!file.exists()) {
        onReady(0, { _, _ -> null })
        return
    }
    val pfd = withContext(Dispatchers.IO) {
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    val renderer = PdfRenderer(pfd)

    onReady(renderer.pageCount) { page, targetWidth ->
        withContext(Dispatchers.IO) {
            runCatching {
                renderer.openPage(page).use { p ->
                    val scale = targetWidth.toFloat() / p.width
                    val w = targetWidth
                    val h = (p.height * scale).toInt()
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(android.graphics.Color.WHITE)
                    p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bmp
                }
            }.getOrNull()
        }
    }
}

/**
 * 从本地文件打开 CBZ
 */
private suspend fun openCbzFromFile(
    context: Context,
    file: File,
    onReady: suspend (List<File>, File) -> Unit
) = withContext(Dispatchers.IO) {
    runCatching {
        if (!file.exists()) throw IllegalStateException("文件不存在")

        val bookId = file.nameWithoutExtension
        val extractDir = File(context.cacheDir, "cbz/$bookId").apply { mkdirs() }

        val existingImages = extractDir.listFiles { f ->
            f.extension.lowercase() in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")
        }?.sortedBy { it.name } ?: emptyList()

        val imageFiles = if (existingImages.isNotEmpty()) {
            existingImages
        } else {
            extractDir.deleteRecursively()
            extractDir.mkdirs()

            java.util.zip.ZipInputStream(file.inputStream()).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory) {
                        val name = entry.name.substringAfterLast('/')
                        val ext = name.substringAfterLast('.').lowercase()
                        if (ext in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")) {
                            val outFile = File(extractDir, name)
                            FileOutputStream(outFile).use { fos -> zis.copyTo(fos) }
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }

            extractDir.listFiles { f ->
                f.extension.lowercase() in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp")
            }?.sortedBy { it.name } ?: emptyList()
        }

        onReady(imageFiles, extractDir)
    }
}

private fun readerBgColor(bg: String): Color = when (bg) {
    "paper" -> Color(0xFFF5E6C8)
    "eye" -> Color(0xFFC7EDCC)
    "white" -> Color(0xFFFFFFFF)
    "dark" -> Color(0xFF0A0A0A)
    else -> Color(0xFF121212)
}

private fun readerTextColor(bg: String): Color = when (bg) {
    "paper" -> Color(0xFF5C4B37)
    "eye" -> Color(0xFF2D5A32)
    "white" -> Color(0xFF1A1A1A)
    "dark" -> Color(0xFFCCCCCC)
    else -> Color(0xFFE0E0E0)
}

private fun readerFontFamily(f: String): FontFamily = when (f) {
    "serif" -> FontFamily.Serif
    "sans" -> FontFamily.SansSerif
    "kai" -> FontFamily.Serif
    else -> FontFamily.Default
}

private fun stripHtml(html: String): String {
    return html
        .replace(Regex("<script[^>]*>.*?</script>", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("<style[^>]*>.*?</style>", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
        .replace(Regex("</p>", RegexOption.IGNORE_CASE), "\n\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .trim()
}
