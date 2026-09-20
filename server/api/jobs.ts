import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { jobStore } from '../services/jobStore.ts';
import { workerBridge } from '../services/workerBridge.ts';

const router = Router();

// Configure storage for local video uploads
const videoUploadDir = path.join(process.cwd(), 'uploads', 'videos');
if (!fs.existsSync(videoUploadDir)) {
  fs.mkdirSync(videoUploadDir, { recursive: true });
}

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, videoUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueId = 'upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${uniqueId}${ext}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.mkv', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Supported video formats: MP4, MOV, MKV, WEBM'));
    }
  },
});

// POST /api/jobs/upload - Direct video file upload endpoint
router.post('/upload', videoUpload.single('video'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No video file provided' });
      return;
    }

    const uploadedFileId = path.parse(req.file.filename).name;

    res.status(200).json({
      success: true,
      uploadedFileId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filePath: req.file.path,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to upload video' });
  }
});

// POST /api/jobs - Submit a movie job (URL or Uploaded video)
router.post('/', (req: Request, res: Response) => {
  try {
    const {
      sourceType = 'url',
      sourceUrl,
      uploadedFileId,
      uploadedFileName,
      uploadedFileSize,
      audioMode = 'recap',
      selectedTtsEngine,
      voiceProfileId,
      edgeVoice,
      subtitleConfig,
      customTitle,
      targetLanguage,
      autoSimulate,
    } = req.body;

    if (sourceType === 'upload') {
      if (!uploadedFileId || typeof uploadedFileId !== 'string') {
        res.status(400).json({ error: 'Valid uploadedFileId is required for uploaded video jobs' });
        return;
      }
    } else {
      if (!sourceUrl || typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
        res.status(400).json({ error: 'Valid Movie URL is required' });
        return;
      }
    }

    const job = jobStore.createJob({
      sourceType: sourceType === 'upload' ? 'upload' : 'url',
      sourceUrl: sourceUrl?.trim(),
      uploadedFileId,
      uploadedFileName,
      uploadedFileSize: typeof uploadedFileSize === 'number' ? uploadedFileSize : undefined,
      audioMode: audioMode === 'dialogue' ? 'dialogue' : 'recap',
      selectedTtsEngine: selectedTtsEngine === 'voxcpm2' ? 'voxcpm2' : 'edge-tts',
      voiceProfileId,
      edgeVoice,
      subtitleConfig,
      customTitle,
      targetLanguage,
    });

    // Trigger queue processing for online workers
    workerBridge.triggerQueueProcessing();

    res.status(201).json(job);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create job' });
  }
});

// GET /api/jobs - List all jobs
router.get('/', (_req: Request, res: Response) => {
  res.json(jobStore.getAllJobs());
});

// GET /api/jobs/events - SSE stream for all job updates
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  const onJobUpdate = (job: any) => {
    res.write(`data: ${JSON.stringify({ type: 'job-updated', job })}\n\n`);
  };

  jobStore.on('job-updated', onJobUpdate);

  const keepAliveInterval = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    jobStore.removeListener('job-updated', onJobUpdate);
  });
});

// GET /api/jobs/:id - Get single job details
router.get('/:id', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// POST /api/jobs/:id/cancel - Cancel a job
router.post('/:id/cancel', (req: Request, res: Response) => {
  const cancelled = jobStore.cancelJob(req.params.id);
  if (!cancelled) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  workerBridge.cancelJob(req.params.id);
  res.json(cancelled);
});

// POST /api/jobs/:id/retry - Retry a failed or cancelled job
router.post('/:id/retry', (req: Request, res: Response) => {
  const retried = jobStore.retryJob(req.params.id);
  if (!retried) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  workerBridge.triggerQueueProcessing();
  res.json(retried);
});

// POST /api/jobs/:id/simulate - Trigger queue processing for this job
router.post('/:id/simulate', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  workerBridge.triggerQueueProcessing();
  res.json({ message: 'Queue processing triggered', jobId: job.id });
});

// GET /api/jobs/:id/events - SSE stream for specific job
router.get('/:id/events', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send current state
  res.write(`data: ${JSON.stringify(job)}\n\n`);

  const eventName = `job-${jobId}`;
  const onUpdate = (updatedJob: any) => {
    res.write(`data: ${JSON.stringify(updatedJob)}\n\n`);
    if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
      // Optional: keep open or close
    }
  };

  jobStore.on(eventName, onUpdate);

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    jobStore.removeListener(eventName, onUpdate);
  });
});

// GET /api/jobs/:id/subtitles - Download standalone recap.srt external subtitle file
router.get('/:id/subtitles', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Check physical disk in workspace first
  const fs = require('fs');
  const path = require('path');
  const diskSrtPath = path.join(process.cwd(), 'workspace', 'jobs', jobId, 'subtitles', 'recap.srt');

  if (fs.existsSync(diskSrtPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${job.title || 'recap'}.srt"`);
    res.sendFile(diskSrtPath);
    return;
  }

  // Generate SRT from timeline segments
  const segments = job.segments || [];
  if (segments.length === 0) {
    res.status(404).json({ error: 'No timeline segments available yet' });
    return;
  }

  function formatSrtTime(secs: number): string {
    const totalMs = Math.round(Math.max(0, secs) * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  let srt = '';
  segments.forEach((seg, idx) => {
    const seq = idx + 1;
    const startStr = formatSrtTime(seg.finalStart ?? seg.sourceStart);
    const endStr = formatSrtTime(seg.finalEnd ?? seg.sourceEnd);
    const text = (seg.scriptText || '').trim();
    if (text) {
      srt += `${seq}\n${startStr} --> ${endStr}\n${text}\n\n`;
    }
  });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${job.title ? job.title.replace(/[^a-zA-Z0-9_-]/g, '_') : 'recap'}.srt"`);
  res.send(srt);
});

// GET /api/jobs/:id/video - Stream real deliverable final_recap.mp4
router.get('/:id/video', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const fs = require('fs');
  const path = require('path');
  
  // Potential physical paths for final video
  const candidates = [
    job.outputVideoPath,
    path.join(process.cwd(), 'workspace', 'jobs', jobId, 'output', 'final_recap.mp4'),
    path.join(process.cwd(), 'workspace', 'jobs', jobId, 'outputs', 'final_recap.mp4'),
  ].filter(Boolean);

  let realVideoPath: string | null = null;
  for (const cp of candidates) {
    if (cp && fs.existsSync(cp) && fs.statSync(cp).size > 0) {
      realVideoPath = cp;
      break;
    }
  }

  if (!realVideoPath) {
    res.status(404).json({ error: 'Final recap video file not found on disk for this job' });
    return;
  }

  const stat = fs.statSync(realVideoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(realVideoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    res.writeHead(200, head);
    fs.createReadStream(realVideoPath).pipe(res);
  }
});

// GET /api/jobs/:id/timeline - Get authoritative timeline metadata
router.get('/:id/timeline', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    jobId,
    totalDuration: job.timelineTotalDuration || (job.segments.length > 0 ? job.segments[job.segments.length - 1].finalEnd : 0),
    segmentCount: job.segments.length,
    segments: job.timelineSegments || job.segments,
    srtPath: job.srtPath || `/api/jobs/${jobId}/subtitles`,
    status: job.currentStageNumber >= 6 ? 'completed' : 'pending',
  });
});

export default router;
