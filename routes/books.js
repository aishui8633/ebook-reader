const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');
const AdmZip = require('adm-zip');

// 支持的格式
const SUPPORTED_FORMATS = {
  '.epub': { type: 'epub', mime: 'application/epub+zip' },
  '.pdf': { type: 'pdf', mime: 'application/pdf' },
  '.mobi': { type: 'mobi', mime: 'application/x-mobipocket-ebook' },
  '.azw': { type: 'azw', mime: 'application/vnd.amazon.ebook' },
  '.azw3': { type: 'azw3', mime: 'application/vnd.amazon.ebook' },
  '.txt': { type: 'txt', mime: 'text/plain' },
  '.fb2': { type: 'fb2', mime: 'application/fictionbook2+zip' },
  '.fb2.zip': { type: 'fb2', mime: 'application/fictionbook2+zip' },
  '.djvu': { type: 'djvu', mime: 'image/vnd.djvu' },
  '.cbz': { type: 'cbz', mime: 'application/x-cbz' },
  '.cbr': { type: 'cbr', mime: 'application/x-cbr' },
  '.doc': { type: 'doc', mime: 'application/msword' },
  '.docx': { type: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.rtf': { type: 'rtf', mime: 'application/rtf' },
  '.html': { type: 'html', mime: 'text/html' },
  '.htm': { type: 'html', mime: 'text/html' },
  '.md': { type: 'md', mime: 'text/markdown' }
};

// ========== 书库缓存 ==========
let bookCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 60 秒缓存

function invalidateCache() {
  bookCache = null;
  cacheTimestamp = 0;
}

// ========== 编码处理 ==========
async function readFileWithEncoding(filePath) {
  const buffer = await fs.readFile(filePath);
  const detected = jschardet.detect(buffer);

  if (!detected.encoding || detected.encoding === 'UTF-8' || detected.encoding === 'ascii') {
    return buffer.toString('utf-8');
  }

  const encodingMap = { 'gb2312': 'gbk', 'gbk': 'gbk', 'gb18030': 'gb18030', 'big5': 'big5' };
  const targetEncoding = encodingMap[detected.encoding.toLowerCase()] || detected.encoding;

  try { return iconv.decode(buffer, targetEncoding); }
  catch { return iconv.decode(buffer, 'gbk'); }
}

// ========== 封面提取 ==========
async function getEpubCover(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const coverNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.gif',
      'titlepage.jpg', 'titlepage.jpeg', 'titlepage.png',
      'images/cover.jpg', 'images/cover.jpeg', 'images/cover.png',
      'OEBPS/images/cover.jpg', 'OEBPS/cover.jpg'];

    for (const name of coverNames) {
      const entry = entries.find(e => e.entryName.toLowerCase().includes(name.toLowerCase()));
      if (entry) {
        const data = entry.getData();
        const ext = path.extname(entry.entryName).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
        return { data, mimeType };
      }
    }

    const imageEntries = entries.filter(e => {
      const ext = path.extname(e.entryName).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext) && !e.isDirectory;
    });
    if (imageEntries.length > 0) {
      const data = imageEntries[0].getData();
      const ext = path.extname(imageEntries[0].entryName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      return { data, mimeType };
    }
    return null;
  } catch { return null; }
}

async function getCbzCover(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const imageEntries = zip.getEntries().filter(e => {
      const ext = path.extname(e.entryName).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) && !e.isDirectory;
    }).sort((a, b) => a.entryName.localeCompare(b.entryName));

    if (imageEntries.length > 0) {
      const data = imageEntries[0].getData();
      const ext = path.extname(imageEntries[0].entryName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { data, mimeType };
    }
    return null;
  } catch { return null; }
}

async function getBookCover(book, booksDir) {
  const filePath = path.join(booksDir, book.filename);
  switch (book.format) {
    case 'epub': return await getEpubCover(filePath);
    case 'cbz': case 'cbr': return await getCbzCover(filePath);
    default: return null;
  }
}

