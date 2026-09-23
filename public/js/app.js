// ========== 状态 ==========
let books = [];              // 当前已加载的书（分页累积）
let bookIndex = [];          // 全量轻量索引（用于搜索/筛选/统计）
let currentFilter = 'all';
let currentFolder = 'all';
let currentSort = 'lastRead';
let folders = [];
let allTags = {};
let currentTagFilter = null;
let batchMode = false;
let selectedBooks = new Set();
let viewMode = localStorage.getItem('viewMode') || 'grid';
let recentCollapsed = false;
let detailBook = null;
let pageSize = 120;          // 每页加载数量
let currentOffset = 0;
let totalBooks = 0;
let hasMore = false;
let isLoading = false;
let searchQuery = '';

// ========== 防抖 ==========
function debounce(fn, delay) {
  let timer;
  return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
}

// ========== 应用内确认弹窗 ==========
function showConfirm(options) {
  return new Promise((resolve) => {
    const { title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false } = options;

    const overlay = document.createElement('div');
    overlay.className = 'modal active confirm-modal';
    overlay.innerHTML = `
      <div class="modal-content confirm-content">
        <h3 class="confirm-title">${escapeHtml(title)}</h3>
        <p class="confirm-message">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn btn-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.btn-cancel').onclick = () => cleanup(false);
    overlay.querySelector('.btn-danger, .btn-primary').onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
  });
}

// ========== Toast ==========
function showToast(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  loadBooks();
  loadFolders();
  loadTags();
  loadSettings();
  loadStats();

  // 搜索（防抖）
  document.getElementById('search-input').addEventListener('input', debounce((e) => {
    filterAndRender();
  }, 300));

  // 滚动到底部自动加载更多
  window.addEventListener('scroll', debounce(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 600;
    if (nearBottom) loadMoreBooks();
  }, 150));

  // 格式筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.format;
      filterAndRender();
    });
  });

  // 排序
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    filterAndRender();
  });

  // 视图切换
  document.getElementById('view-toggle-btn').addEventListener('click', toggleViewMode);

  // 批量模式
  document.getElementById('batch-mode-btn').addEventListener('click', toggleBatchMode);

  // 上传
  document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', handleUpload);

  // 设置
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  // 返回
  document.getElementById('back-btn').addEventListener('click', showLibrary);

  // 主题
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // 字体控制
  document.getElementById('font-increase').addEventListener('click', () => changeFontSize(1));
  document.getElementById('font-decrease').addEventListener('click', () => changeFontSize(-1));

  // 阅读设置面板
  document.getElementById('reader-settings-btn').addEventListener('click', toggleReaderSettings);

  // 透明度
  const opacitySlider = document.getElementById('background-opacity');
  opacitySlider.addEventListener('input', (e) => {
    document.getElementById('opacity-value').textContent = e.target.value + '%';
  });
  opacitySlider.addEventListener('change', () => applyBackground());

  // 阅读设置选项绑定
  bindReaderSettings();

  // 加载主题
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    updateThemeIcon(true);
  }

  // 加载视图模式
  if (viewMode === 'list') {
    document.getElementById('books-grid').classList.add('list-view');
  }

  // 加载字体大小
  const savedFontSize = localStorage.getItem('fontSize');
  if (savedFontSize) currentFontSize = parseInt(savedFontSize);
});

// ========== 数据加载 ==========
async function loadBooks(reset = true) {
  if (isLoading) return;
  isLoading = true;

  if (reset) { currentOffset = 0; books = []; }

  try {
    // 用轻量索引做搜索/筛选（只拉一次）
    if (bookIndex.length === 0) {
      const idxRes = await fetch('/api/books/index');
      const idxData = await idxRes.json();
      if (idxData.success) {
        bookIndex = idxData.books;
        updateFolderCounts();
      }
    }

    const response = await fetch(`/api/books?limit=${pageSize}&offset=${currentOffset}`);
    const data = await response.json();
    if (data.success) {
      if (reset) {
        books = data.books;
      } else {
        books = books.concat(data.books);
      }
      totalBooks = data.total;
      hasMore = data.hasMore;
      currentOffset = books.length;

      document.getElementById('book-count').textContent = `${totalBooks} 本书`;
      filterAndRender();
      renderRecentSection();
    } else {
      showToast('加载书籍失败');
    }
  } catch (err) {
    console.error('加载书籍失败:', err);
    showToast('加载书籍失败');
  } finally {
    isLoading = false;
  }
}

// 加载更多（滚动到底部触发）
async function loadMoreBooks() {
  if (isLoading || !hasMore) return;
  if (searchQuery || currentFolder !== 'all' || currentFilter !== 'all' || currentTagFilter) return;

  isLoading = true;
  const grid = document.getElementById('books-grid');
  const loader = document.createElement('div');
  loader.className = 'loading load-more';
  loader.innerHTML = '<div class="spinner"></div><p>加载更多...</p>';
  grid.appendChild(loader);

  try {
    const response = await fetch(`/api/books?limit=${pageSize}&offset=${currentOffset}`);
    const data = await response.json();
    if (data.success) {
      const newBooks = data.books;
      currentOffset = books.length + newBooks.length;
      hasMore = data.hasMore;
      loader.remove();

      // 追加渲染新卡片
      const fragment = document.createElement('div');
      fragment.innerHTML = newBooks.map(book => bookCardHtml(book)).join('');
      while (fragment.firstChild) grid.appendChild(fragment.firstChild);

      books = books.concat(newBooks);
      lazyLoadCovers();
    } else {
      loader.remove();
    }
  } catch (err) {
    console.error('加载更多失败:', err);
    loader.remove();
  } finally {
    isLoading = false;
  }
}

async function loadFolders() {
  try {
    const response = await fetch('/api/folders');
    const data = await response.json();
    if (data.success) {
      folders = data.folders;
      const folderList = document.getElementById('folder-list');
      document.getElementById('count-all').textContent = data.totalBooks;

      folderList.innerHTML = folders.map(folder => `
        <button class="folder-btn" data-folder="${folder}" onclick="switchFolder('${folder.replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>${folder}</span>
          <span class="count" id="count-${folder}">-</span>
        </button>
      `).join('');

      // 基于全量索引统计各文件夹数量（无需额外请求）
      updateFolderCounts();
    }
  } catch (err) { console.error('加载文件夹失败:', err); }
}

// 基于索引统计文件夹数量
function updateFolderCounts() {
  if (bookIndex.length === 0) return;
  const counts = {};
  bookIndex.forEach(b => {
    const parts = b.p.split('/');
    if (parts.length > 1) counts[parts[0]] = (counts[parts[0]] || 0) + 1;
  });
  folders.forEach(folder => {
    const el = document.getElementById(`count-${folder}`);
    if (el) el.textContent = counts[folder] || 0;
  });
}

async function loadTags() {
  try {
    const response = await fetch('/api/tags');
    const data = await response.json();
    if (data.success) {
      allTags = data.tags;
      renderTagsBar();
    }
  } catch (err) { console.error('加载标签失败:', err); }
}

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    if (data.success) {
      const info = document.getElementById('stats-info');
      const formatStr = Object.entries(data.byFormat).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ');
      const sizeMB = (data.totalSize / 1024 / 1024).toFixed(1);
      info.innerHTML = `共 ${data.totalBooks} 本书，总计 ${sizeMB} MB<br>${formatStr}`;
    }
  } catch {}
}

// ========== 筛选 & 排序 & 渲染 ==========
const MAX_RENDER = 500; // 单次最多渲染卡片数，防止卡死

function filterAndRender() {
  const query = document.getElementById('search-input').value.toLowerCase().trim();
  searchQuery = query;

  // 无搜索无筛选：直接渲染分页数据
  if (!query && currentFolder === 'all' && currentFilter === 'all' && !currentTagFilter && currentSort === 'lastRead') {
    renderBooks(books);
    return;
  }

  // 有筛选条件：基于全量索引筛选
  let result = bookIndex.map(b => ({
    id: b.id, title: b.t, format: b.f, size: b.s, modified: b.m,
    path: b.p, lastRead: b.lr, progress: b.pg, tags: b.tg,
    filename: b.p, coverUrl: `/api/books/${b.id}/cover`
  }));

  // 文件夹
  if (currentFolder !== 'all') {
    result = result.filter(b => b.path.startsWith(currentFolder + '/'));
  }

  // 格式
  if (currentFilter !== 'all') {
    const formatMap = {
      epub: ['epub'], pdf: ['pdf'], txt: ['txt'],
      mobi: ['mobi', 'azw', 'azw3'], cbz: ['cbz', 'cbr']
    };
    const fmts = formatMap[currentFilter] || [currentFilter];
    result = result.filter(b => fmts.includes(b.format));
  }

  // 标签
  if (currentTagFilter) {
    result = result.filter(b => b.tags && b.tags.includes(currentTagFilter));
  }

  // 搜索
  if (query) {
    result = result.filter(b =>
      b.title.toLowerCase().includes(query) ||
      b.filename.toLowerCase().includes(query) ||
      b.format.toLowerCase().includes(query) ||
      (b.tags && b.tags.some(t => t.toLowerCase().includes(query)))
    );
  }

  // 排序
  result.sort((a, b) => {
    switch (currentSort) {
      case 'lastRead':
        if (!a.lastRead && !b.lastRead) return 0;
        if (!a.lastRead) return 1;
        if (!b.lastRead) return -1;
        return new Date(b.lastRead) - new Date(a.lastRead);
      case 'modified': return new Date(b.modified) - new Date(a.modified);
      case 'title': return a.title.localeCompare(b.title, 'zh');
      case 'size': return b.size - a.size;
      default: return 0;
    }
  });

  // 限制渲染数量
  const total = result.length;
  const limited = result.slice(0, MAX_RENDER);

  renderBooks(limited, total > MAX_RENDER ? total : 0);
}

// 单张卡片 HTML
function bookCardHtml(book) {
  return `
    <div class="book-card ${selectedBooks.has(book.id) ? 'selected' : ''}" data-id="${book.id}" ${batchMode ? `onclick="toggleBookSelect('${book.id}')"` : `onclick="openBookDetail('${book.id}')"`}>
      <div class="book-cover">
        <div class="book-checkbox ${selectedBooks.has(book.id) ? 'checked' : ''}" onclick="event.stopPropagation(); toggleBookSelect('${book.id}')"></div>
        <img class="lazy" data-src="/api/books/${book.id}/cover" alt="${escapeHtml(book.title)}" onerror="this.style.display='none';">
        <span class="book-cover-icon" style="display:none;">${getFormatIcon(book.format)}</span>
        <span class="book-format-badge">${book.format}</span>
        ${book.progress > 0 ? `<div class="book-progress-bar"><div class="book-progress-fill" style="width:${book.progress}%"></div></div>` : ''}
        <div class="cover-overlay" onclick="event.stopPropagation(); openBook('${book.id}')">
          <span>📖 阅读</span>
        </div>
      </div>
      <div class="book-info">
        <div class="book-title">${escapeHtml(book.title)}</div>
        <div class="book-meta">
          <span class="book-size">${formatSize(book.size)}</span>
        </div>
        ${book.tags && book.tags.length > 0 ? `<div class="book-tags">${book.tags.map(t => `<span class="book-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

// ========== 渲染书籍 ==========
function renderBooks(booksToRender, truncatedFrom = 0) {
  const grid = document.getElementById('books-grid');

  if (booksToRender.length === 0) {
    grid.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📚</div>
        <h3>没有找到书籍</h3>
        <p>试试其他搜索词，或上传一些新书</p>
      </div>`;
    return;
  }

  grid.innerHTML = booksToRender.map(book => bookCardHtml(book)).join('');

  // 结果被截断时提示
  if (truncatedFrom > 0) {
    const tip = document.createElement('div');
    tip.className = 'empty';
    tip.style.gridColumn = '1/-1';
    tip.innerHTML = `<p>共 ${truncatedFrom} 条结果，仅显示前 ${MAX_RENDER} 条，请细化搜索条件</p>`;
    grid.appendChild(tip);
  }

  // 懒加载封面
  lazyLoadCovers();
}

// ========== 封面懒加载 ==========
function lazyLoadCovers() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.onload = () => img.classList.add('loaded');
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });

  document.querySelectorAll('img.lazy[data-src]').forEach(img => observer.observe(img));
}

// ========== 最近阅读 ==========
function renderRecentSection() {
  const section = document.getElementById('recent-section');
  const scroll = document.getElementById('recent-scroll');
  const recentBooks = books.filter(b => b.lastRead).slice(0, 10);

  if (recentBooks.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = recentCollapsed ? 'none' : 'block';

  scroll.innerHTML = recentBooks.map(book => `
    <div class="recent-card" onclick="openBook('${book.id}')">
      <div class="recent-card-cover">
        <img src="/api/books/${book.id}/cover" alt="${escapeHtml(book.title)}" onerror="this.style.display='none'">
        <div class="recent-card-progress">
          <div class="recent-card-progress-fill" style="width:${book.progress || 0}%"></div>
        </div>
      </div>
      <div class="recent-card-title">${escapeHtml(book.title)}</div>
    </div>
  `).join('');
}

function toggleRecentSection() {
  recentCollapsed = !recentCollapsed;
  const section = document.getElementById('recent-section');
  const btn = document.getElementById('recent-toggle');
  section.style.display = recentCollapsed ? 'none' : 'block';
  btn.textContent = recentCollapsed ? '展开' : '收起';
}

// ========== 标签栏 ==========
function renderTagsBar() {
  const bar = document.getElementById('tags-bar');
  const list = document.getElementById('tags-filter-list');

  // 收集所有标签
  const tagSet = new Set();
  Object.values(allTags).forEach(tags => tags.forEach(t => tagSet.add(t)));

  if (tagSet.size === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  list.innerHTML = Array.from(tagSet).sort().map(tag => `
    <span class="tag-chip ${currentTagFilter === tag ? 'active' : ''}" onclick="toggleTagFilter('${escapeHtml(tag)}')">${escapeHtml(tag)}</span>
  `).join('');
}

function toggleTagFilter(tag) {
  currentTagFilter = currentTagFilter === tag ? null : tag;
  renderTagsBar();
  filterAndRender();
}

// ========== 文件夹切换 ==========
function switchFolder(folder) {
  currentFolder = folder;
  document.querySelectorAll('.folder-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.folder === folder);
  });
  filterAndRender();
}

// ========== 视图切换 ==========
function toggleViewMode() {
  const grid = document.getElementById('books-grid');
  viewMode = viewMode === 'grid' ? 'list' : 'grid';
  grid.classList.toggle('list-view', viewMode === 'list');
  localStorage.setItem('viewMode', viewMode);
}

// ========== 批量模式 ==========
function toggleBatchMode() {
  batchMode = !batchMode;
  selectedBooks.clear();

  const btn = document.getElementById('batch-mode-btn');
  const bar = document.getElementById('batch-bar');
  const grid = document.getElementById('books-grid');

  btn.classList.toggle('active', batchMode);
  bar.style.display = batchMode ? 'flex' : 'none';
  grid.classList.toggle('batch-mode', batchMode);

  updateBatchCount();
  filterAndRender();
}

function exitBatchMode() { toggleBatchMode(); }

function toggleBookSelect(id) {
  if (!batchMode) return;
  if (selectedBooks.has(id)) {
    selectedBooks.delete(id);
  } else {
    selectedBooks.add(id);
  }
  updateBatchCount();

  // 更新卡片样式
  const card = document.querySelector(`.book-card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle('selected', selectedBooks.has(id));
    const cb = card.querySelector('.book-checkbox');
    if (cb) cb.classList.toggle('checked', selectedBooks.has(id));
  }
}

function updateBatchCount() {
  document.getElementById('batch-count').textContent = `已选 ${selectedBooks.size} 本`;
}

async function batchDelete() {
  if (selectedBooks.size === 0) return;
  const ok = await showConfirm({
    title: '批量删除',
    message: `确定删除选中的 ${selectedBooks.size} 本书？\n将移入回收站，7 天内可恢复。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  const ids = Array.from(selectedBooks);
  try {
    const response = await fetch('/api/books/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await response.json();
    if (data.success) {
      showToast(`已移入回收站 ${data.deleted} 本`);
      exitBatchMode();
      ids.forEach(id => removeBookFromView(id));
    } else {
      showToast(data.error || '删除失败');
    }
  } catch (err) { showToast('删除失败: ' + err.message); }
}

function batchTag() {
  if (selectedBooks.size === 0) return;
  const tag = prompt('输入标签名称：');
  if (!tag || !tag.trim()) return;

  Promise.all(Array.from(selectedBooks).map(id =>
    fetch(`/api/books/${id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [tag.trim()] })
    })
  )).then(() => {
    showToast(`已为 ${selectedBooks.size} 本书添加标签`);
    exitBatchMode();
    loadBooks();
    loadTags();
  }).catch(() => showToast('操作失败'));
}

// ========== 书籍详情 ==========
function openBookDetail(bookId) {
  const book = findBook(bookId);
  if (!book) return;
  detailBook = book;

  document.getElementById('detail-cover-img').src = `/api/books/${book.id}/cover`;
  document.getElementById('detail-title').textContent = book.title;
  document.getElementById('detail-format').textContent = book.format.toUpperCase();
  document.getElementById('detail-size').textContent = formatSize(book.size);
  document.getElementById('detail-date').textContent = new Date(book.modified).toLocaleDateString('zh-CN');

  // 标签
  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = (book.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');

  // 进度
  const progressRow = document.getElementById('detail-progress-row');
  if (book.progress > 0) {
    progressRow.style.display = 'flex';
    progressRow.style.alignItems = 'center';
    progressRow.style.gap = '0.5rem';
    document.getElementById('detail-progress-fill').style.width = book.progress + '%';
    document.getElementById('detail-progress-pct').textContent = book.progress + '%';
  } else {
    progressRow.style.display = 'none';
  }

  document.getElementById('book-detail-modal').classList.add('active');
}

function closeBookDetail() {
  document.getElementById('book-detail-modal').classList.remove('active');
  detailBook = null;
}

function detailOpenBook() {
  if (!detailBook) return;
  const bookId = detailBook.id;
  closeBookDetail();
  openBook(bookId);
}

async function detailEditTitle() {
  if (!detailBook) return;
  const newTitle = prompt('修改书名：', detailBook.title);
  if (!newTitle || newTitle === detailBook.title) return;

  try {
    await fetch(`/api/books/${detailBook.id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    showToast('书名已修改');
    closeBookDetail();
    loadBooks();
  } catch { showToast('修改失败'); }
}

async function detailEditTags() {
  if (!detailBook) return;
  const currentTags = (detailBook.tags || []).join(', ');
  const input = prompt('编辑标签（逗号分隔）：', currentTags);
  if (input === null) return;

  const tags = input.split(/[,，]/).map(t => t.trim()).filter(Boolean);

  try {
    await fetch(`/api/books/${detailBook.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    showToast('标签已更新');
    closeBookDetail();
    loadBooks();
    loadTags();
  } catch { showToast('操作失败'); }
}

async function detailDeleteBook() {
  if (!detailBook) return;
  const title = detailBook.title;
  const ok = await showConfirm({
    title: '删除书籍',
    message: `确定删除「${title}」？\n将移入回收站，7 天内可恢复。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  try {
    const res = await fetch(`/api/books/${detailBook.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '删除失败');
    showToast('已移入回收站');
    const deletedId = detailBook.id;
    closeBookDetail();
    removeBookFromView(deletedId);
  } catch (err) { showToast('删除失败: ' + err.message); }
}

// ========== 书籍查找（兼容索引数据） ==========
function findBook(bookId) {
  let book = books.find(b => b.id === bookId);
  if (book) return book;

  // 从索引中查找并转换格式
  const idx = bookIndex.find(b => b.id === bookId);
  if (idx) {
    return {
      id: idx.id, title: idx.t, format: idx.f, size: idx.s, modified: idx.m,
      path: idx.p, filename: idx.p, lastRead: idx.lr, progress: idx.pg,
      tags: idx.tg, coverUrl: `/api/books/${idx.id}/cover`
    };
  }
  return null;
}

// ========== 打开书籍 ==========
async function openBook(bookId) {
  const book = findBook(bookId);
  if (!book) return;

  document.getElementById('book-title').textContent = book.title;

  // 记录阅读
  fetch(`/api/books/${bookId}/read`, { method: 'POST' });

  showReader();

  try {
    await Reader.open(book);
  } catch (err) {
    console.error('打开书籍失败:', err);
    showToast('打开书籍失败: ' + err.message);
    showLibrary();
  }
}

// ========== 上传 ==========
async function handleUpload(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  document.getElementById('upload-modal').classList.add('active');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    document.getElementById('upload-status').textContent = `${file.name} (${i + 1}/${files.length})`;
    const progressFill = document.querySelector('.progress-fill');
    progressFill.style.width = `${(i / files.length) * 100}%`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/books/upload', { method: 'POST', body: formData });
      const data = await response.json();
      if (!data.success) console.error('上传失败:', data.error);
    } catch (err) { console.error('上传失败:', err); }

    progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
  }

  setTimeout(() => {
    document.getElementById('upload-modal').classList.remove('active');
    document.querySelector('.progress-fill').style.width = '0%';
    e.target.value = '';
    loadBooks();
    loadFolders();
    loadStats();
  }, 500);
}

// ========== 从视图中移除书籍（保留滚动位置） ==========
function removeBookFromView(bookId) {
  // 从内存中移除
  removeFromIndex(bookId);
  totalBooks = Math.max(0, totalBooks - 1);
  selectedBooks.delete(bookId);

  // 直接从 DOM 移除卡片（不重渲染，保留滚动位置）
  const card = document.querySelector(`.book-card[data-id="${bookId}"]`);
  if (card) {
    card.style.transition = 'opacity 0.25s, transform 0.25s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    setTimeout(() => card.remove(), 250);
  }

  document.getElementById('book-count').textContent = `${totalBooks} 本书`;
  updateFolderCounts();
  updateBatchCount();
  renderRecentSection();
}

// 仅从索引移除（含分页缓冲）
function removeFromIndex(bookId) {
  bookIndex = bookIndex.filter(b => b.id !== bookId);
  books = books.filter(b => b.id !== bookId);
}

// ========== 回收站 ==========
async function openTrash() {
  document.getElementById('trash-modal').classList.add('active');
  await loadTrash();
}

function closeTrash() {
  document.getElementById('trash-modal').classList.remove('active');
}

async function loadTrash() {
  const list = document.getElementById('trash-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';

  try {
    const res = await fetch('/api/trash');
    const data = await res.json();
    if (!data.success) throw new Error();

    if (data.items.length === 0) {
      list.innerHTML = '<div class="empty" style="padding:2rem"><div class="empty-icon">🗑️</div><p>回收站是空的</p></div>';
      return;
    }

    list.innerHTML = data.items.map(item => {
      const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt) - Date.now()) / 86400000));
      return `
        <div class="trash-item">
          <div class="trash-cover">
            ${item.coverExt ? `<img src="/api/trash/${item.trashId}/cover" onerror="this.style.display='none'">` : `<span>${getFormatIcon(item.format)}</span>`}
          </div>
          <div class="trash-info">
            <div class="trash-title">${escapeHtml(item.title)}</div>
            <div class="trash-meta">${item.format.toUpperCase()} · ${formatSize(item.size)} · 剩余 ${daysLeft} 天</div>
          </div>
          <div class="trash-actions">
            <button class="btn btn-small" onclick="restoreFromTrash('${item.trashId}')">恢复</button>
            <button class="btn btn-small btn-danger" onclick="purgeFromTrash('${item.trashId}')">彻底删除</button>
          </div>
        </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div class="empty" style="padding:2rem"><p>加载回收站失败</p></div>';
  }
}

async function restoreFromTrash(trashId) {
  try {
    const res = await fetch(`/api/trash/${trashId}/restore`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('已恢复');
      await loadTrash();
      // 强制刷新书库（清空索引后重新拉取）
      bookIndex = [];
      await loadBooks(true);
      loadFolders();
    } else {
      showToast(data.error || '恢复失败');
    }
  } catch { showToast('恢复失败'); }
}

async function purgeFromTrash(trashId) {
  const ok = await showConfirm({ title: '彻底删除', message: '此操作不可恢复，确定？', confirmText: '彻底删除', danger: true });
  if (!ok) return;

  try {
    await fetch(`/api/trash/${trashId}`, { method: 'DELETE' });
    showToast('已彻底删除');
    await loadTrash();
  } catch { showToast('删除失败'); }
}

async function emptyTrash() {
  const ok = await showConfirm({ title: '清空回收站', message: '将彻底删除回收站内所有书籍，不可恢复。', confirmText: '清空', danger: true });
  if (!ok) return;

  try {
    const res = await fetch('/api/trash/empty', { method: 'POST' });
    const data = await res.json();
    showToast(`已清空 ${data.deleted || 0} 本`);
    await loadTrash();
  } catch { showToast('清空失败'); }
}

  // 删除书籍后保留滚动位置（已在 removeBookFromView 处理）

// ========== 长按 / 右键菜单 ==========
let longPressTimer = null;

function showContextMenu(bookId, x, y) {
  removeContextMenu();
  const book = findBook(bookId);
  if (!book) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button class="context-item" data-action="read">📖 阅读</button>
    <button class="context-item" data-action="detail">📋 详情</button>
    <button class="context-item" data-action="tags">🏷️ 标签</button>
    <button class="context-item danger" data-action="delete">🗑️ 删除</button>`;

  document.body.appendChild(menu);

  // 边界处理
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 10);
  const top = Math.min(y, window.innerHeight - rect.height - 10);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  menu.querySelectorAll('.context-item').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      removeContextMenu();

      if (action === 'read') openBook(bookId);
      else if (action === 'detail') openBookDetail(bookId);
      else if (action === 'tags') { detailBook = book; detailEditTags(); }
      else if (action === 'delete') {
        const ok = await showConfirm({
          title: '删除书籍',
          message: `确定删除「${book.title}」？\n将移入回收站，7 天内可恢复。`,
          confirmText: '删除', danger: true
        });
        if (ok) {
          await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
          showToast('已移入回收站');
          removeBookFromView(bookId);
        }
      }
    };
  });

  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
    document.addEventListener('scroll', removeContextMenu, { once: true, passive: true });
  }, 0);
}

