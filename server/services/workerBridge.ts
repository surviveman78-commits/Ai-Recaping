import {
  GpuWorkerStatus,
  GpuWorkerState,
  Job,
  WorkerCapabilities,
  WorkerRegistrationPayload,
} from '../../src/types/index.ts';
import { jobStore } from './jobStore.ts';

export function logQueueTransition(
  transition: 'JOB_CREATED' | 'QUEUED' | 'WORKER_AVAILABLE' | 'JOB_CLAIM_ATTEMPT' | 'JOB_CLAIMED' | 'WORKER_EXECUTION_STARTED' | 'DOWNLOAD_STARTED',
  jobId: string,
  workerId: string,
  jobStatus: string,
  workerStatus: string
) {
  const timestamp = new Date().toISOString();
  console.log(`[QUEUE-TRACE] [${timestamp}] [${transition}] job ID: ${jobId} | worker ID: ${workerId} | current job status: ${jobStatus} | current worker status: ${workerStatus}`);
}

interface WorkerRegistration {
  workerId: string;
  name?: string;
  status?: string;
  gpuName: string;
  vramTotalGb: number;
  vramUsedGb: number;
  activeJobId?: string;
  lastHeartbeat: number;
  hostname?: string;
  capabilities?: WorkerCapabilities;
}

class WorkerBridgeManager {
  private activeWorkers: Map<string, WorkerRegistration> = new Map();

  constructor() {
    // Periodic sweep to clean dead workers
    const sweepTimer = setInterval(() => this.cleanupStaleWorkers(), 10000);
    sweepTimer.unref();

    // Periodic queue polling trigger for registered workers
    const queueTimer = setInterval(() => this.triggerQueueProcessing(), 2000);
    queueTimer.unref();

    // Listen to job creation in jobStore
    jobStore.on('job-created', () => {
      this.triggerQueueProcessing();
    });
    jobStore.on('job-retried', () => {
      this.triggerQueueProcessing();
    });
  }

  public registerWorker(data: WorkerRegistrationPayload): { success: boolean; workerId: string } {
    this.activeWorkers.set(data.workerId, {
      workerId: data.workerId,
      name: data.name || 'Kaggle GPU Worker',
      status: data.status || 'ready',
      gpuName: data.gpuName || 'NVIDIA Tesla T4 (16GB)',
      vramTotalGb: data.vramTotalGb || 16,
      vramUsedGb: data.vramUsedGb || 1.2,
      activeJobId: data.currentJobId,
      lastHeartbeat: Date.now(),
      hostname: data.hostname || 'kaggle-session',
      capabilities: data.capabilities || {
        whisper: true,
        edgeTts: true,
        voxcpm2: true,
        ffmpeg: true,
        nvenc: false,
      },
    });

    logQueueTransition('WORKER_AVAILABLE', 'none', data.workerId, 'none', 'ready');
    this.triggerQueueProcessing();

    return { success: true, workerId: data.workerId };
  }

  public recordHeartbeat(data: {
    workerId: string;
    gpuName?: string;
    vramTotalGb?: number;
    vramUsedGb?: number;
    activeJobId?: string;
    hostname?: string;
  }): { success: boolean; activeWorkersCount: number } {
    const existing = this.activeWorkers.get(data.workerId);
    this.activeWorkers.set(data.workerId, {
      workerId: data.workerId,
      name: existing?.name || 'Kaggle GPU Worker',
      status: existing?.status || 'ready',
      gpuName: data.gpuName || existing?.gpuName || 'NVIDIA Tesla T4 (16GB)',
      vramTotalGb: data.vramTotalGb || existing?.vramTotalGb || 16,
      vramUsedGb: data.vramUsedGb || existing?.vramUsedGb || 2.4,
      activeJobId: data.activeJobId || existing?.activeJobId,
      lastHeartbeat: Date.now(),
      hostname: data.hostname || existing?.hostname || 'kaggle-session',
      capabilities: existing?.capabilities || {
        whisper: true,
        edgeTts: true,
        voxcpm2: true,
        ffmpeg: true,
        nvenc: false,
      },
    });

    // Check if queue has waiting jobs that can be claimed
    this.triggerQueueProcessing();

    return { success: true, activeWorkersCount: this.activeWorkers.size };
  }

  public getWorker(workerId: string): WorkerRegistration | undefined {
    return this.activeWorkers.get(workerId);
  }

  public getStatus(workerId?: string): GpuWorkerStatus {
    this.cleanupStaleWorkers();

    const queuedCount = jobStore.getAllJobs().filter((j) => j.status === 'queued').length;
    const processingJobs = jobStore.getAllJobs().filter((j) => j.status === 'processing');

    let primaryWorker = workerId ? this.activeWorkers.get(workerId) : undefined;
    if (!primaryWorker) {
      const workers = Array.from(this.activeWorkers.values()).sort((a, b) => b.lastHeartbeat - a.lastHeartbeat);
      primaryWorker = workers[0];
    }

    let state: GpuWorkerState = 'Worker Offline';

    if (primaryWorker) {
      if (processingJobs.length > 0) {
        state = queuedCount > 1 ? 'Queue Busy' : 'Processing';
      } else {
        state = queuedCount > 0 ? 'Queue Busy' : 'Worker Online';
      }

      return {
        state,
        workerId: primaryWorker.workerId,
        gpuName: primaryWorker.gpuName,
        vramTotalGb: primaryWorker.vramTotalGb,
        vramUsedGb: primaryWorker.vramUsedGb,
        lastHeartbeat: new Date(primaryWorker.lastHeartbeat).toISOString(),
        activeJobId: primaryWorker.activeJobId || processingJobs[0]?.id,
        queuedJobsCount: queuedCount,
        isOnline: true,
        capabilities: primaryWorker.capabilities,
      };
    }

    return {
      state: 'Worker Offline',
      queuedJobsCount: queuedCount,
      isOnline: false,
    };
  }

  private cleanupStaleWorkers() {
    const threshold = Date.now() - 35000; // 35 seconds timeout
    for (const [id, worker] of this.activeWorkers.entries()) {
      if (worker.lastHeartbeat < threshold) {
        this.activeWorkers.delete(id);
      }
    }
  }

  public claimNextJob(workerId: string): Job | null {
    const nextJob = jobStore.getNextQueuedJob();
    if (!nextJob) return null;

    const worker = this.activeWorkers.get(workerId);
    const workerStatus = worker ? (worker.activeJobId ? 'busy' : 'ready') : 'ready';

    logQueueTransition('JOB_CLAIM_ATTEMPT', nextJob.id, workerId, nextJob.status, workerStatus);

    const started = jobStore.updateJob(nextJob.id, {
      status: 'processing',
      startedAt: new Date().toISOString(),
      assignedWorkerId: workerId,
      currentStage: 'Downloading',
      currentStageNumber: 1,
      progress: 5,
    });

    if (worker) {
      worker.activeJobId = nextJob.id;
    }

    logQueueTransition('JOB_CLAIMED', nextJob.id, workerId, 'processing', 'processing');

    return started || null;
  }

  /**
   * Main Queue Dispatcher Loop:
   * Real GPU workers poll and claim queued jobs via /api/worker/poll.
   */
  public triggerQueueProcessing() {
    // Real GPU workers poll and claim queued jobs via /api/worker/poll.
  }

  public cancelJob(jobId: string) {
    for (const worker of this.activeWorkers.values()) {
      if (worker.activeJobId === jobId) {
        worker.activeJobId = undefined;
      }
    }
    jobStore.cancelJob(jobId);
  }
}

export const workerBridge = new WorkerBridgeManager();
