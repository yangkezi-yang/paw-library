const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const VIDEO_DIR = path.join(ROOT, 'uploads', 'videos');
const DOC_DIR = path.join(ROOT, 'uploads', 'documents');
const DB_FILE = path.join(DATA_DIR, 'resources.json');
for (const dir of [DATA_DIR, VIDEO_DIR, DOC_DIR]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads/videos', express.static(VIDEO_DIR));
app.use('/uploads/documents', express.static(DOC_DIR));

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}
function writeDB(items) { fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2), 'utf8'); }
function safeName(name) {
  return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, '_').slice(0, 120) || 'file';
}
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']);
const docExts = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv', '.md']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, req.path === '/api/upload/video' ? VIDEO_DIR : DOC_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(Buffer.from(file.originalname, 'latin1').toString('utf8'))}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (req.path === '/api/upload/video') return cb(null, videoTypes.has(file.mimetype) || /\.(mp4|webm|mov|mkv)$/i.test(file.originalname));
    cb(null, docExts.has(path.extname(file.originalname).toLowerCase()));
  }
});

app.get('/api/resources', (req, res) => {
  const items = readDB().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ videos: items.filter(x => x.type === 'video'), documents: items.filter(x => x.type === 'document') });
});

function uploadHandler(type) {
  return (req, res) => {
    upload.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件超过 1GB 限制。' : err.message });
      if (!req.file) return res.status(400).json({ error: '请选择有效文件。' });
      const title = String(req.body.title || '').trim().slice(0, 120) || path.parse(req.file.originalname).name;
      const description = String(req.body.description || '').trim().slice(0, 500);
      const item = {
        id: crypto.randomUUID(), type, title, description,
        originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        filename: req.file.filename, mimeType: req.file.mimetype,
        size: req.file.size, createdAt: new Date().toISOString(),
        url: `/uploads/${type === 'video' ? 'videos' : 'documents'}/${encodeURIComponent(req.file.filename)}`
      };
      const items = readDB(); items.push(item); writeDB(items);
      res.status(201).json({ item });
    });
  };
}
app.post('/api/upload/video', uploadHandler('video'));
app.post('/api/upload/document', uploadHandler('document'));

app.delete('/api/resources/:id', (req, res) => {
  const items = readDB();
  const item = items.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: '资源不存在。' });
  const folder = item.type === 'video' ? VIDEO_DIR : DOC_DIR;
  const filePath = path.join(folder, path.basename(item.filename));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeDB(items.filter(x => x.id !== item.id));
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: '服务器暂时遇到问题。' }); });
app.listen(PORT, '0.0.0.0', () => console.log(`Paw Library is running on http://localhost:${PORT}`));