function removeContextMenu() {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
}

// 网格上的长按/右键事件（委托）
document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.book-card');
  if (card && !batchMode) {
    e.preventDefault();
    showContextMenu(card.dataset.id, e.clientX, e.clientY);
  }
});

document.addEventListener('touchstart', (e) => {
  const card = e.target.closest('.book-card');
  if (card && !batchMode) {
    const touch = e.touches[0];
    longPressTimer = setTimeout(() => {
      showContextMenu(card.dataset.id, touch.clientX, touch.clientY);
      navigator.vibrate && navigator.vibrate(30);
    }, 550);
  }
}, { passive: true });

document.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, { passive: true });
document.addEventListener('touchmove', () => { clearTimeout(longPressTimer); }, { passive: true });

// ========== 视图切换 ==========
function showLibrary() {
  document.getElementById('library-view').classList.add('active');
  document.getElementById('reader-view').classList.remove('active');
  Reader.cleanup();
  // 刷新书籍列表（可能有新进度）
  loadBooks();
}

function showReader() {
  document.getElementById('library-view').classList.remove('active');
  document.getElementById('reader-view').classList.add('active');
}

// ========== 主题 ==========
function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
  document.getElementById('theme-toggle').innerHTML = isLight
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
}

// ========== 字体 ==========
let currentFontSize = 16;
function changeFontSize(delta) {
  currentFontSize = Math.max(12, Math.min(28, currentFontSize + delta));
  const content = document.querySelector('.reader-content');
  if (content) content.style.fontSize = currentFontSize + 'px';
  localStorage.setItem('fontSize', currentFontSize);
}

