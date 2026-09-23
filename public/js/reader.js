// 阅读器模块
const Reader = (() => {
  let currentReader = null;
  let currentBook = null;
  let currentBookId = null;
  let _currentScrollHandler = null;
  let readerSettings = {
    font: localStorage.getItem('reader-font') || 'system',
    fontSize: parseInt(localStorage.getItem('fontSize')) || 16,
    lineHeight: localStorage.getItem('reader-lineHeight') || '1.8',
    background: localStorage.getItem('reader-bg') || 'default'
  };
  
  const container = document.getElementById('reader-container');
  
  // 打开书籍
  async function open(book) {
    cleanup();
    currentBookId = book.id;
    
    const format = book.format;
    
    // 应用阅读设置
    applyReaderSettings();
    
    switch (format) {
      case 'epub': await openEpub(book); break;
      case 'pdf': await openPdf(book); break;
      case 'txt':
      case 'html':
      case 'htm':
      case 'md': await openText(book); break;
      case 'cbz': await openCbz(book); break;
      case 'mobi':
      case 'azw':
      case 'azw3': await openMobi(book); break;
      default:
        throw new Error(`暂不支持 ${format} 格式的直接阅读`);
    }
    
    // 显示进度条
    document.getElementById('progress-bar').style.display = 'block';
  }
  
  // 清理
  function cleanup() {
    const epubViewer = document.getElementById('epub-viewer');
    const epubNavbar = document.getElementById('epub-navbar');

    if (currentReader) {
      if (currentReader.destroy) {
        try { currentReader.destroy(); } catch (e) { console.warn('destroy reader:', e); }
      }
      currentReader = null;
    }
    if (currentBook) {
      if (currentBook.destroy) {
        try { currentBook.destroy(); } catch (e) { console.warn('destroy book:', e); }
      }
      currentBook = null;
    }

    // 移除滚动监听
    if (_currentScrollHandler) {
      container.removeEventListener('scroll', _currentScrollHandler);
      _currentScrollHandler = null;
    }

    currentBookId = null;

    // 移除上一次阅读动态插入的内容（PDF/TXT/CBZ 等会直接往 container 里塞节点）
    // 保留 #epub-viewer 这个固定容器，其余子节点全部清除
    if (container) {
      Array.from(container.children).forEach(child => {
        if (child.id !== 'epub-viewer' && child.id !== 'epub-navbar') {
          child.remove();
        }
      });
      // 兜底：清除任何遗留的阅读内容
      container.querySelectorAll('.reader-content, canvas.pdf-page').forEach(el => el.remove());
    }

    // 重置 EPUB 容器
    if (epubViewer) {
      epubViewer.style.display = 'none';
      epubViewer.innerHTML = '';
    }
    if (epubNavbar) {
      epubNavbar.style.display = 'none';
      epubNavbar.innerHTML = '';
    }

    // 重置 container 样式与类
    container.style.cssText = '';
    container.className = 'reader-container';

    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.display = 'none';

    const fill = document.getElementById('reading-progress-fill');
    const text = document.getElementById('reading-progress-text');
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = '0%';

    // 关闭设置面板
    const settingsPanel = document.getElementById('reader-settings-panel');
    if (settingsPanel) settingsPanel.style.display = 'none';
  }
  
  // 应用阅读设置
  function applyReaderSettings() {
    // 清除旧的背景类
    container.classList.remove('reader-bg-paper', 'reader-bg-eye', 'reader-bg-white', 'reader-bg-dark');
    
    // 应用背景
    if (readerSettings.background !== 'default') {
      container.classList.add(`reader-bg-${readerSettings.background}`);
    }
    
    // 更新设置面板按钮状态
    document.querySelectorAll('.font-opt').forEach(b => b.classList.toggle('active', b.dataset.font === readerSettings.font));
    document.querySelectorAll('.fs-opt').forEach(b => b.classList.toggle('active', parseInt(b.dataset.size) === readerSettings.fontSize));
    document.querySelectorAll('.lh-opt').forEach(b => b.classList.toggle('active', b.dataset.lh === readerSettings.lineHeight));
    document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === readerSettings.background));
  }
  
  // 设置方法
  function setFont(font) {
    readerSettings.font = font;
    localStorage.setItem('reader-font', font);
    applyReaderSettings();
    if (currentReader && currentBook && currentBook.format === 'epub') {
      updateEpubTheme();
    }
  }
  
  function setFontSize(size) {
    readerSettings.fontSize = size;
    localStorage.setItem('fontSize', size);
    const content = document.querySelector('.reader-content');
    if (content) content.style.fontSize = size + 'px';
    
    if (currentReader && currentBook && currentBook.format === 'epub') {
      currentReader.themes.fontSize(size + 'px');
    }
  }
  
  function setLineHeight(lh) {
    readerSettings.lineHeight = lh;
    localStorage.setItem('reader-lineHeight', lh);
    const content = document.querySelector('.reader-content');
    if (content) content.style.lineHeight = lh;
  }
  
  function setBackground(bg) {
    readerSettings.background = bg;
    localStorage.setItem('reader-bg', bg);
    applyReaderSettings();
    if (currentReader && currentBook && currentBook.format === 'epub') {
      updateEpubTheme();
    }
  }
  
  // 更新进度
  function updateProgress(percentage) {
    const fill = document.getElementById('reading-progress-fill');
    const text = document.getElementById('reading-progress-text');
    const pct = Math.round(percentage * 100);
    fill.style.width = pct + '%';
    text.textContent = pct + '%';
    
    // 同步到服务端
    if (currentBookId) {
      fetch(`/api/books/${currentBookId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percentage: pct })
      }).catch(() => {});
    }
  }
  
  // ========== 书签 ==========
  async function getBookmarks() {
    if (!currentBookId) return [];
    try {
      const res = await fetch(`/api/books/${currentBookId}/bookmarks`);
      const data = await res.json();
      return data.success ? data.bookmarks : [];
    } catch { return []; }
  }
  
  async function addBookmark() {
    if (!currentBookId) return;
    
    let position = null;
    let label = '';
    
    // 获取当前位置
    if (currentBook && currentBook.format === 'epub' && currentReader) {
      const location = currentReader.currentLocation();
      if (location && location.start) {
        position = { cfi: location.start.cfi, href: location.start.href };
        label = `位置 ${Math.round((location.start.percentage || 0) * 100)}%`;
      }
    }
    
    const bookmarkLabel = prompt('书签备注（可选）：', label) || label || '书签';
    
    try {
      await fetch(`/api/books/${currentBookId}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: bookmarkLabel, position })
      });
      showToast('书签已添加');
    } catch { showToast('添加书签失败'); }
  }
  
  async function deleteBookmark(bookmarkId) {
    if (!currentBookId) return;
    try {
      await fetch(`/api/books/${currentBookId}/bookmarks/${bookmarkId}`, { method: 'DELETE' });
      showToast('书签已删除');
    } catch {}
  }
  
  function loadBookmarks() {
    getBookmarks().then(bookmarks => {
      const list = document.getElementById('bookmarks-list');
      if (bookmarks.length === 0) {
        list.innerHTML = '<div class="empty" style="padding:2rem"><p>暂无书签</p></div>';
        return;
      }
      
      list.innerHTML = bookmarks.map(b => `
        <div class="bookmark-item" onclick="jumpToBookmark(${JSON.stringify(b.position).replace(/"/g, '&quot;')})">
          <span class="bookmark-label">🔖 ${escapeHtml(b.label)}</span>
          <span class="bookmark-time">${new Date(b.timestamp).toLocaleString('zh-CN')}</span>
          <button class="bookmark-delete" onclick="event.stopPropagation(); deleteBookmark('${b.id}').then(() => loadBookmarks())">✕</button>
        </div>
      `).join('');
    });
  }
  
  function jumpToBookmark(position) {
    if (!position) return;
    
    if (currentBook && currentBook.format === 'epub' && currentReader && position.cfi) {
      currentReader.display(position.cfi);
      closeBookmarksModal();
    }
  }
  
  // ========== EPUB ==========
  async function openEpub(book) {
    const epubViewer = document.getElementById('epub-viewer');
    const epubNavbar = document.getElementById('epub-navbar');
    
    epubViewer.innerHTML = '';
    epubViewer.style.display = 'block';
    epubNavbar.style.display = 'flex';
    container.style.overflow = 'hidden';
    
    const bookUrl = `/api/books/${book.id}/file`;
    
    try {
      const response = await fetch(bookUrl);
      if (!response.ok) throw new Error('文件下载失败');
      const arrayBuffer = await response.arrayBuffer();
      
      const epubBook = ePub(arrayBuffer);
      currentBook = epubBook;
      
      const rendition = epubBook.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'none',
        allowScriptedContent: true
      });
      
      currentReader = rendition;
      
      // 主题
      function updateEpubTheme() {
        const bgColors = {
          default: document.body.classList.contains('light-theme') ? '#f8f9fa' : '#0f0f0f',
          paper: '#f5e6c8',
          eye: '#c7edcc',
          white: '#ffffff',
          dark: '#0a0a0a'
        };
        const textColors = {
          default: document.body.classList.contains('light-theme') ? '#1a1a1a' : '#e0e0e0',
          paper: '#5c4b37',
          eye: '#2d5a32',
          white: '#1a1a1a',
          dark: '#cccccc'
        };
        
        const bg = bgColors[readerSettings.background] || bgColors.default;
        const text = textColors[readerSettings.background] || textColors.default;
        
        const fontFamily = {
          system: '-apple-system, BlinkMacSystemFont, sans-serif',
          serif: "'Noto Serif SC', 'Source Han Serif CN', STSong, serif",
          sans: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          kai: "'STKaiti', 'KaiTi', serif"
        };
        
        const theme = {
          'body': {
            'color': `${text} !important`,
            'background': `${bg} !important`,
            'padding': '20px',
            'font-family': `${fontFamily[readerSettings.font]} !important`,
            'font-size': `${readerSettings.fontSize}px !important`,
            'line-height': `${readerSettings.lineHeight} !important`
          },
          'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': `${text} !important` },
          'a': { 'color': '#6366f1 !important' },
          'img': { 'max-width': '100%' }
        };
        
        rendition.themes.register('custom', theme);
        rendition.themes.select('custom');
        rendition.themes.fontSize(readerSettings.fontSize + 'px');
      }
      
      rendition.hooks.content.register(updateEpubTheme);
      
      // 触摸事件
      rendition.hooks.content.register(function(contents) {
        const doc = contents.document || contents;
        let touchStartX = 0, touchStartY = 0;
        
        doc.addEventListener('touchstart', function(e) {
          touchStartX = e.changedTouches[0].screenX;
          touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });
        
        doc.addEventListener('touchend', function(e) {
          const deltaX = e.changedTouches[0].screenX - touchStartX;
          const deltaY = e.changedTouches[0].screenY - touchStartY;
          
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX < 0) rendition.next(); else rendition.prev();
          } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 50) {
            if (deltaY < 0) rendition.next(); else rendition.prev();
          }
        }, { passive: true });
      });
      
      // 目录
      const navigation = await epubBook.loaded.navigation;
      const toc = navigation.toc || [];
      createEpubNavBar(toc, rendition, epubBook);
      
      await rendition.display();
      updateEpubTheme();
      
      epubBook.locations.generate(1024);
      
      rendition.on('relocated', (location) => {
        updateEpubProgress(location, epubBook, toc);
        if (location.start && location.start.cfi) {
          localStorage.setItem(`epub-position-${book.id}`, JSON.stringify({
            cfi: location.start.cfi,
            timestamp: Date.now()
          }));
        }
      });
      
      // 键盘
      document.addEventListener('keydown', function epubKeyHandler(e) {
        if (!currentReader || currentReader !== rendition) {
          document.removeEventListener('keydown', epubKeyHandler);
          return;
        }
        if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); rendition.next(); }
      });
      
      // 点击翻页
      epubViewer.addEventListener('click', (e) => {
        const rect = epubViewer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const third = rect.width / 3;
        if (x < third) rendition.prev();
        else if (x > third * 2) rendition.next();
      });
      
      // 手势
      let touchStartX = 0;
      epubViewer.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
      epubViewer.addEventListener('touchend', (e) => {
        const delta = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(delta) > 50) { if (delta < 0) rendition.next(); else rendition.prev(); }
      }, { passive: true });
      
      // 恢复位置
      const savedPosition = localStorage.getItem(`epub-position-${book.id}`);
      if (savedPosition) {
        try {
          const pos = JSON.parse(savedPosition);
          if (pos.cfi) await rendition.display(pos.cfi);
          else await rendition.display();
        } catch { await rendition.display(); }
      }
      
    } catch (err) {
      console.error('EPUB 打开失败:', err);
      epubViewer.innerHTML = `<div style="text-align:center;padding:2rem;color:#888;">EPUB 打开失败: ${err.message}</div>`;
    }
  }
  
  function createEpubNavBar(toc, rendition, epubBook) {
    const navbar = document.getElementById('epub-navbar');
    navbar.innerHTML = '';
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'epub-nav-btn';
    prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    prevBtn.onclick = () => rendition.prev();
    
    const chapterSelect = document.createElement('select');
    chapterSelect.className = 'epub-chapter-select';
    chapterSelect.id = 'epub-chapter-select';
    
    function flattenToc(items, level = 0) {
      let result = [];
      items.forEach(item => {
        result.push({ label: item.label.trim(), href: item.href, level });
        if (item.subitems && item.subitems.length > 0) {
          result = result.concat(flattenToc(item.subitems, level + 1));
        }
      });
      return result;
    }
    
    const flatToc = flattenToc(toc);
    
    if (flatToc.length > 0) {
      flatToc.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.href;
        opt.textContent = ' '.repeat(item.level) + item.label;
        chapterSelect.appendChild(opt);
      });
      chapterSelect.onchange = function() { if (this.value) rendition.display(this.value); };
    } else {
      chapterSelect.innerHTML = '<option value="">无目录</option>';
      chapterSelect.disabled = true;
    }
    
    const progressInfo = document.createElement('span');
    progressInfo.className = 'epub-location-info';
    progressInfo.id = 'epub-location-info';
    progressInfo.textContent = '--';
    
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'epub-nav-btn';
    bookmarkBtn.innerHTML = '🔖';
    bookmarkBtn.title = '书签';
    bookmarkBtn.onclick = () => openBookmarksModal();
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'epub-nav-btn';
    nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    nextBtn.onclick = () => rendition.next();
    
    navbar.appendChild(prevBtn);
    navbar.appendChild(chapterSelect);
    navbar.appendChild(progressInfo);
    navbar.appendChild(bookmarkBtn);
    navbar.appendChild(nextBtn);
  }
  
  function updateEpubProgress(location, epubBook, toc) {
    const progressInfo = document.getElementById('epub-location-info');
    const chapterSelect = document.getElementById('epub-chapter-select');
    
    if (!progressInfo || !chapterSelect) return;
    
    if (epubBook.locations.length() > 0) {
      const currentCfi = location.start.cfi;
      const progress = epubBook.locations.percentageFromCfi(currentCfi);
      const pct = Math.round((progress || 0) * 100);
      progressInfo.textContent = pct + '%';
      updateProgress(progress || 0);
    }
    
    if (location.start.href) {
      const options = chapterSelect.options;
      for (let i = 0; i < options.length; i++) {
        if (options[i].value === location.start.href) {
          chapterSelect.selectedIndex = i;
          break;
        }
      }
    }
  }
  
  // ========== PDF ==========
  async function openPdf(book) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px - 28px);
      overflow: auto;
      background: var(--bg-primary);
    `;
    
    const content = document.createElement('div');
    content.className = 'reader-content pdf-content';
    container.appendChild(content);
    
    const loadingTask = pdfjsLib.getDocument(`/api/books/${book.id}/file`);
    const pdf = await loadingTask.promise;
    currentReader = pdf;
    
    // 渲染所有页面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page';
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      content.appendChild(canvas);
      
      // 更新进度
      updateProgress(pageNum / pdf.numPages);
    }
  }
  
  // ========== TXT ==========
  async function openText(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px - 28px);
      overflow: auto;
    `;
    
    const response = await fetch(`/api/books/${book.id}/content`);
    const data = await response.json();
    
    if (!data.success) throw new Error('读取文件失败');
    
    const content = document.createElement('div');
    content.className = 'reader-content txt-content';
    content.style.fontSize = readerSettings.fontSize + 'px';
    content.style.lineHeight = readerSettings.lineHeight;
    
    // 应用字体
    const fontFamilies = {
      system: '-apple-system, BlinkMacSystemFont, sans-serif',
      serif: "'Noto Serif SC', 'Source Han Serif CN', STSong, serif",
      sans: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      kai: "'STKaiti', 'KaiTi', serif"
    };
    content.style.fontFamily = fontFamilies[readerSettings.font] || fontFamilies.system;
    
    const textContent = data.content.content || data.content;
    
    if (book.format === 'html' || book.format === 'htm') {
      content.innerHTML = textContent;
    } else if (book.format === 'md') {
      content.innerHTML = simpleMarkdown(textContent);
    } else {
      // TXT - 分段显示，增加可读性
      const paragraphs = textContent.split(/\n\s*\n/);
      content.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
    }
    
    container.appendChild(content);

    // 滚动进度（用命名函数，cleanup 时可移除，避免多次打开重复累积）
    _currentScrollHandler = () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight - container.clientHeight;
      if (scrollHeight > 0) updateProgress(scrollTop / scrollHeight);
    };
    container.addEventListener('scroll', _currentScrollHandler, { passive: true });

    // 恢复上次滚动进度
    restoreTextPosition(book.id, () => {
      const max = container.scrollHeight - container.clientHeight;
      return max > 0 ? container.scrollTop / max : 0;
    }, (ratio) => {
      const max = container.scrollHeight - container.clientHeight;
      if (max > 0) container.scrollTop = max * ratio;
      updateProgress(ratio);
    });
  }

  // 保存/恢复纯文本类阅读位置（按滚动比例）
  function restoreTextPosition(bookId, getRatio, setRatio) {
    const key = `text-position-${bookId}`;

    // 滚动时保存
    const saveFn = () => {
      const ratio = getRatio();
      localStorage.setItem(key, String(ratio));
    };
    container.addEventListener('scroll', saveFn, { passive: true });

    // 恢复
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        const ratio = parseFloat(saved);
        if (!isNaN(ratio) && ratio > 0) {
          requestAnimationFrame(() => setRatio(ratio));
        }
      }
    } catch {}
  }
  
  // ========== CBZ ==========
  async function openCbz(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px - 28px);
      overflow: auto;
      background: var(--bg-primary);
    `;
    
    const content = document.createElement('div');
    content.className = 'reader-content';
    content.style.textAlign = 'center';
    container.appendChild(content);
    
    const response = await fetch(`/api/books/${book.id}/file`);
    const blob = await response.blob();
    
    const zip = await JSZip.loadAsync(blob);
    const images = [];
    
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      const ext = relativePath.toLowerCase().split('.').pop();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        images.push({ path: relativePath, file });
      }
    });
    
    images.sort((a, b) => a.path.localeCompare(b.path));
    
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const data = await img.file.async('base64');
      const ext = img.path.toLowerCase().split('.').pop();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      
      const imgEl = document.createElement('img');
      imgEl.src = `data:${mime};base64,${data}`;
      imgEl.style.maxWidth = '100%';
      imgEl.style.maxHeight = '90vh';
      imgEl.style.margin = '0.5rem 0';
      content.appendChild(imgEl);
      
      updateProgress((i + 1) / images.length);
    }
  }
  
  // ========== MOBI ==========
  async function openMobi(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px - 28px);
      overflow: auto;
    `;
    
    const content = document.createElement('div');
    content.className = 'reader-content';
    content.style.fontSize = readerSettings.fontSize + 'px';
    content.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <h3>📱 MOBI/AZW 格式</h3>
        <p>此格式需要转换后才能阅读</p>
        <p>建议：</p>
        <ul style="text-align: left; max-width: 400px; margin: 1rem auto;">
          <li>使用 Calibre 转换为 EPUB 格式</li>
          <li>或使用 Kindle 阅读器打开</li>
        </ul>
        <a href="/api/books/${book.id}/file" download class="btn btn-primary" style="display: inline-block; margin-top: 1rem;">
          下载原文件
        </a>
      </div>
    `;
    container.appendChild(content);
  }
  
  function simpleMarkdown(text) {
    return text
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
  
  return {
    open,
    cleanup,
    setFont,
    setFontSize,
    setLineHeight,
    setBackground,
    getBookmarks,
    addBookmark,
    deleteBookmark,
    loadBookmarks
  };
})();
