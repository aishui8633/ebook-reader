// 阅读器模块
const Reader = (() => {
  let currentReader = null;
  let currentBook = null;
  let keydownHandler = null;
  const container = document.getElementById('reader-container');
  
  // 打开书籍
  async function open(book) {
    cleanup();
    
    const format = book.format;
    
    switch (format) {
      case 'epub':
        await openEpub(book);
        break;
      case 'pdf':
        await openPdf(book);
        break;
      case 'txt':
      case 'html':
      case 'htm':
      case 'md':
        await openText(book);
        break;
      case 'cbz':
        await openCbz(book);
        break;
      case 'mobi':
      case 'azw':
      case 'azw3':
        await openMobi(book);
        break;
      default:
        throw new Error(`暂不支持 ${format} 格式的直接阅读，请下载后使用本地阅读器`);
    }
  }
  
  // 清理
  function cleanup() {
    const epubViewer = document.getElementById('epub-viewer');
    const epubNavbar = document.getElementById('epub-navbar');
    
    if (currentReader) {
      if (currentReader.destroy) {
        currentReader.destroy();
      }
      currentReader = null;
    }
    if (currentBook) {
      currentBook.destroy();
      currentBook = null;
    }
    
    // 重置 EPUB 模式
    epubViewer.style.display = 'none';
    epubViewer.innerHTML = '';
    epubNavbar.style.display = 'none';
    
    // 重置 reader-container 样式（不清空 innerHTML，因为 #epub-viewer 是固定子元素）
    container.style.cssText = '';
  }
  
  // EPUB 阅读
  async function openEpub(book) {
    const epubViewer = document.getElementById('epub-viewer');
    const epubNavbar = document.getElementById('epub-navbar');
    
    // 防御性检查
    if (!epubViewer) {
      console.error('epub-viewer element not found, recreating...');
      const viewerDiv = document.createElement('div');
      viewerDiv.id = 'epub-viewer';
      viewerDiv.style.cssText = 'width:100%;height:100%;position:relative;';
      container.appendChild(viewerDiv);
    }
    if (!epubNavbar) {
      console.error('epub-navbar element not found');
    }
    
    const viewer = document.getElementById('epub-viewer');
    const navbar = document.getElementById('epub-navbar');
    
    // 清空 viewer
    viewer.innerHTML = '';
    viewer.style.display = 'block';
    navbar.style.display = 'flex';
    
    // 隐藏 reader-container 的默认滚动
    container.style.overflow = 'hidden';
    
    const bookUrl = `/api/books/${book.id}/file`;
    
    try {
      // 下载 EPUB
      const response = await fetch(bookUrl);
      if (!response.ok) throw new Error('文件下载失败');
      const arrayBuffer = await response.arrayBuffer();
      
      // 创建 epub 实例
      const epubBook = ePub(arrayBuffer);
      currentBook = epubBook;
      
      // 创建 rendition - 渲染到固定的 #epub-viewer 容器
      const rendition = epubBook.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'none',
        allowScriptedContent: true
      });
      
      currentReader = rendition;
      
      // 主题注入
      function applyEpubTheme() {
        const isLight = document.body.classList.contains('light-theme');
        const theme = isLight ? {
          'body': { 'color': '#1a1a1a !important', 'background': '#f8f9fa !important', 'padding': '20px' },
          'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': '#1a1a1a !important' },
          'a': { 'color': '#6366f1 !important' },
          'img': { 'max-width': '100%' }
        } : {
          'body': { 'color': '#e0e0e0 !important', 'background': '#0f0f0f !important', 'padding': '20px' },
          'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': '#e0e0e0 !important' },
          'a': { 'color': '#818cf8 !important' },
          'img': { 'max-width': '100%' }
        };
        rendition.themes.register('custom', theme);
        rendition.themes.select('custom');
      }
      
      rendition.hooks.content.register(applyEpubTheme);
      
      // 在 iframe 内部绑定触摸事件
      rendition.hooks.content.register(function(contents) {
        const doc = contents.document || contents;
        let touchStartX = 0;
        let touchStartY = 0;
        
        doc.addEventListener('touchstart', function(e) {
          touchStartX = e.changedTouches[0].screenX;
          touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });
        
        doc.addEventListener('touchend', function(e) {
          const touchEndX = e.changedTouches[0].screenX;
          const touchEndY = e.changedTouches[0].screenY;
          const deltaX = touchEndX - touchStartX;
          const deltaY = touchEndY - touchStartY;
          const threshold = 50;
          
          // 水平滑动
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
            if (deltaX < 0) {
              rendition.next();
            } else {
              rendition.prev();
            }
          }
          // 垂直滑动也支持翻页
          else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > threshold) {
            if (deltaY < 0) {
              rendition.next();
            } else {
              rendition.prev();
            }
          }
        }, { passive: true });
      });
      
      // 获取目录
      const navigation = await epubBook.loaded.navigation;
      const toc = navigation.toc || [];
      
      // 创建导航栏
      createEpubNavBar(toc, rendition, epubBook);
      
      // 显示第一页
      await rendition.display();
      applyEpubTheme();
      
      // 生成 locations（用于进度）
      epubBook.locations.generate(1024);
      
      // 监听位置变化
      rendition.on('relocated', (location) => {
        updateEpubProgress(location, epubBook, toc);
        // 保存阅读位置
        if (location.start && location.start.cfi) {
          localStorage.setItem(`epub-position-${book.id}`, JSON.stringify({
            cfi: location.start.cfi,
            timestamp: Date.now()
          }));
        }
      });
      
      // 键盘导航 - 绑在 document 上
      document.addEventListener('keydown', function epubKeyHandler(e) {
        if (!currentReader || currentReader !== rendition) {
          document.removeEventListener('keydown', epubKeyHandler);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          rendition.prev();
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          rendition.next();
        }
      });
      
      // 点击翻页 - 绑在 viewer 上
      viewer.addEventListener('click', (e) => {
        const rect = viewer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const third = rect.width / 3;
        if (x < third) {
          rendition.prev();
        } else if (x > third * 2) {
          rendition.next();
        }
      });
      
      // 手势滑动翻页 - 支持触摸和鼠标
      let touchStartX = 0;
      let touchStartY = 0;
      let touchEndX = 0;
      let touchEndY = 0;
      
      viewer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
      }, { passive: true });
      
      viewer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe(rendition);
      }, { passive: true });
      
      // 鼠标拖动翻页（桌面端）
      let mouseDown = false;
      let mouseStartX = 0;
      let mouseStartY = 0;
      
      viewer.addEventListener('mousedown', (e) => {
        mouseDown = true;
        mouseStartX = e.screenX;
        mouseStartY = e.screenY;
      });
      
      viewer.addEventListener('mouseup', (e) => {
        if (mouseDown) {
          const deltaX = e.screenX - mouseStartX;
          const deltaY = e.screenY - mouseStartY;
          // 只有水平滑动距离大于垂直滑动距离，且超过阈值才触发翻页
          if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX < 0) {
              rendition.next();
            } else {
              rendition.prev();
            }
          }
          mouseDown = false;
        }
      });
      
      function handleSwipe(rend) {
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const threshold = 50;
        
        // 水平滑动
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
          if (deltaX < 0) {
            rend.next(); // 左滑下一页
          } else {
            rend.prev(); // 右滑上一页
          }
        }
        // 垂直滑动也支持翻页
        else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > threshold) {
          if (deltaY < 0) {
            rend.next(); // 上滑下一页
          } else {
            rend.prev(); // 下滑上一页
          }
        }
      }
      
      // 恢复阅读位置
      const savedPosition = localStorage.getItem(`epub-position-${book.id}`);
      if (savedPosition) {
        try {
          const pos = JSON.parse(savedPosition);
          if (pos.cfi) {
            await rendition.display(pos.cfi);
            console.log('已恢复到上次阅读位置');
          } else {
            await rendition.display();
          }
        } catch (err) {
          console.warn('恢复位置失败，从开头开始', err);
          await rendition.display();
        }
      } else {
        await rendition.display();
      }
      applyEpubTheme();
      
    } catch (err) {
      console.error('EPUB 打开失败:', err);
      viewer.innerHTML = `<div style="text-align:center;padding:2rem;color:#888;">EPUB 打开失败: ${err.message}</div>`;
    }
  }
  
  // 创建 EPUB 导航栏
  function createEpubNavBar(toc, rendition, epubBook) {
    const navbar = document.getElementById('epub-navbar');
    navbar.innerHTML = '';
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.className = 'epub-nav-btn';
    prevBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    prevBtn.title = '上一页 (←)';
    prevBtn.onclick = () => rendition.prev();
    
    // 章节选择
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
      flatToc.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.href;
        const indent = ' '.repeat(item.level);
        opt.textContent = indent + item.label;
        chapterSelect.appendChild(opt);
      });
      
      chapterSelect.onchange = function() {
        if (this.value) {
          rendition.display(this.value);
        }
      };
    } else {
      chapterSelect.innerHTML = '<option value="">无目录</option>';
      chapterSelect.disabled = true;
    }
    
    // 进度显示
    const progressInfo = document.createElement('span');
    progressInfo.className = 'epub-location-info';
    progressInfo.id = 'epub-location-info';
    progressInfo.textContent = '--';
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.className = 'epub-nav-btn';
    nextBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    nextBtn.title = '下一页 (→)';
    nextBtn.onclick = () => rendition.next();
    
    navbar.appendChild(prevBtn);
    navbar.appendChild(chapterSelect);
    navbar.appendChild(progressInfo);
    navbar.appendChild(nextBtn);
  }
  
  // 更新 EPUB 进度
  function updateEpubProgress(location, epubBook, toc) {
    const progressInfo = document.getElementById('epub-location-info');
    const chapterSelect = document.getElementById('epub-chapter-select');
    
    if (!progressInfo || !chapterSelect) return;
    
    // 计算进度
    if (epubBook.locations.length() > 0) {
      const currentCfi = location.start.cfi;
      const progress = epubBook.locations.percentageFromCfi(currentCfi);
      const pct = Math.round((progress || 0) * 100);
      progressInfo.textContent = pct + '%';
    }
    
    // 同步章节
    if (location.start.href) {
      const currentHref = location.start.href;
      const options = chapterSelect.options;
      for (let i = 0; i < options.length; i++) {
        if (options[i].value === currentHref) {
          chapterSelect.selectedIndex = i;
          break;
        }
      }
    }
  }
  
  // PDF 阅读
  async function openPdf(book) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px);
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
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      content.appendChild(canvas);
    }
  }
  
  // 纯文本阅读
  async function openText(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px);
      overflow: auto;
      background: var(--bg-primary);
    `;
    
    const response = await fetch(`/api/books/${book.id}/content`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error('读取文件失败');
    }
    
    const content = document.createElement('div');
    content.className = 'reader-content txt-content';
    content.style.fontSize = currentFontSize + 'px';
    
    const textContent = data.content.content || data.content;
    
    if (book.format === 'html' || book.format === 'htm') {
      content.innerHTML = textContent;
    } else if (book.format === 'md') {
      content.innerHTML = simpleMarkdown(textContent);
    } else {
      content.textContent = textContent;
    }
    
    container.appendChild(content);
  }
  
  // CBZ 阅读（漫画）
  async function openCbz(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px);
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
    
    for (const img of images) {
      const data = await img.file.async('base64');
      const ext = img.path.toLowerCase().split('.').pop();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      
      const imgEl = document.createElement('img');
      imgEl.src = `data:${mime};base64,${data}`;
      imgEl.style.maxWidth = '100%';
      imgEl.style.maxHeight = '90vh';
      imgEl.style.margin = '0.5rem 0';
      
      content.appendChild(imgEl);
    }
  }
  
  // MOBI/AZW 阅读
  async function openMobi(book) {
    container.style.cssText = `
      width: 100%;
      height: calc(100vh - 60px);
      overflow: auto;
      background: var(--bg-primary);
    `;
    
    const content = document.createElement('div');
    content.className = 'reader-content';
    content.style.fontSize = currentFontSize + 'px';
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
  
  // 简单 Markdown 渲染
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
    cleanup
  };
})();
