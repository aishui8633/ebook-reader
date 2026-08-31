// API 配置
const API_BASE = '';

// 状态
let books = [];
let currentBook = null;
let currentFilter = 'all';
let currentFolder = 'all';
let folders = [];

// DOM 元素
const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const booksGrid = document.getElementById('books-grid');
const searchInput = document.getElementById('search-input');
const uploadBtn = document.getElementById('upload-btn');
const settingsBtn = document.getElementById('settings-btn');
const fileInput = document.getElementById('file-input');
const backBtn = document.getElementById('back-btn');
const bookTitle = document.getElementById('book-title');
const uploadModal = document.getElementById('upload-modal');
const uploadStatus = document.getElementById('upload-status');
const themeToggle = document.getElementById('theme-toggle');
const bookCount = document.getElementById('book-count');
const settingsModal = document.getElementById('settings-modal');
const faviconInput = document.getElementById('favicon-input');
const backgroundInput = document.getElementById('background-input');
const backgroundOpacity = document.getElementById('background-opacity');
const opacityValue = document.getElementById('opacity-value');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadBooks();
  loadFolders();
  loadSettings();
  
  // 搜索
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    filterAndRender(query, currentFilter);
  });
  
  // 分类筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.format;
      filterAndRender(searchInput.value.toLowerCase().trim(), currentFilter);
    });
  });
  
  // 上传
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleUpload);
  
  // 设置
  settingsBtn.addEventListener('click', openSettings);
  
  // 返回
  backBtn.addEventListener('click', showLibrary);
  
  // 主题切换
  themeToggle.addEventListener('click', toggleTheme);
  
  // 字体控制
  document.getElementById('font-increase').addEventListener('click', () => changeFontSize(1));
  document.getElementById('font-decrease').addEventListener('click', () => changeFontSize(-1));
  
  // 透明度滑块
  backgroundOpacity.addEventListener('input', (e) => {
    opacityValue.textContent = e.target.value + '%';
  });
  
  backgroundOpacity.addEventListener('change', (e) => {
    applyBackground();
  });
  
  // 加载主题
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    updateThemeIcon(true);
  }
  
  // 加载字体大小
  const savedFontSize = localStorage.getItem('fontSize');
  if (savedFontSize) {
    currentFontSize = parseInt(savedFontSize);
  }
});

// 加载设置
function loadSettings() {
  // 加载 favicon
  const savedFavicon = localStorage.getItem('favicon');
  if (savedFavicon) {
    faviconInput.value = savedFavicon;
    applyFaviconFromStorage(savedFavicon);
  }
  
  // 背景图固定为今日壁纸
  const bgUrl = 'http://192.168.5.24:5000/img/today.jpg';
  backgroundInput.value = bgUrl;
  applyBackgroundFromStorage(bgUrl);
  
  // 加载透明度
  const savedOpacity = localStorage.getItem('backgroundOpacity');
  if (savedOpacity) {
    backgroundOpacity.value = savedOpacity;
    opacityValue.textContent = savedOpacity + '%';
    updateBackgroundOpacity(savedOpacity);
  }
}

// 打开设置
function openSettings() {
  settingsModal.classList.add('active');
}

// 关闭设置
function closeSettings() {
  settingsModal.classList.remove('active');
}

// 应用 favicon
function applyFavicon() {
  const url = faviconInput.value.trim();
  if (url) {
    localStorage.setItem('favicon', url);
    applyFaviconFromStorage(url);
  } else {
    localStorage.removeItem('favicon');
    // 恢复默认
    const link = document.querySelector("link[rel*='icon']");
    link.href = '/favicon.svg';
  }
}

function applyFaviconFromStorage(url) {
  const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
  link.type = 'image/x-icon';
  link.rel = 'icon';
  link.href = url;
  document.getElementsByTagName('head')[0].appendChild(link);
}

// 应用背景
function applyBackground() {
  const url = backgroundInput.value.trim();
  const opacity = backgroundOpacity.value;
  
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
    updateBackgroundOpacity(opacity || backgroundOpacity.value);
  }
}

