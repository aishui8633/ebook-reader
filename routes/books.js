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

// 读取文件并自动处理编码
async function readFileWithEncoding(filePath) {
  const buffer = await fs.readFile(filePath);
  
  const detected = jschardet.detect(buffer);
  console.log(`检测到编码: ${detected.encoding}, 置信度: ${detected.confidence}`);
  
  if (!detected.encoding || detected.encoding === 'UTF-8' || detected.encoding === 'ascii') {
    return buffer.toString('utf-8');
  }
  
  const encoding = detected.encoding.toLowerCase();
  const encodingMap = {
    'gb2312': 'gbk',
    'gbk': 'gbk',
    'gb18030': 'gb18030',
    'big5': 'big5',
    'utf-8': 'utf-8',
    'utf8': 'utf-8'
  };
  
  const targetEncoding = encodingMap[encoding] || encoding;
  
  try {
    return iconv.decode(buffer, targetEncoding);
  } catch (err) {
    console.error(`解码失败 (${targetEncoding}):`, err);
    try {
      return iconv.decode(buffer, 'gbk');
    } catch (err2) {
      return buffer.toString('utf-8');
    }
  }
}

// 获取 EPUB 封面
async function getEpubCover(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    // 查找封面图片
    const coverNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.gif', 
                        'titlepage.jpg', 'titlepage.jpeg', 'titlepage.png',
                        'images/cover.jpg', 'images/cover.jpeg', 'images/cover.png',
                        'OEBPS/images/cover.jpg', 'OEBPS/cover.jpg'];
    
    for (const name of coverNames) {
      const entry = entries.find(e => e.entryName.toLowerCase().includes(name.toLowerCase()));
      if (entry) {
        const data = entry.getData();
        const ext = path.extname(entry.entryName).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 
                        ext === '.gif' ? 'image/gif' : 'image/jpeg';
        return { data, mimeType };
      }
    }
    
    // 如果没找到，尝试找第一张图片
    const imageEntries = entries.filter(e => {
      const ext = path.extname(e.entryName).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext) && !e.isDirectory;
    });
    
    if (imageEntries.length > 0) {
      const firstImage = imageEntries[0];
      const data = firstImage.getData();
      const ext = path.extname(firstImage.entryName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 
                      ext === '.gif' ? 'image/gif' : 'image/jpeg';
      return { data, mimeType };
    }
    
    return null;
  } catch (err) {
    console.error('提取 EPUB 封面失败:', err);
    return null;
  }
}

// 获取 CBZ 封面
async function getCbzCover(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    // 找第一张图片
    const imageEntries = entries.filter(e => {
      const ext = path.extname(e.entryName).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) && !e.isDirectory;
    }).sort((a, b) => a.entryName.localeCompare(b.entryName));
    
    if (imageEntries.length > 0) {
      const firstImage = imageEntries[0];
      const data = firstImage.getData();
      const ext = path.extname(firstImage.entryName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 
                      ext === '.gif' ? 'image/gif' :
                      ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { data, mimeType };
    }
    
    return null;
  } catch (err) {
    console.error('提取 CBZ 封面失败:', err);
    return null;
  }
}

// 获取书籍封面
async function getBookCover(book, booksDir) {
  const filePath = path.join(booksDir, book.filename);
  
  switch (book.format) {
    case 'epub':
      return await getEpubCover(filePath);
    case 'cbz':
    case 'cbr':
      return await getCbzCover(filePath);
    default:
      return null;
  }
}

// 扫描书籍目录
async function scanBooks(booksDir) {
  const books = [];
  
  async function scanDir(dir, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const format = SUPPORTED_FORMATS[ext];
        
        if (format) {
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
        }
      }
    }
  }
  
  await scanDir(booksDir);
  books.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  
  return books;
}

// 获取书籍信息
async function getBookInfo(bookId, booksDir) {
  const books = await scanBooks(booksDir);
  return books.find(b => b.id === bookId);
}

// 获取书籍内容
async function getBookContent(bookId, booksDir) {
  const book = await getBookInfo(bookId, booksDir);
  
  if (!book) {
    throw new Error('书籍不存在');
  }
  
  const filePath = path.join(booksDir, book.filename);
  
  if (['txt', 'html', 'htm', 'md'].includes(book.format)) {
    const content = await readFileWithEncoding(filePath);
    return {
      type: book.format,
      content
    };
  }
  
  return {
    type: book.format,
    url: `/api/books/${bookId}/file`,
    mime: book.mime
  };
}

// 上传配置
function uploadBook(booksDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, booksDir);
    },
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
  
  return multer({ 
    storage,
    fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 }
  }).single('file');
}

module.exports = {
  scanBooks,
  getBookInfo,
  getBookContent,
  uploadBook,
  getBookCover,
  SUPPORTED_FORMATS
};
