const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
  scanBooks, getBookInfo, getBookContent, uploadBook, getBookCover,
  invalidateCache, getBookmarks, saveBookmarks,
  getTags, saveTags, getBookMeta, saveBookMeta,
  getReadingProgress, saveReadingProgress
} = require('./routes/books');

const app = express();
const PORT = process.env.PORT || 8374;
const BOOKS_DIR = process.env.BOOKS_DIR || '/books';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const COVERS_DIR = path.join(BOOKS_DIR, '.covers');
const TRASH_DIR = path.join(BOOKS_DIR, '.trash');
const TRASH_INDEX = path.join(TRASH_DIR, 'index.json');
const TRASH_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

// 确保目录存在
async function ensureBooksDir() {
  try {
    await fs.promises.mkdir(BOOKS_DIR, { recursive: true });
    await fs.promises.mkdir(COVERS_DIR, { recursive: true });
    await fs.promises.mkdir(TRASH_DIR, { recursive: true });
    console.log(`📚 书籍目录: ${BOOKS_DIR}`);
    console.log(`🖼️ 封面目录: ${COVERS_DIR}`);
    console.log(`🗑️ 回收站: ${TRASH_DIR} (保留 7 天)`);
  } catch (err) {
    console.error('创建书籍目录失败:', err);
  }
}

// ========== 回收站 ==========
async function readTrashIndex() {
  try {
    const data = await fs.promises.readFile(TRASH_INDEX, 'utf-8');
    return JSON.parse(data);
  } catch { return []; }
}

async function writeTrashIndex(list) {
  await fs.promises.writeFile(TRASH_INDEX, JSON.stringify(list, null, 2), 'utf-8');
}

// 移入回收站
async function moveToTrash(book, booksDir) {
  const trashId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const trashFilePath = path.join(TRASH_DIR, trashId + path.extname(book.filename));

  const srcPath = path.join(booksDir, book.filename);
  try {
    await fs.promises.rename(srcPath, trashFilePath);
  } catch {
    // 跨设备时 rename 失败，改用复制+删除
    await fs.promises.copyFile(srcPath, trashFilePath);
    await fs.promises.unlink(srcPath);
  }

  // 同时保存封面（如有）
  let coverExt = null;
  for (const ext of ['.jpg', '.png']) {
    const cp = path.join(COVERS_DIR, `${book.id}${ext}`);
    if (await fileExists(cp)) {
      await fs.promises.copyFile(cp, path.join(TRASH_DIR, trashId + '_cover' + ext));
      coverExt = ext;
      break;
    }
  }

  const list = await readTrashIndex();
  list.push({
    trashId,
    id: book.id,
    title: book.title,
    filename: book.filename,
    format: book.format,
    size: book.size,
    deletedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TRASH_TTL).toISOString(),
    coverExt
  });
  await writeTrashIndex(list);

  return trashId;
}

// 清理过期回收站（7 天）
async function cleanupTrash() {
  try {
    const list = await readTrashIndex();
    const now = Date.now();
    const keep = [];
    let removed = 0;

    for (const item of list) {
      if (new Date(item.expiresAt).getTime() < now) {
        // 删除文件
        try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + path.extname(item.filename))); } catch {}
        if (item.coverExt) {
          try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + '_cover' + item.coverExt)); } catch {}
        }
        removed++;
      } else {
        keep.push(item);
      }
    }

    if (removed > 0) {
      await writeTrashIndex(keep);
      console.log(`🧹 回收站清理了 ${removed} 本过期书籍`);
    }
    return removed;
  } catch (err) {
    console.error('清理回收站失败:', err);
    return 0;
  }
}

// ========== 工具函数 ==========
async function fileExists(filePath) {
  try { await fs.promises.access(filePath); return true; }
  catch { return false; }
}