// ========== 阅读设置面板 ==========
function toggleReaderSettings() {
  const panel = document.getElementById('reader-settings-panel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function bindReaderSettings() {
  // 字体
  document.querySelectorAll('.font-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.font-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Reader.setFont(btn.dataset.font);
    });
  });

  // 字号
  document.querySelectorAll('.fs-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fs-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFontSize = parseInt(btn.dataset.size);
      Reader.setFontSize(currentFontSize);
    });
  });

  // 行距
  document.querySelectorAll('.lh-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lh-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Reader.setLineHeight(btn.dataset.lh);
    });
  });

  // 背景
  document.querySelectorAll('.bg-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Reader.setBackground(btn.dataset.bg);
    });
  });
}

// ========== 设置 ==========
function loadSettings() {
  const savedFavicon = localStorage.getItem('favicon');
  if (savedFavicon) {
    document.getElementById('favicon-input').value = savedFavicon;
    applyFaviconFromStorage(savedFavicon);
  }

  const bgUrl = 'http://192.168.5.24:5000/img/today.jpg';
  document.getElementById('background-input').value = bgUrl;
  applyBackgroundFromStorage(bgUrl);

  const savedOpacity = localStorage.getItem('backgroundOpacity');
  if (savedOpacity) {
    document.getElementById('background-opacity').value = savedOpacity;
    document.getElementById('opacity-value').textContent = savedOpacity + '%';
    updateBackgroundOpacity(savedOpacity);
  }
}