// ========== JSON 文件读写工具 ==========
async function readJsonFile(filePath, fallback = {}) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch { return fallback; }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 扫描书籍（带缓存） ==========
async function scanBooks(booksDir) {
  // 检查缓存
  if (bookCache && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return bookCache;
  }

  const books = [];

  async function scanDir(dir, relativePath = '') {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      // 跳过隐藏文件/目录（.covers 等）
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const format = SUPPORTED_FORMATS[ext];

        if (format) {
          try {
            const stat = await fs.stat(fullPath);
            const id = crypto.createHash('md5').update(relPath).digest('hex');

            books.push({
              id,
              filename: relPath,
              title: path.basename(entry.name, path.extname(entry.name)),
              format: format.type,
              mime: format.mime,
              size: stat.size,
              modified: stat.mtime,
              path: relPath,
              coverUrl: `/api/books/${id}/cover`
            });
          } catch (err) {
            console.error('读取文件失败:', relPath, err.message);
          }
        }
      }
    }
  }

  await scanDir(booksDir);
  books.sort((a, b) => new Date(b.modified) - new Date(a.modified));

  // 更新缓存
  bookCache = books;
  cacheTimestamp = Date.now();

  return books;
}

// ========== 书签 ==========
async function getBookmarks(booksDir) {
  return await readJsonFile(path.join(booksDir, '.bookmarks.json'), {});
}

async function saveBookmarks(booksDir, bookmarks) {
  await writeJsonFile(path.join(booksDir, '.bookmarks.json'), bookmarks);
}

// ========== 标签 ==========
async function getTags(booksDir) {
  return await readJsonFile(path.join(booksDir, '.tags.json'), {});
}

async function saveTags(booksDir, tags) {
  await writeJsonFile(path.join(booksDir, '.tags.json'), tags);
}

// ========== 书籍元数据 ==========
async function getBookMeta(booksDir) {
  return await readJsonFile(path.join(booksDir, '.book-meta.json'), {});
}

async function saveBookMeta(booksDir, meta) {
  await writeJsonFile(path.join(booksDir, '.book-meta.json'), meta);
}

// ========== 阅读进度 ==========
async function getReadingProgress(booksDir) {
  return await readJsonFile(path.join(booksDir, '.reading-progress.json'), {});
}

async function saveReadingProgress(booksDir, progress) {
  await writeJsonFile(path.join(booksDir, '.reading-progress.json'), progress);
}

// ========== 书籍信息（合并元数据） ==========
async function getBookInfo(bookId, booksDir) {
  const books = await scanBooks(booksDir);
  const book = books.find(b => b.id === bookId);
  if (!book) return null;

  // 合并自定义标题
  const meta = await getBookMeta(booksDir);
  if (meta[bookId]?.title) {
    book.title = meta[bookId].title;
  }

  return book;
}

// ========== 获取书籍内容 ==========
async function getBookContent(bookId, booksDir) {
  const book = await getBookInfo(bookId, booksDir);
  if (!book) throw new Error('书籍不存在');

  const filePath = path.join(booksDir, book.filename);

  if (['txt', 'html', 'htm', 'md'].includes(book.format)) {
    const content = await readFileWithEncoding(filePath);
    return { type: book.format, content };
  }

  return { type: book.format, url: `/api/books/${bookId}/file`, mime: book.mime };
}

// ========== 上传 ==========
function uploadBook(booksDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, booksDir),
    filename: (req, file, cb) => {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, originalName);
    }
  });

  const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_FORMATS[ext]) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的格式: ${ext}`), false);
    }
  };

  return multer({ storage, fileFilter, limits: { fileSize: 500 * 1024 * 1024 } }).single('file');
}

module.exports = {
  scanBooks,
  getBookInfo,
  getBookContent,
  uploadBook,
  getBookCover,
  SUPPORTED_FORMATS,
  invalidateCache,
  getBookmarks,
  saveBookmarks,
  getTags,
  saveTags,
  getBookMeta,
  saveBookMeta,
  getReadingProgress,
  saveReadingProgress
};