// ========== 统计信息 ==========
app.get('/api/stats', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const byFormat = {};
    let totalSize = 0;

    books.forEach(book => {
      byFormat[book.format] = (byFormat[book.format] || 0) + 1;
      totalSize += book.size;
    });

    res.json({ success: true, totalBooks: books.length, totalSize, byFormat });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 文件夹 ==========
app.get('/api/folders', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const folders = new Set();
    books.forEach(book => {
      const parts = book.path.split('/');
      if (parts.length > 1) folders.add(parts[0]);
    });
    res.json({ success: true, folders: Array.from(folders).sort(), totalBooks: books.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/books/folder/:folder', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const filtered = books.filter(b => b.path.startsWith(req.params.folder + '/'));
    res.json({ success: true, books: filtered, folder: req.params.folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 标签 ==========
app.get('/api/tags', async (req, res) => {
  try {
    const tags = await getTags(BOOKS_DIR);
    res.json({ success: true, tags });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/books/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body; // array of strings
    const allTags = await getTags(BOOKS_DIR);
    allTags[req.params.id] = tags || [];
    await saveTags(BOOKS_DIR, allTags);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 书签 ==========
app.get('/api/books/:id/bookmarks', async (req, res) => {
  try {
    const bookmarks = await getBookmarks(BOOKS_DIR);
    res.json({ success: true, bookmarks: bookmarks[req.params.id] || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/books/:id/bookmarks', async (req, res) => {
  try {
    const bookmarks = await getBookmarks(BOOKS_DIR);
    if (!bookmarks[req.params.id]) bookmarks[req.params.id] = [];

    const { label, position, timestamp } = req.body;
    bookmarks[req.params.id].push({
      id: Date.now().toString(36),
      label: label || '',
      position,
      timestamp: timestamp || new Date().toISOString()
    });

    await saveBookmarks(BOOKS_DIR, bookmarks);
    res.json({ success: true, bookmarks: bookmarks[req.params.id] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/books/:id/bookmarks/:bookmarkId', async (req, res) => {
  try {
    const bookmarks = await getBookmarks(BOOKS_DIR);
    if (bookmarks[req.params.id]) {
      bookmarks[req.params.id] = bookmarks[req.params.id].filter(b => b.id !== req.params.bookmarkId);
      await saveBookmarks(BOOKS_DIR, bookmarks);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 阅读进度（服务端持久化） ==========
app.get('/api/books/:id/progress', async (req, res) => {
  try {
    const progress = await getReadingProgress(BOOKS_DIR);
    res.json({ success: true, progress: progress[req.params.id] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/books/:id/progress', async (req, res) => {
  try {
    const progress = await getReadingProgress(BOOKS_DIR);
    progress[req.params.id] = {
      ...progress[req.params.id],
      ...req.body,
      lastUpdated: new Date().toISOString()
    };
    await saveReadingProgress(BOOKS_DIR, progress);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 书籍元数据编辑 ==========
app.put('/api/books/:id/meta', async (req, res) => {
  try {
    const meta = await getBookMeta(BOOKS_DIR);
    if (!meta[req.params.id]) meta[req.params.id] = {};
    if (req.body.title !== undefined) meta[req.params.id].title = req.body.title;
    await saveBookMeta(BOOKS_DIR, meta);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 删除书籍（移入回收站） ==========
app.delete('/api/books/:id', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const book = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ success: false, error: '书籍不存在' });

    await moveToTrash(book, BOOKS_DIR);
    invalidateCache();
    res.json({ success: true, message: '已移入回收站（保留 7 天）' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量删除（移入回收站） ==========
app.post('/api/books/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ success: false, error: '缺少 ids' });

    const books = await scanBooks(BOOKS_DIR);
    let deleted = 0;

    for (const id of ids) {
      const book = books.find(b => b.id === id);
      if (!book) continue;
      try {
        await moveToTrash(book, BOOKS_DIR);
        deleted++;
      } catch (err) {
        console.error('移入回收站失败:', id, err.message);
      }
    }

    invalidateCache();
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 回收站：封面 ==========
app.get('/api/trash/:trashId/cover', async (req, res) => {
  try {
    const list = await readTrashIndex();
    const item = list.find(i => i.trashId === req.params.trashId);
    if (!item || !item.coverExt) return res.status(404).json({ success: false, error: '无封面' });

    const coverPath = path.join(TRASH_DIR, item.trashId + '_cover' + item.coverExt);
    if (!(await fileExists(coverPath))) return res.status(404).json({ success: false, error: '无封面' });

    res.setHeader('Content-Type', item.coverExt === '.png' ? 'image/png' : 'image/jpeg');
    fs.createReadStream(coverPath).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 回收站：列表 ==========
app.get('/api/trash', async (req, res) => {
  try {
    await cleanupTrash();
    const list = await readTrashIndex();
    // 按删除时间倒序
    list.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    res.json({ success: true, items: list, total: list.length, ttlDays: 7 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 回收站：恢复 ==========
app.post('/api/trash/:trashId/restore', async (req, res) => {
  try {
    const list = await readTrashIndex();
    const item = list.find(i => i.trashId === req.params.trashId);
    if (!item) return res.status(404).json({ success: false, error: '回收站中未找到' });

    const srcPath = path.join(TRASH_DIR, item.trashId + path.extname(item.filename));
    const destPath = path.join(BOOKS_DIR, item.filename);

    // 确保目标目录存在
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    // 若已存在同名文件，加后缀避免覆盖
    let finalDest = destPath;
    if (await fileExists(destPath)) {
      const ext = path.extname(item.filename);
      const base = item.filename.slice(0, -ext.length);
      finalDest = path.join(BOOKS_DIR, `${base}_恢复_${Date.now().toString(36)}${ext}`);
      item.filename = path.relative(BOOKS_DIR, finalDest);
    }

    try {
      await fs.promises.rename(srcPath, finalDest);
    } catch {
      await fs.promises.copyFile(srcPath, finalDest);
      await fs.promises.unlink(srcPath);
    }

    // 恢复封面
    if (item.coverExt) {
      const coverSrc = path.join(TRASH_DIR, item.trashId + '_cover' + item.coverExt);
      const coverDest = path.join(COVERS_DIR, `${item.id}${item.coverExt}`);
      try { await fs.promises.rename(coverSrc, coverDest); } catch {}
    }

    // 从索引移除
    const newList = list.filter(i => i.trashId !== req.params.trashId);
    await writeTrashIndex(newList);
    invalidateCache();

    res.json({ success: true, message: '已恢复' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 回收站：彻底删除 ==========
app.delete('/api/trash/:trashId', async (req, res) => {
  try {
    const list = await readTrashIndex();
    const item = list.find(i => i.trashId === req.params.trashId);
    if (!item) return res.status(404).json({ success: false, error: '回收站中未找到' });

    try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + path.extname(item.filename))); } catch {}
    if (item.coverExt) {
      try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + '_cover' + item.coverExt)); } catch {}
    }

    const newList = list.filter(i => i.trashId !== req.params.trashId);
    await writeTrashIndex(newList);
    res.json({ success: true, message: '已彻底删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 回收站：清空 ==========
app.post('/api/trash/empty', async (req, res) => {
  try {
    const list = await readTrashIndex();
    for (const item of list) {
      try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + path.extname(item.filename))); } catch {}
      if (item.coverExt) {
        try { await fs.promises.unlink(path.join(TRASH_DIR, item.trashId + '_cover' + item.coverExt)); } catch {}
      }
    }
    await writeTrashIndex([]);
    res.json({ success: true, deleted: list.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 书籍列表（合并所有数据，支持分页） ==========
app.get('/api/books', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const history = await getReadingProgress(BOOKS_DIR);
    const tags = await getTags(BOOKS_DIR);
    const meta = await getBookMeta(BOOKS_DIR);

    const booksWithAll = books.map(book => ({
      ...book,
      title: meta[book.id]?.title || book.title,
      lastRead: history[book.id]?.lastRead || null,
      readCount: history[book.id]?.readCount || 0,
      progress: history[book.id]?.percentage || 0,
      tags: tags[book.id] || []
    }));

    // 按阅读时间排序（最近阅读的在前）
    booksWithAll.sort((a, b) => {
      if (!a.lastRead && !b.lastRead) return 0;
      if (!a.lastRead) return 1;
      if (!b.lastRead) return -1;
      return new Date(b.lastRead) - new Date(a.lastRead);
    });

    // 分页参数
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const total = booksWithAll.length;
    const page = booksWithAll.slice(offset, offset + limit);

    res.json({
      success: true,
      books: page,
      total,
      offset,
      limit,
      hasMore: offset + limit < total
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 轻量书籍索引（仅标题等，用于搜索/筛选） ==========
app.get('/api/books/index', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const history = await getReadingProgress(BOOKS_DIR);
    const tags = await getTags(BOOKS_DIR);
    const meta = await getBookMeta(BOOKS_DIR);

    // 只返回必要字段，大幅压缩体积
    const index = books.map(book => ({
      id: book.id,
      t: meta[book.id]?.title || book.title,
      f: book.format,
      s: book.size,
      m: book.modified,
      p: book.path,
      lr: history[book.id]?.lastRead || null,
      pg: history[book.id]?.percentage || 0,
      tg: tags[book.id] || []
    }));

    res.json({ success: true, books: index, total: index.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await getBookInfo(req.params.id, BOOKS_DIR);
    if (!book) return res.status(404).json({ success: false, error: '书籍不存在' });

    const history = await getReadingProgress(BOOKS_DIR);
    const tags = await getTags(BOOKS_DIR);

    res.json({
      success: true,
      book: {
        ...book,
        lastRead: history[req.params.id]?.lastRead || null,
        readCount: history[req.params.id]?.readCount || 0,
        progress: history[req.params.id]?.percentage || 0,
        tags: tags[req.params.id] || []
      }
    });
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

// ========== 封面 ==========
app.get('/api/books/:id/cover', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const book = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ success: false, error: '书籍不存在' });

    // 优先检查自定义封面
    const customCoverPath = path.join(COVERS_DIR, `${req.params.id}.jpg`);
    const customCoverPngPath = path.join(COVERS_DIR, `${req.params.id}.png`);

    if (await fileExists(customCoverPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return fs.createReadStream(customCoverPath).pipe(res);
    }
    if (await fileExists(customCoverPngPath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return fs.createReadStream(customCoverPngPath).pipe(res);
    }

    // 尝试提取并缓存封面到 .covers/
    const cover = await getBookCover(book, BOOKS_DIR);
    if (cover) {
      // 缓存封面
      const ext = cover.mimeType === 'image/png' ? '.png' : '.jpg';
      const cachePath = path.join(COVERS_DIR, `${req.params.id}_cached${ext}`);
      try { await fs.promises.writeFile(cachePath, cover.data); } catch {}

      res.setHeader('Content-Type', cover.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cover.data);
    }

    // 检查缓存封面
    const cachedJpg = path.join(COVERS_DIR, `${req.params.id}_cached.jpg`);
    const cachedPng = path.join(COVERS_DIR, `${req.params.id}_cached.png`);
    if (await fileExists(cachedJpg)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(cachedJpg).pipe(res);
    }
    if (await fileExists(cachedPng)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(cachedPng).pipe(res);
    }

    // 默认封面
    const defaultCover = generateDefaultCover(book.title, book.format);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(defaultCover);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传自定义封面
const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, COVERS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.params.id}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 JPG/PNG 格式'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('cover');

app.post('/api/books/:id/cover', (req, res) => {
  coverUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: '未选择封面图片' });
    res.json({ success: true, message: '封面上传成功', coverUrl: `/api/books/${req.params.id}/cover?t=${Date.now()}` });
  });
});

app.delete('/api/books/:id/cover', async (req, res) => {
  try {
    const jpgPath = path.join(COVERS_DIR, `${req.params.id}.jpg`);
    const pngPath = path.join(COVERS_DIR, `${req.params.id}.png`);
    let deleted = false;
    if (await fileExists(jpgPath)) { await fs.promises.unlink(jpgPath); deleted = true; }
    if (await fileExists(pngPath)) { await fs.promises.unlink(pngPath); deleted = true; }
    res.json(deleted ? { success: true, message: '封面已恢复默认' } : { success: false, error: '未找到自定义封面' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 阅读记录（兼容旧接口） ==========
app.post('/api/books/:id/read', async (req, res) => {
  try {
    const progress = await getReadingProgress(BOOKS_DIR);
    if (!progress[req.params.id]) progress[req.params.id] = {};
    progress[req.params.id].lastRead = new Date().toISOString();
    progress[req.params.id].readCount = (progress[req.params.id].readCount || 0) + 1;
    await saveReadingProgress(BOOKS_DIR, progress);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 提供书籍文件
app.get('/api/books/:id/file', async (req, res) => {
  try {
    const books = await scanBooks(BOOKS_DIR);
    const book = books.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ success: false, error: '书籍不存在' });

    const filePath = path.join(BOOKS_DIR, book.filename);
    res.setHeader('Content-Type', book.mime);
    const stat = await fs.promises.stat(filePath);
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传书籍
const upload = uploadBook(BOOKS_DIR);
app.post('/api/books/upload', (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: '未选择文件' });

    invalidateCache();
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

// ========== 手动刷新缓存 ==========
app.post('/api/refresh', async (req, res) => {
  try {
    invalidateCache();
    const books = await scanBooks(BOOKS_DIR);
    res.json({ success: true, totalBooks: books.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 默认封面生成 ==========
function generateDefaultCover(title, format) {
  const formatColors = {
    epub: ['#667eea', '#764ba2'], pdf: ['#f093fb', '#f5576c'],
    txt: ['#4facfe', '#00f2fe'], mobi: ['#fa709a', '#fee140'],
    azw: ['#fa709a', '#fee140'], cbz: ['#30cfd0', '#330867'],
    cbr: ['#30cfd0', '#330867'], default: ['#6366f1', '#8b5cf6']
  };
  const colors = formatColors[format] || formatColors.default;
  const shortTitle = title.length > 20 ? title.substring(0, 20) + '...' : title;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
    <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1"/>
    </linearGradient></defs>
    <rect width="300" height="400" fill="url(#bg)"/>
    <text x="150" y="200" font-family="Arial,sans-serif" font-size="48" fill="white" text-anchor="middle" dominant-baseline="middle">📖</text>
    <text x="150" y="280" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle">${shortTitle}</text>
    <text x="150" y="320" font-family="Arial,sans-serif" font-size="12" fill="rgba(255,255,255,0.7)" text-anchor="middle">${format.toUpperCase()}</text>
  </svg>`;
}

// 启动
ensureBooksDir().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📖 电子书阅读器运行在 http://0.0.0.0:${PORT}`);
  });
});
