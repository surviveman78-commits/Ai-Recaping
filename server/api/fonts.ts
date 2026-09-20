import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

const fontsDir = path.join(process.cwd(), 'uploads', 'fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

const fontStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, fontsDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const fontUpload = multer({
  storage: fontStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.ttf' || ext === '.otf' || ext === '.woff' || ext === '.woff2') {
      cb(null, true);
    } else {
      cb(new Error('Only font files (.ttf, .otf, .woff, .woff2) are supported'));
    }
  },
});

router.post('/upload', fontUpload.single('fontFile'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No font file uploaded' });
      return;
    }

    const fontUrl = `/uploads/fonts/${req.file.filename}`;
    const fontName = path.parse(req.file.originalname).name;

    res.json({
      success: true,
      fontName,
      filename: req.file.filename,
      url: fontUrl,
      sizeBytes: req.file.size,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Font upload failed' });
  }
});

export default router;
