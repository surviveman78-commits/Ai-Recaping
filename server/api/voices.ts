import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { jobStore } from '../services/jobStore.ts';

const execFileAsync = promisify(execFile);
const router = Router();

// Configure storage for custom voice uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'voices');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `voice-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files (.wav, .mp3, .m4a, .ogg, .flac) are allowed'));
    }
  },
});

async function validateUploadedAudio(filePath: string): Promise<{ duration: number; sampleRate: number }> {
  const stat = await fs.promises.stat(filePath);
  if (stat.size < 1024) {
    throw new Error('Uploaded audio file is empty or corrupted (< 1KB)');
  }

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=sample_rate,channels',
      '-of', 'json',
      filePath,
    ], { timeout: 6000 });

    const info = JSON.parse(stdout);
    const duration = parseFloat(info?.format?.duration || '0');
    const stream = info?.streams?.[0] || {};
    const sampleRate = parseInt(stream.sample_rate || '24000', 10);

    if (isNaN(duration) || duration <= 0.1) {
      throw new Error('Unable to detect readable audio stream in uploaded file');
    }

    if (duration < 2.0) {
      throw new Error(`Reference audio is too short (${duration.toFixed(1)}s). Please upload at least 3 seconds of clean speech.`);
    }

    if (duration > 65.0) {
      throw new Error(`Reference audio is too long (${duration.toFixed(1)}s). Preferred length is 5–30 seconds (maximum 60s).`);
    }

    return { duration, sampleRate };
  } catch (err: any) {
    if (err.message?.includes('Reference audio')) {
      throw err;
    }
    // If ffprobe throws an error parsing container
    throw new Error(`Audio validation failed: ${err.message || 'File is corrupted or unreadable'}`);
  }
}

// GET /api/voices - List all voice profiles
router.get('/', (_req: Request, res: Response) => {
  res.json(jobStore.getAllVoiceProfiles());
});

// POST /api/voices - Create voice profile with validated reference audio
router.post('/', upload.single('referenceAudio'), async (req: Request, res: Response) => {
  const file = req.file;

  try {
    const { name, referenceText, speed, styleSettings, generationSettings } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      if (file) fs.unlink(file.path, () => {});
      res.status(400).json({ error: 'Profile name is required' });
      return;
    }

    if (!referenceText || typeof referenceText !== 'string' || !referenceText.trim()) {
      if (file) fs.unlink(file.path, () => {});
      res.status(400).json({ error: 'Reference text is required for zero-shot cloning' });
      return;
    }

    let audioDuration = 0;
    let audioSampleRate = 24000;

    if (file) {
      try {
        const valid = await validateUploadedAudio(file.path);
        audioDuration = valid.duration;
        audioSampleRate = valid.sampleRate;
      } catch (valErr: any) {
        fs.unlink(file.path, () => {});
        res.status(400).json({ error: valErr.message || 'Invalid reference audio file' });
        return;
      }
    }

    let parsedStyle = { emotion: 'Neutral', pitch: 0, accent: 'Neutral' };
    let parsedGen = { temperature: 0.72, topP: 0.85, diffusionSteps: 30, guidanceScale: 3.5 };

    try {
      if (typeof styleSettings === 'string') parsedStyle = JSON.parse(styleSettings);
      else if (styleSettings) parsedStyle = styleSettings;
    } catch {}

    try {
      if (typeof generationSettings === 'string') parsedGen = JSON.parse(generationSettings);
      else if (generationSettings) parsedGen = generationSettings;
    } catch {}

    const audioUrl = file ? `/uploads/voices/${file.filename}` : undefined;
    const audioPath = file ? path.resolve(file.path) : undefined;

    const newProfile = jobStore.createVoiceProfile({
      name: name.trim(),
      engine: 'voxcpm2',
      referenceAudioUrl: audioUrl,
      referenceAudioPath: audioPath,
      referenceAudioFilename: file ? file.originalname : undefined,
      referenceText: referenceText.trim(),
      speed: Number(speed) || 1.0,
      styleSettings: parsedStyle,
      generationSettings: parsedGen,
      metadata: {
        audioDuration,
        audioSampleRate,
      },
    });

    res.status(201).json(newProfile);
  } catch (err: any) {
    if (file) fs.unlink(file.path, () => {});
    res.status(500).json({ error: err.message || 'Failed to create voice profile' });
  }
});

// DELETE /api/voices/:id - Delete a voice profile and its reference audio
router.delete('/:id', (req: Request, res: Response) => {
  const profile = jobStore.getVoiceProfile(req.params.id);
  if (!profile) {
    res.status(404).json({ error: 'Voice profile not found' });
    return;
  }

  // If local file exists, remove it
  if (profile.referenceAudioPath && fs.existsSync(profile.referenceAudioPath)) {
    fs.unlink(profile.referenceAudioPath, () => {});
  } else if (profile.referenceAudioUrl?.startsWith('/uploads/voices/')) {
    const local = path.join(process.cwd(), profile.referenceAudioUrl);
    if (fs.existsSync(local)) {
      fs.unlink(local, () => {});
    }
  }

  const success = jobStore.deleteVoiceProfile(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Voice profile not found' });
    return;
  }
  res.json({ message: 'Voice profile deleted successfully' });
});

export default router;
