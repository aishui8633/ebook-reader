const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { scanBooks, getBookInfo, getBookContent, uploadBook, getBookCover } = require('./routes/books');

const app = express();
const PORT = process.env.PORT || 8374;
const BOOKS_DIR = process.env.BOOKS_DIR || '/books';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 自定义封面目录
const COVERS_DIR = path.join(BOOKS_DIR, '.covers');

// 确保书籍目录和封面目录存在
async function ensureBooksDir() {
  try {
    await fs.promises.mkdir(BOOKS_DIR, { recursive: true });
    await fs.promises.mkdir(COVERS_DIR, { recursive: true });
    console.log(`📚 书籍目录: ${BOOKS_DIR}`);
    console.log(`🖼️ 封面目录: ${COVERS_DIR}`);
  } catch (err) {
    console.error('创建书籍目录失败:', err);
  }
}

// 获取文件夹列表
app.get('/api/folders', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const folders = new Set();
    
    books.forEach(book => {
      const parts = book.path.split('/');
      if (parts.length > 1) {
        folders.add(parts[0]);
      }
    });
    
    res.json({ 
      success: true, 
      folders: Array.from(folders).sort(),
      totalBooks: books.length
    });
  } catch (err) {
    console.error('获取文件夹失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取指定文件夹下的书籍
app.get('/api/books/folder/:folder', async (req, res) => {
  try {
    const folder = req.params.folder;
    const books = await scanBooks(BOOKS_DIR);
    const filtered = books.filter(b => b.path.startsWith(folder + '/'));
    res.json({ success: true, books: filtered, folder });
  } catch (err) {
    console.error('获取文件夹书籍失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 阅读记录文件
const READING_HISTORY_FILE = path.join(BOOKS_DIR, '.reading-history.json');

// 加载阅读记录
async function loadReadingHistory() {
  try {
    const data = await fs.promises.readFile(READING_HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// 保存阅读记录
async function saveReadingHistory(history) {
  try {
    await fs.promises.writeFile(READING_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('保存阅读记录失败:', err);
  }
}

// 记录阅读时间
app.post('/api/books/:id/read', async (req, res) => {
  try {
    const bookId = req.params.id;
    const history = await loadReadingHistory();
    
    history[bookId] = {
      lastRead: new Date().toISOString(),
      readCount: (history[bookId]?.readCount || 0) + 1
    };
    
    await saveReadingHistory(history);
    res.json({ success: true });
  } catch (err) {
    console.error('记录阅读时间失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取阅读记录
app.get('/api/reading-history', async (req, res) => {
  try {
    const history = await loadReadingHistory();
    res.json({ success: true, history });
  } catch (err) {
    console.error('获取阅读记录失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API 路由
app.get('/api/books', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const history = await loadReadingHistory();
    
    // 添加阅读时间到书籍信息
    const booksWithHistory = books.map(book => ({
      ...book,
      lastRead: history[book.id]?.lastRead || null,
      readCount: history[book.id]?.readCount || 0
    }));
    
    // 按阅读时间排序（最近阅读的在前）
    booksWithHistory.sort((a, b) => {
      if (!a.lastRead && !b.lastRead) return 0;
      if (!a.lastRead) return 1;
      if (!b.lastRead) return -1;
      return new Date(b.lastRead) - new Date(a.lastRead);
    });
    
    res.json({ success: true, books: booksWithHistory });
  } catch (err) {
    console.error('扫描书籍失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await getBookInfo(req.params.id, BOOKS_DIR);
    if (!book) {
      return res.status(404).json({ success: false, error: '书籍不存在' });
    }
    res.json({ success: true, book });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/books/:id/content', async (req, res) => {
  try {
    const content = await getBookContent(req.params.id, BOOKS_DIR);
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取书籍封面（优先自定义封面）
app.get('/api/books/:id/cover', async (req, res) => {
  try {
    const bookId = req.params.id;
    const books = await scanBooks(BOOKS_DIR);
    const book = books.find(b => b.id === bookId);
    
    if (!book) {
      return res.status(404).json({ success: false, error: '书籍不存在' });
    }
    
    // 优先检查自定义封面
    const customCoverPath = path.join(COVERS_DIR, `${bookId}.jpg`);
    const customCoverPngPath = path.join(COVERS_DIR, `${bookId}.png`);
    
    let customCover = null;
    if (await fileExists(customCoverPath)) {
      customCover = { path: customCoverPath, mime: 'image/jpeg' };
    } else if (await fileExists(customCoverPngPath)) {
      customCover = { path: customCoverPngPath, mime: 'image/png' };
    }
    
    if (customCover) {
      res.setHeader('Content-Type', customCover.mime);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const stream = fs.createReadStream(customCover.path);
      stream.pipe(res);
      return;
    }
    
    // 否则提取原始封面
    const cover = await getBookCover(book, BOOKS_DIR);
    
    if (cover) {
      res.setHeader('Content-Type', cover.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cover.data);
    } else {
      // 返回默认封面（SVG）
      const defaultCover = generateDefaultCover(book.title, book.format);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(defaultCover);
    }
  } catch (err) {
    console.error('获取封面失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传自定义封面
const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, COVERS_DIR),
    filename: (req, file, cb) => {
      const bookId = req.params.id;
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${bookId}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 JPG/PNG 格式'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('cover');

app.post('/api/books/:id/cover', (req, res) => {
  coverUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未选择封面图片' });
    }
    
    res.json({
      success: true,
      message: '封面上传成功',
      coverUrl: `/api/books/${req.params.id}/cover?t=${Date.now()}`
    });
  });
});

// 删除自定义封面
app.delete('/api/books/:id/cover', async (req, res) => {
  try {
    const bookId = req.params.id;
    const jpgPath = path.join(COVERS_DIR, `${bookId}.jpg`);
    const pngPath = path.join(COVERS_DIR, `${bookId}.png`);
    
    let deleted = false;
    if (await fileExists(jpgPath)) {
      await fs.promises.unlink(jpgPath);
      deleted = true;
    }
    if (await fileExists(pngPath)) {
      await fs.promises.unlink(pngPath);
      deleted = true;
    }
    
    if (deleted) {
      res.json({ success: true, message: '封面已恢复默认' });
    } else {
      res.json({ success: false, error: '未找到自定义封面' });
    }
  } catch (err) {
    console.error('删除封面失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 辅助函数：检查文件是否存在
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 提供书籍文件
app.get('/api/books/:id/file', async (req, res) => {
  try {
    const bookId = req.params.id;
    const books = await scanBooks(BOOKS_DIR);
    const book = books.find(b => b.id === bookId);
    
    if (!book) {
      return res.status(404).json({ success: false, error: '书籍不存在' });
    }
    
    const filePath = path.join(BOOKS_DIR, book.filename);
    
    // 设置正确的 Content-Type
    res.setHeader('Content-Type', book.mime);
    
    const stat = await fs.promises.stat(filePath);
    res.setHeader('Content-Length', stat.size);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (err) {
    console.error('发送文件失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传书籍
const upload = uploadBook(BOOKS_DIR);
app.post('/api/books/upload', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未选择文件' });
    }
    
    res.json({ 
      success: true, 
      message: '上传成功',
      book: {
        id: req.file.filename.replace(path.extname(req.file.originalname), ''),
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
      }
    });
  });
});

// 生成默认封面 SVG
function generateDefaultCover(title, format) {
  const formatColors = {
    epub: ['#667eea', '#764ba2'],
    pdf: ['#f093fb', '#f5576c'],
    txt: ['#4facfe', '#00f2fe'],
    mobi: ['#fa709a', '#fee140'],
    azw: ['#fa709a', '#fee140'],
    cbz: ['#30cfd0', '#330867'],
    cbr: ['#30cfd0', '#330867'],
    default: ['#6366f1', '#8b5cf6']
  };
  
  const colors = formatColors[format] || formatColors.default;
  const shortTitle = title.length > 20 ? title.substring(0, 20) + '...' : title;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="300" height="400" fill="url(#bg)"/>
    <text x="150" y="200" font-family="Arial, sans-serif" font-size="48" fill="white" text-anchor="middle" dominant-baseline="middle">📖</text>
    <text x="150" y="280" font-family="Arial, sans-serif" font-size="16" fill="white" text-anchor="middle">${shortTitle}</text>
    <text x="150" y="320" font-family="Arial, sans-serif" font-size="12" fill="rgba(255,255,255,0.7)" text-anchor="middle">${format.toUpperCase()}</text>
  </svg>`;
}

// 启动
ensureBooksDir().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📖 电子书阅读器运行在 http://0.0.0.0:${PORT}`);
  });
});
