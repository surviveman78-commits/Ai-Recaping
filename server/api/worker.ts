import { Router, Request, Response } from 'express';
import { workerBridge } from '../services/workerBridge.ts';
import { jobStore } from '../services/jobStore.ts';
import { workerInitializer } from '../services/workerInitializer.ts';
import { StructuredError, JobProgressUpdatePayload, WorkerRegistrationPayload } from '../../src/types/index.ts';

const router = Router();

// Middleware to check worker authorization token if provided
function verifyWorkerAuth(req: Request, res: Response, next: Function) {
  const token = req.headers.authorization?.replace('Bearer ', '') || (req.query.token as string);
  const expectedToken = jobStore.getSettings().workerSecretToken;

  if (expectedToken && token && token !== expectedToken) {
    res.status(401).json({ error: 'Unauthorized worker token' });
    return;
  }
  next();
}

// -----------------------------------------------------------------------------
// Initialization & Capabilities Endpoints
// -----------------------------------------------------------------------------

router.get('/diagnostic', async (req: Request, res: Response) => {
  try {
    const workerId = (req.query.workerId as string) || 'kaggle-gpu-worker';
    const diag = await workerInitializer.getDiagnostics(workerId);
    res.json(diag);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch diagnostics' });
  }
});

// GET /api/workers/debug-initialization (Isolated Step-1 execution test)
router.get('/debug-initialization', async (req: Request, res: Response) => {
  try {
    const workerId = (req.query.workerId as string) || 'kaggle-gpu-worker';
    const result = await workerInitializer.getDebugStep1(workerId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to run debug initialization' });
  }
});

// GET /api/workers/initialization or /api/workers/:id/initialization
const handleGetInitialization = (req: Request, res: Response) => {
  const workerId = req.params.id || (req.query.workerId as string) || 'kaggle-gpu-worker';
  const status = workerInitializer.getStatus(workerId);
  res.json(status);
};
router.get('/initialization', handleGetInitialization);
router.get('/:id/initialization', handleGetInitialization);

// GET /api/workers/initialization/events or /api/workers/:id/initialization/events (SSE)
const handleInitializationEvents = (req: Request, res: Response) => {
  const workerId = req.params.id || (req.query.workerId as string) || 'kaggle-gpu-worker';
  console.log(`[KAGGLE-WORKER][HTTP] SSE client connected (workerId: ${workerId})`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();
  console.log(`[KAGGLE-WORKER][HTTP] SSE HEADERS SENT (workerId: ${workerId})`);

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ workerId, time: new Date().toISOString() })}\n\n`);

  // Send keepalive comments every 10s to prevent timeouts through proxies/Cloudflare
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch {}
  }, 10000);

  res.on('close', () => {
    console.log(`[KAGGLE-WORKER][HTTP] SSE client closed (workerId: ${workerId})`);
    clearInterval(keepAlive);
  });

  workerInitializer.addSseClient(workerId, res);
};
router.get('/initialization/events', handleInitializationEvents);
router.get('/:id/initialization/events', handleInitializationEvents);

// POST /api/workers/initialize or /api/workers/:id/initialize
const handleInitializeWorker = async (req: Request, res: Response) => {
  const workerId = req.params.id || req.body?.workerId || 'kaggle-gpu-worker';
  const isRetry = Boolean(req.body?.isRetry || req.query?.retry);

  console.log(`[KAGGLE-WORKER][HTTP] Initialize request RECEIVED (workerId: ${workerId}, isRetry: ${isRetry})`);

  try {
    // Start or attach to initialization (non-blocking if long, returns current snapshot immediately, runs in background)
    const statusPromise = workerInitializer.initialize(workerId, isRetry);
    const currentStatus = workerInitializer.getStatus(workerId);
    res.json(currentStatus);
    console.log(`[KAGGLE-WORKER][HTTP] Initialization response SENT (state: ${currentStatus.state}, progress: ${currentStatus.progress}%)`);

    // Keep running in background
    statusPromise.catch((err) => {
      console.error('[WorkerInitializer] Background task error:', err);
    });
  } catch (err: any) {
    console.error(`[KAGGLE-WORKER][HTTP] Initialize request ERROR:`, err);
    res.status(500).json({ error: err.message || 'Failed to start initialization' });
  }
};
router.post('/initialize', handleInitializeWorker);
router.post('/:id/initialize', handleInitializeWorker);

// POST /api/workers/:id/retry
const handleRetryWorker = async (req: Request, res: Response) => {
  const workerId = req.params.id || req.body?.workerId || 'kaggle-gpu-worker';
  try {
    const statusPromise = workerInitializer.initialize(workerId, true);
    const currentStatus = workerInitializer.getStatus(workerId);
    res.json(currentStatus);

    statusPromise.catch((err) => {
      console.error('[WorkerInitializer] Background retry error:', err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retry initialization' });
  }
};
router.post('/retry', handleRetryWorker);
router.post('/:id/retry', handleRetryWorker);

// POST /api/workers/register - Register worker capabilities
router.post('/register', verifyWorkerAuth, (req: Request, res: Response) => {
  const payload: WorkerRegistrationPayload = req.body;
  if (!payload.workerId) {
    res.status(400).json({ error: 'workerId is required' });
    return;
  }

  const result = workerBridge.registerWorker(payload);
  res.json(result);
});

// GET /api/worker/status - Check GPU worker status
router.get('/status', (_req: Request, res: Response) => {
  res.json(workerBridge.getStatus());
});

// POST /api/worker/heartbeat - Kaggle GPU worker ping
router.post('/heartbeat', verifyWorkerAuth, (req: Request, res: Response) => {
  const { workerId, gpuName, vramTotalGb, vramUsedGb, activeJobId, hostname } = req.body;

  if (!workerId) {
    res.status(400).json({ error: 'workerId is required' });
    return;
  }

  const result = workerBridge.recordHeartbeat({
    workerId,
    gpuName,
    vramTotalGb,
    vramUsedGb,
    activeJobId,
    hostname,
  });

  res.json(result);
});

// POST /api/worker/poll - Worker polls to claim next available queued job
router.post('/poll', verifyWorkerAuth, (req: Request, res: Response) => {
  const { workerId } = req.body;
  if (!workerId) {
    res.status(400).json({ error: 'workerId is required' });
    return;
  }

  const job = workerBridge.claimNextJob(workerId);
  if (!job) {
    res.json({ job: null });
    return;
  }

  // Include voice profile details if voxcpm2
  let voiceProfile = null;
  if (job.selectedTtsEngine === 'voxcpm2' && job.voiceProfileId) {
    voiceProfile = jobStore.getVoiceProfile(job.voiceProfileId);
  }

  const keys = jobStore.getRawKeys();

  res.json({
    job,
    voiceProfile,
    apiKeys: {
      groqApiKey: keys.groqApiKey,
      geminiApiKey: keys.geminiApiKey,
    },
  });
});

// POST /api/worker/jobs/:id/progress - Update job progress
router.post('/jobs/:id/progress', verifyWorkerAuth, (req: Request, res: Response) => {
  const jobId = req.params.id;
  const payload: JobProgressUpdatePayload = req.body;

  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const updated = jobStore.updateJob(jobId, {
    currentStage: payload.stage,
    currentStageNumber: payload.stageNumber,
    progress: Math.min(100, Math.max(0, payload.progress)),
    segments: payload.segments || job.segments,
    recapSegments: payload.recapSegments || job.recapSegments,
    ttsChunks: payload.ttsChunks || job.ttsChunks,
    originalTranscript: payload.originalTranscript || job.originalTranscript,
    translatedScript: payload.translatedScript || job.translatedScript,
    title: payload.title || job.title,
    thumbnailUrl: payload.thumbnailUrl || job.thumbnailUrl,
    stageMessage: payload.stageMessage || payload.message || job.stageMessage,
    metrics: payload.metrics ? { ...job.metrics, ...payload.metrics } : job.metrics,
  });

  res.json(updated);
});

// POST /api/worker/jobs/:id/complete - Mark job completed
router.post('/jobs/:id/complete', verifyWorkerAuth, (req: Request, res: Response) => {
  const jobId = req.params.id;
  const { outputVideoPath, outputVideoUrl, segments, recapSegments, originalTranscript, translatedScript, metrics } = req.body;

  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const updated = jobStore.updateJob(jobId, {
    status: 'completed',
    currentStage: 'Completed',
    currentStageNumber: 10,
    progress: 100,
    outputVideoPath: outputVideoPath || job.outputVideoPath,
    outputVideoUrl: outputVideoUrl || job.outputVideoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    segments: segments || job.segments,
    recapSegments: recapSegments || job.recapSegments,
    originalTranscript: originalTranscript || job.originalTranscript,
    translatedScript: translatedScript || job.translatedScript,
    stageMessage: 'Recap pipeline execution completed successfully.',
    metrics: metrics ? { ...job.metrics, ...metrics } : job.metrics,
  });

  res.json(updated);
});

// POST /api/worker/jobs/:id/fail - Report structured error
router.post('/jobs/:id/fail', verifyWorkerAuth, (req: Request, res: Response) => {
  const jobId = req.params.id;
  const { stage, code, message, retryable, details } = req.body;

  const structuredError: StructuredError = {
    stage: stage || 'processing',
    code: code || 'WORKER_EXECUTION_ERROR',
    message: message || 'Unknown error occurred in worker',
    retryable: retryable !== undefined ? Boolean(retryable) : true,
    details,
  };

  const failed = jobStore.failJob(jobId, structuredError);
  if (!failed) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json(failed);
});

export default router;