function updateBackgroundOpacity(opacity) {
  const opacityDecimal = opacity / 100;
  const overlayOpacity = 1 - opacityDecimal;
  document.documentElement.style.setProperty('--bg-overlay-opacity', overlayOpacity);
  
  // 更新遮罩层透明度
  const style = document.createElement('style');
  style.id = 'background-overlay-style';
  const existingStyle = document.getElementById('background-overlay-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  style.textContent = `
    body.has-background::before {
      background: rgba(15, 15, 15, ${overlayOpacity}) !important;
    }
    body.light-theme.has-background::before {
      background: rgba(248, 249, 250, ${overlayOpacity}) !important;
    }
  `;
  document.head.appendChild(style);
}

// 加载文件夹列表
async function loadFolders() {
  try {
    const response = await fetch('/api/folders');
    const data = await response.json();
    
    if (data.success) {
      folders = data.folders;
      const folderList = document.getElementById('folder-list');
      const countAll = document.getElementById('count-all');
      
      // 更新总数
      countAll.textContent = data.totalBooks;
      
      // 渲染文件夹列表
      folderList.innerHTML = folders.map(folder => `
        <button class="folder-btn" data-folder="${folder}" onclick="switchFolder('${folder}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>${folder}</span>
          <span class="count" id="count-${folder}">0</span>
        </button>
      `).join('');
      
      // 加载每个文件夹的书籍数量
      folders.forEach(folder => {
        fetch(`/api/books/folder/${encodeURIComponent(folder)}`)
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              const countEl = document.getElementById(`count-${folder}`);
              if (countEl) countEl.textContent = data.books.length;
            }
          });
      });
    }
  } catch (err) {
    console.error('加载文件夹失败:', err);
  }
}

// 切换文件夹
function switchFolder(folder) {
  currentFolder = folder;
  
  // 更新按钮状态
  document.querySelectorAll('.folder-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.folder === folder) {
      btn.classList.add('active');
    }
  });
  
  // 重新筛选
  filterAndRender(searchInput.value.toLowerCase().trim(), currentFilter);
}

// 加载书籍列表
async function loadBooks() {
  try {
    const response = await fetch(`${API_BASE}/api/books`);
    const data = await response.json();
    
    if (data.success) {
      books = data.books;
      bookCount.textContent = `${books.length} 本书`;
      filterAndRender('', 'all');
    } else {
      showError('加载书籍失败');
    }
  } catch (err) {
    console.error('加载书籍失败:', err);
    showError('加载书籍失败');
  }
}

// 筛选并渲染
function filterAndRender(query, format) {
  let filtered = books;
  
  // 文件夹筛选
  if (currentFolder !== 'all') {
    filtered = filtered.filter(book => book.path.startsWith(currentFolder + '/'));
  }
  
  // 格式筛选
  if (format && format !== 'all') {
    const formatMap = {
      'epub': ['epub'],
      'pdf': ['pdf'],
      'txt': ['txt'],
      'mobi': ['mobi', 'azw', 'azw3'],
      'cbz': ['cbz', 'cbr']
    };
    const formats = formatMap[format] || [format];
    filtered = filtered.filter(book => formats.includes(book.format));
  }
  
  // 搜索筛选
  if (query) {
    filtered = filtered.filter(book => 
      book.title.toLowerCase().includes(query) ||
      book.format.toLowerCase().includes(query)
    );
  }
  
  renderBooks(filtered);
}

// 渲染书籍列表
function renderBooks(booksToRender) {
  if (booksToRender.length === 0) {
    booksGrid.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📚</div>
        <h3>没有找到书籍</h3>
        <p>试试其他搜索词，或上传一些新书</p>
      </div>
    `;
    return;
  }
  
  booksGrid.innerHTML = booksToRender.map(book => `
    <div class="book-card">
      <div class="book-cover" onclick="openBook('${book.id}')">
        <img src="/api/books/${book.id}/cover" alt="${escapeHtml(book.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <span class="book-cover-icon" style="display:none;">${getFormatIcon(book.format)}</span>
        <span class="book-format-badge">${book.format}</span>
        <div class="cover-overlay" onclick="event.stopPropagation(); changeCover('${book.id}')">
          <span>🖼️ 更换封面</span>
        </div>
      </div>
      <div class="book-info" onclick="openBook('${book.id}')">
        <div class="book-title">${escapeHtml(book.title)}</div>
        <div class="book-meta">
          <span class="book-size">${formatSize(book.size)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// 打开书籍
async function openBook(bookId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;
  
  currentBook = book;
  bookTitle.textContent = book.title;
  
  // 记录阅读时间
  fetch(`/api/books/${bookId}/read`, { method: 'POST' });
  
  showReader();
  
  try {
    await Reader.open(book);
  } catch (err) {
    console.error('打开书籍失败:', err);
    showError('打开书籍失败: ' + err.message);
    showLibrary();
  }
}

// 上传处理
async function handleUpload(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  
  uploadModal.classList.add('active');
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    uploadStatus.textContent = `${file.name} (${i + 1}/${files.length})`;
    
    const progressFill = document.querySelector('.progress-fill');
    progressFill.style.width = `${((i) / files.length) * 100}%`;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${API_BASE}/api/books/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (!data.success) {
        console.error('上传失败:', data.error);
      }
      
      progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    } catch (err) {
      console.error('上传失败:', err);
    }
  }
  
  setTimeout(() => {
    uploadModal.classList.remove('active');
    document.querySelector('.progress-fill').style.width = '0%';
    fileInput.value = '';
    loadBooks();
  }, 500);
}

// 视图切换
function showLibrary() {
  libraryView.classList.add('active');
  readerView.classList.remove('active');
  Reader.cleanup();
}

function showReader() {
  libraryView.classList.remove('active');
  readerView.classList.add('active');
}

// 主题切换
function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
  const btn = document.getElementById('theme-toggle');
  btn.innerHTML = isLight 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`
    : `<svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
}

// 字体大小控制
let currentFontSize = 16;
function changeFontSize(delta) {
  currentFontSize = Math.max(12, Math.min(24, currentFontSize + delta));
  const readerContent = document.querySelector('.reader-content');
  if (readerContent) {
    readerContent.style.fontSize = currentFontSize + 'px';
  }
  localStorage.setItem('fontSize', currentFontSize);
}

// 工具函数
function getFormatIcon(format) {
  const icons = {
    epub: '📖',
    pdf: '📄',
    mobi: '📱',
    azw: '📱',
    azw3: '📱',
    txt: '📝',
    fb2: '📚',
    djvu: '🖼️',
    cbz: '🎨',
    cbr: '🎨',
    doc: '📃',
    docx: '📃',
    rtf: '📃',
    html: '🌐',
    md: '📋'
  };
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

function showError(message) {
  alert(message);
}

// 更换封面
async function changeCover(bookId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/jpg';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 检查文件大小 (最大 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showError('封面图片不能超过 5MB');
      return;
    }
    
    const formData = new FormData();
    formData.append('cover', file);
    
    try {
      const response = await fetch(`/api/books/${bookId}/cover`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 强制刷新所有匹配的图片
        const newUrl = `/api/books/${bookId}/cover?t=${Date.now()}`;
        document.querySelectorAll(`img[src*="${bookId}"]`).forEach(img => {
          img.src = newUrl;
        });
      } else {
        showError('更换封面失败: ' + (data.error || '未知错误'));
      }
    } catch (err) {
      console.error('更换封面失败:', err);
      showError('更换封面失败');
    }
  };
  
  input.click();
}

// 全局函数供 HTML onclick 使用
window.openBook = openBook;
window.closeSettings = closeSettings;
window.applyFavicon = applyFavicon;
window.applyBackground = applyBackground;
window.changeCover = changeCover;