function openSettings() {
  document.getElementById('settings-modal').classList.add('active');
  loadStats();
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('active');
}

function applyFavicon() {
  const url = document.getElementById('favicon-input').value.trim();
  if (url) { localStorage.setItem('favicon', url); applyFaviconFromStorage(url); }
  else { localStorage.removeItem('favicon'); document.querySelector("link[rel*='icon']").href = '/favicon.svg'; }
}

function applyFaviconFromStorage(url) {
  const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
  link.type = 'image/x-icon';
  link.rel = 'icon';
  link.href = url;
  document.getElementsByTagName('head')[0].appendChild(link);
}

function applyBackground() {
  const url = document.getElementById('background-input').value.trim();
  const opacity = document.getElementById('background-opacity').value;
  if (url) {
    localStorage.setItem('background', url);
    localStorage.setItem('backgroundOpacity', opacity);
    applyBackgroundFromStorage(url, opacity);
  } else {
    localStorage.removeItem('background');
    localStorage.removeItem('backgroundOpacity');
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-background');
  }
}

function applyBackgroundFromStorage(url, opacity) {
  if (url) {
    document.body.style.backgroundImage = `url(${url})`;
    document.body.classList.add('has-background');
    updateBackgroundOpacity(opacity || document.getElementById('background-opacity').value);
  }
}

