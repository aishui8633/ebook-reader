package com.ebookreader.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ebookreader.app.data.AppSettings
import com.ebookreader.app.data.DownloadManager
import com.ebookreader.app.data.EbookRepository
import com.ebookreader.app.data.SettingsRepository
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settingsRepo: SettingsRepository,
    repo: EbookRepository,
    downloadManager: DownloadManager,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf<AppSettings?>(null) }
    var urlInput by remember { mutableStateOf("") }
    var testResult by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    var stats by remember { mutableStateOf<String?>(null) }
    var downloadSize by remember { mutableStateOf<String>("计算中…") }
    var showClearConfirm by remember { mutableStateOf(false) }
    var clearMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val s = settingsRepo.current()
        settings = s
        urlInput = s.serverUrl
        stats = runCatching {
            val r = repo.getStats()
            "共 ${r.totalBooks} 本书 · ${"%.1f".format(r.totalSize / 1024.0 / 1024 / 1024)} GB"
        }.getOrElse { "无法连接服务器" }
        // 加载下载空间占用
        val sizeBytes = downloadManager.getTotalSize()
        downloadSize = formatSize(sizeBytes)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { padding ->
        val s = settings ?: return@Scaffold
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            // ===== 服务器 =====
            SectionTitle("服务器")
            Column(Modifier.padding(horizontal = 16.dp)) {
                OutlinedTextField(
                    value = urlInput,
                    onValueChange = { urlInput = it; testResult = null },
                    label = { Text("服务器地址") },
                    placeholder = { Text(AppSettings.DEFAULT_SERVER) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            testing = true; testResult = null
                            scope.launch {
                                val normalized = if (urlInput.startsWith("http")) urlInput.trimEnd('/')
                                else "http://${urlInput.trimEnd('/')}"
                                val r = repo.testConnection(normalized)
                                testResult = r.fold(
                                    { "✅ 连接成功，共 ${it.totalBooks} 本书" },
                                    { "❌ ${it.message ?: "连接失败"}" }
                                )
                                testing = false
                            }
                        },
                        enabled = !testing
                    ) { Text(if (testing) "测试中…" else "测试连接") }

                    Button(
                        onClick = {
                            scope.launch {
                                settingsRepo.setServerUrl(urlInput)
                                settings = settingsRepo.current()
                                testResult = "✅ 已保存"
                                repo.getStats().let {
                                    stats = "共 ${it.totalBooks} 本书"
                                }
                            }
                        }
                    ) { Text("保存") }
                }
                testResult?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, fontSize = 12.sp,
                        color = if (it.startsWith("✅")) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.error)
                }
                stats?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            // ===== 阅读偏好 =====
            SectionTitle("阅读偏好")

            SliderRow(
                label = "字号 (${s.fontSize}sp)",
                value = (s.fontSize - 12) / 20f,
                onChange = { v ->
                    val newSize = (12 + v * 20).toInt()
                    scope.launch { settingsRepo.setFontSize(newSize); settings = settingsRepo.current() }
                },
                valueText = "${s.fontSize}"
            )

            SliderRow(
                label = "行距 (%.1f)".format(s.lineHeight),
                value = (s.lineHeight - 1.2f) / 1.3f,
                onChange = { v ->
                    val lh = 1.2f + v * 1.3f
                    scope.launch { settingsRepo.setLineHeight(lh); settings = settingsRepo.current() }
                },
                valueText = "%.1f".format(s.lineHeight)
            )

            ChoiceRow(
                label = "字体",
                options = listOf("system" to "系统", "serif" to "宋体", "sans" to "黑体", "kai" to "楷体"),
                selected = s.fontFamily,
                onSelect = { scope.launch { settingsRepo.setFontFamily(it); settings = settingsRepo.current() } }
            )

            ChoiceRow(
                label = "阅读背景",
                options = listOf(
                    "default" to "默认", "paper" to "羊皮纸",
                    "eye" to "护眼绿", "white" to "纯白", "dark" to "纯黑"
                ),
                selected = s.readerBg,
                onSelect = { scope.launch { settingsRepo.setReaderBg(it); settings = settingsRepo.current() } }
            )

            // ===== 外观 =====
            SectionTitle("外观")
            ChoiceRow(
                label = "主题",
                options = listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"),
                selected = s.themeMode,
                onSelect = { scope.launch { settingsRepo.setThemeMode(it); settings = settingsRepo.current() } }
            )

            // ===== 离线下载 =====
            SectionTitle("离线下载")
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("已下载书籍", fontSize = 13.sp)
                        Text(
                            "占用空间: $downloadSize",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    OutlinedButton(
                        onClick = { showClearConfirm = true }
                    ) { Text("清除全部") }
                }
                clearMessage?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                }
            }

            // 清除确认对话框
            if (showClearConfirm) {
                AlertDialog(
                    onDismissRequest = { showClearConfirm = false },
                    title = { Text("清除所有下载") },
                    text = { Text("确定要删除所有已下载的书籍吗？这将释放 $downloadSize 的空间。") },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                showClearConfirm = false
                                scope.launch {
                                    val cleared = downloadManager.clearAllDownloads()
                                    downloadSize = formatSize(0)
                                    clearMessage = "已清除 ${formatSize(cleared)}"
                                }
                            }
                        ) { Text("确定", color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = {
                        TextButton(onClick = { showClearConfirm = false }) { Text("取消") }
                    }
                )
            }

            Spacer(Modifier.height(32.dp))
            Text(
                "电子书库 v2.0.0\nKotlin + Jetpack Compose 原生客户端",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp)
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SliderRow(
    label: String,
    value: Float,
    onChange: (Float) -> Unit,
    valueText: String
) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text(label, fontSize = 13.sp)
        Slider(value = value.coerceIn(0f, 1f), onValueChange = onChange)
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChoiceRow(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit
) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(label, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp))
        androidx.compose.foundation.layout.FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            options.forEach { (key, name) ->
                FilterChip(
                    selected = selected == key,
                    onClick = { onSelect(key) },
                    label = { Text(name) }
                )
            }
        }
    }
}

private fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024)
    else -> "%.1f GB".format(bytes / 1024.0 / 1024 / 1024)
}