function updateBackgroundOpacity(opacity) {
  const overlayOpacity = 1 - (opacity / 100);
  document.documentElement.style.setProperty('--bg-overlay-opacity', overlayOpacity);
  const style = document.createElement('style');
  style.id = 'background-overlay-style';
  const existing = document.getElementById('background-overlay-style');
  if (existing) existing.remove();
  style.textContent = `
    body.has-background::before { background: rgba(15, 15, 15, ${overlayOpacity}) !important; }
    body.light-theme.has-background::before { background: rgba(248, 249, 250, ${overlayOpacity}) !important; }
  `;
  document.head.appendChild(style);
}

// ========== 书签弹窗 ==========
function openBookmarksModal() {
  document.getElementById('bookmarks-modal').classList.add('active');
  Reader.loadBookmarks();
}

function closeBookmarksModal() {
  document.getElementById('bookmarks-modal').classList.remove('active');
}

async function addBookmark() {
  await Reader.addBookmark();
  Reader.loadBookmarks();
}

// ========== 工具函数 ==========
function getFormatIcon(format) {
  const icons = { epub: '📖', pdf: '📄', mobi: '📱', azw: '📱', azw3: '📱', txt: '📝', fb2: '📚', djvu: '🖼️', cbz: '🎨', cbr: '🎨', doc: '📃', docx: '📃', rtf: '📃', html: '🌐', md: '📋' };
  return icons[format] || '📚';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 全局函数
window.openBook = openBook;
window.openBookDetail = openBookDetail;
window.closeBookDetail = closeBookDetail;
window.detailOpenBook = detailOpenBook;
window.detailEditTitle = detailEditTitle;
window.detailEditTags = detailEditTags;
window.detailDeleteBook = detailDeleteBook;
window.openTrash = openTrash;
window.closeTrash = closeTrash;
window.restoreFromTrash = restoreFromTrash;
window.purgeFromTrash = purgeFromTrash;
window.emptyTrash = emptyTrash;
window.closeSettings = closeSettings;
window.applyFavicon = applyFavicon;
window.applyBackground = applyBackground;
window.switchFolder = switchFolder;
window.toggleTagFilter = toggleTagFilter;
window.toggleRecentSection = toggleRecentSection;
window.toggleBookSelect = toggleBookSelect;
window.exitBatchMode = exitBatchMode;
window.batchDelete = batchDelete;
window.batchTag = batchTag;
window.openBookmarksModal = openBookmarksModal;
window.closeBookmarksModal = closeBookmarksModal;
window.addBookmark = addBookmark;
