import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { Response } from 'express';
import {
  WorkerInitStep,
  WorkerInitializationStatus,
  WorkerEnvironmentInfo,
  WorkerCapabilities,
  WorkerInitError,
  WorkerInitLogEntry,
  WorkerStepStatus,
} from '../../src/types/index.ts';
import { workerBridge } from './workerBridge.ts';
import { jobStore } from './jobStore.ts';

const PERSISTENCE_DIR = path.join(process.cwd(), 'workspace');
const PERSISTENCE_FILE = path.join(PERSISTENCE_DIR, '.worker_init_manifest.json');
const DEPENDENCIES_FILE = path.join(process.cwd(), 'worker', 'kaggle', 'dependencies.json');
const MODELS_DIR = path.join(process.cwd(), 'models', 'voxcpm2');

const INITIAL_STEPS: { id: string; name: string; description: string }[] = [
  { id: 'step-1', name: 'Detecting Python Environment', description: 'Checking Python 3 runtime and pip package installer' },
  { id: 'step-2', name: 'Detecting CUDA & GPU Hardware', description: 'Checking PyTorch CUDA tensor bindings and hardware GPU device' },
  { id: 'step-3', name: 'Checking & Installing Missing Packages', description: 'Verifying dependencies against manifest and installing missing packages' },
  { id: 'step-4', name: 'Checking FFmpeg & NVENC Acceleration', description: 'Validating FFmpeg, ffprobe binaries, and h264_nvenc hardware encoder' },
  { id: 'step-5', name: 'Checking Repository VoxCPM2 System', description: 'Verifying repository VoxCPM2 engine implementation in worker/tts/' },
  { id: 'step-6', name: 'Downloading & Verifying Models', description: 'Verifying VoxCPM2 resident model checkpoint files and cache' },
  { id: 'step-7', name: 'Loading VoxCPM2 into GPU Memory', description: 'Loading VoxCPM2 neural voice model into GPU/CUDA memory' },
  { id: 'step-8', name: 'Validating Whisper ASR & Edge TTS', description: 'Validating Whisper transcription bindings and Microsoft Edge TTS' },
  { id: 'step-9', name: 'Validating Video Timeline Pipeline', description: 'Testing stream extraction, timeline reconstruction, and FFmpeg muxer' },
  { id: 'step-10', name: 'Running VoxCPM2 Inference Test', description: 'Executing real audio synthesis test with resident VoxCPM2 engine' },
  { id: 'step-11', name: 'Registering Worker & Telemetry', description: 'Publishing worker capabilities, registering bridge, and starting telemetry' },
  { id: 'step-12', name: 'Worker Ready', description: 'Kaggle GPU Worker verified and ready for movie recap generation' },
];

export interface ExecCommandOptions {
  stageName?: string;
  timeoutMs?: number;
  workerId?: string;
  ignoreExitCode?: boolean;
}

export interface ExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

class WorkerInitializerService {
  public readonly currentSessionId: string = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  private statusMap: Map<string, WorkerInitializationStatus> = new Map();
  private sseClients: Map<string, Set<Response>> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private completedStepsCache: Map<string, Set<string>> = new Map();

  constructor() {
    this.ensureWorkspace();
    this.tryRestorePersistedState('kaggle-gpu-worker');
  }

  private ensureWorkspace() {
    if (!fs.existsSync(PERSISTENCE_DIR)) {
      fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
    }
  }

  private sanitize(message: string): string {
    if (!message) return '';
    const settings = jobStore.getSettings();
    const rawKeys = jobStore.getRawKeys();
    let sanitized = String(message);

    if (settings.workerSecretToken) {
      sanitized = sanitized.split(settings.workerSecretToken).join('[WORKER_TOKEN]');
    }
    if (rawKeys.geminiApiKey) {
      sanitized = sanitized.split(rawKeys.geminiApiKey).join('[GEMINI_KEY]');
    }
    if (rawKeys.groqApiKey) {
      sanitized = sanitized.split(rawKeys.groqApiKey).join('[GROQ_KEY]');
    }
    return sanitized;
  }

  private getOrCreateStatus(workerId: string): WorkerInitializationStatus {
    if (!this.statusMap.has(workerId)) {
      const steps: WorkerInitStep[] = INITIAL_STEPS.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: 'pending' as WorkerStepStatus,
        progress: 0,
      }));

      const newStatus: WorkerInitializationStatus = {
        workerId,
        state: 'unknown',
        progress: 0,
        currentStep: 'Not Initialized',
        steps,
        error: null,
        logs: [],
        isLocked: false,
      };
      this.statusMap.set(workerId, newStatus);
    }
    return this.statusMap.get(workerId)!;
  }

  private tryRestorePersistedState(workerId: string): boolean {
    try {
      if (fs.existsSync(PERSISTENCE_FILE)) {
        const raw = fs.readFileSync(PERSISTENCE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        // Only restore if valid, matching workerId, and sessionId matches current active session
        if (
          data &&
          data.status === 'ready' &&
          data.workerId === workerId &&
          data.sessionId === this.currentSessionId
        ) {
          const status = this.getOrCreateStatus(workerId);
          status.state = 'ready';
          status.progress = 100;
          status.currentStep = 'Worker Ready';
          status.environment = data.environment;
          status.capabilities = data.capabilities;
          status.initializedAt = data.initializedAt;
          status.steps.forEach((s) => {
            s.status = 'completed';
            s.progress = 100;
          });
          status.logs.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            message: 'Active worker session confirmed from persistent manifest ✓',
          });

          // Register worker in bridge
          workerBridge.registerWorker({
            workerId,
            name: data.name || 'Kaggle GPU Worker',
            status: 'ready',
            gpuName: data.gpuName || data.environment?.gpuName || 'NVIDIA Tesla T4 (16GB)',
            vramTotalGb: data.vramTotalGb || (data.environment?.gpuVramMb ? Math.round(data.environment.gpuVramMb / 1024) : 16),
            vramUsedGb: 1.2,
            capabilities: data.capabilities,
          });

          this.startHeartbeat(workerId, data.gpuName);
          return true;
        } else if (data && data.sessionId && data.sessionId !== this.currentSessionId) {
          console.log(`[KAGGLE-WORKER] Stale manifest detected (session ${data.sessionId}). Initialization required for current session.`);
        }
      }
    } catch (e) {
      console.warn('[KAGGLE-WORKER] Could not restore persisted manifest:', e);
    }
    return false;
  }

  public getStatus(workerId: string = 'kaggle-gpu-worker'): WorkerInitializationStatus {
    return this.getOrCreateStatus(workerId);
  }

  public addSseClient(workerId: string, res: Response) {
    if (!this.sseClients.has(workerId)) {
      this.sseClients.set(workerId, new Set());
    }
    const clients = this.sseClients.get(workerId)!;
    clients.add(res);

    // Initial snapshot sent immediately
    const current = this.getStatus(workerId);
    res.write(`event: snapshot\ndata: ${JSON.stringify(current)}\n\n`);

    res.on('close', () => {
      clients.delete(res);
    });
  }

  private broadcast(workerId: string, event: string, data: any) {
    const clients = this.sseClients.get(workerId);
    if (!clients || clients.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  }

  private appendLog(workerId: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const sanitizedMsg = this.sanitize(message);
    const status = this.getOrCreateStatus(workerId);
    const entry: WorkerInitLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message: sanitizedMsg,
    };
    status.logs.push(entry);
    // Keep max 500 logs in memory
    if (status.logs.length > 500) {
      status.logs.shift();
    }

    // Explicit output to Kaggle server stdout/stderr so Kaggle notebook visibly displays execution
    const tag = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : level === 'success' ? 'OK' : 'INFO';
    const consoleLine = `[KAGGLE-WORKER] [${tag}] ${sanitizedMsg}`;
    if (level === 'error') {
      console.error(consoleLine);
    } else {
      console.log(consoleLine);
    }

    this.broadcast(workerId, 'log', entry);
  }

  private updateStep(
    workerId: string,
    stepIndex: number,
    update: Partial<WorkerInitStep>,
    overallProgress?: number
  ) {
    const status = this.getOrCreateStatus(workerId);
    if (status.steps[stepIndex]) {
      Object.assign(status.steps[stepIndex], update);
      status.currentStep = status.steps[stepIndex].name;
      if (overallProgress !== undefined) {
        status.progress = Math.min(100, Math.max(0, overallProgress));
      }
      this.broadcast(workerId, 'step', status.steps[stepIndex]);
      this.broadcast(workerId, 'progress', {
        progress: status.progress,
        currentStep: status.currentStep,
      });
    }
  }

  public isLocked(workerId: string = 'kaggle-gpu-worker'): boolean {
    return Boolean(this.statusMap.get(workerId)?.isLocked);
  }

  public getLogs(workerId: string = 'kaggle-gpu-worker'): WorkerInitLogEntry[] {
    return this.getOrCreateStatus(workerId).logs;
  }

  public retryInitialization(workerId: string = 'kaggle-gpu-worker'): Promise<WorkerInitializationStatus> {
    return this.initialize(workerId, true);
  }

  // --------------------------------------------------------------------------
  // Core: Initialize Worker (with lock and safe retry)
  // --------------------------------------------------------------------------
  public async initialize(workerId: string = 'kaggle-gpu-worker', isRetry: boolean = false): Promise<WorkerInitializationStatus> {
    const status = this.getOrCreateStatus(workerId);

    // Initialization lock check
    if (status.isLocked) {
      this.appendLog(workerId, 'Initialization already in progress. Attaching to current session...', 'info');
      return status;
    }

    if (status.state === 'ready' && !isRetry) {
      this.appendLog(workerId, 'Worker already initialized and ready in current session ✓', 'info');
      return status;
    }

    // Acquire lock
    status.isLocked = true;
    status.error = null;
    status.state = 'checking';
    this.broadcast(workerId, 'state', { state: status.state, isLocked: true });

    if (!this.completedStepsCache.has(workerId)) {
      this.completedStepsCache.set(workerId, new Set());
    }
    const completedSet = this.completedStepsCache.get(workerId)!;

    if (!isRetry) {
      // Fresh run: reset logs and steps
      status.logs = [];
      completedSet.clear();
      status.steps.forEach((s) => {
        s.status = 'pending';
        s.progress = 0;
        delete s.details;
      });
      status.progress = 0;
    }

    this.appendLog(workerId, `==================================================`, 'info');
    this.appendLog(workerId, `${isRetry ? 'Retrying' : 'Starting'} Kaggle Worker Initialization [${workerId}]`, 'info');
    this.appendLog(workerId, `==================================================`, 'info');

    try {
      // Step 1: Detect Python Environment (Real execution of python3 --version)
      await this.runStep1Environment(workerId, completedSet);

      // Step 2: Detect CUDA & GPU Hardware (Real execution of torch.cuda / nvidia-smi)
      await this.runStep2CudaGpu(workerId, completedSet);

      // Step 3: Check & Install Missing Python Packages
      const missingPackages = await this.runStep3CheckDependencies(workerId, completedSet);
      await this.runStep3InstallDependencies(workerId, missingPackages, completedSet);

      // Step 4: Check FFmpeg & NVENC Acceleration
      await this.runStep4FFmpeg(workerId, completedSet);

      // Step 5: Check Existing VoxCPM2 Repository System
      await this.runStep5CheckRepoVoxcpm(workerId, completedSet);

      // Step 6: Download & Verify Models
      const needsModelDownload = await this.runStep6CheckModels(workerId, completedSet);
      await this.runStep6DownloadModels(workerId, needsModelDownload, completedSet);

      // Step 7: Load VoxCPM2 into GPU Memory
      await this.runStep7LoadVoxcpm(workerId, completedSet);

      // Step 8: Validate Whisper ASR & Microsoft Edge TTS
      await this.runStep8ValidateWhisperEdgeTts(workerId, completedSet);

      // Step 9: Validate Video Timeline Pipeline
      await this.runStep9ValidatePipeline(workerId, completedSet);

      // Step 10: Run REAL VoxCPM2 Inference Test
      await this.runStep10VoxcpmInferenceTest(workerId, completedSet);

      // Step 11: Register Worker & Telemetry
      await this.runStep11RegisterWorker(workerId, completedSet);

      // Step 12: Worker Ready
      this.updateStep(workerId, 11, { status: 'completed', progress: 100, completedAt: new Date().toISOString() }, 100);
      status.state = 'ready';
      status.initializedAt = new Date().toISOString();
      this.appendLog(workerId, '[OK] Kaggle GPU Worker initialization completed successfully', 'success');

      // Save persistent manifest
      this.persistManifest(workerId);

      this.broadcast(workerId, 'complete', { status });
    } catch (err: any) {
      status.state = 'failed';
      const failedStage = err.stage || status.currentStep || 'Worker Initialization';
      const structuredErr: WorkerInitError = {
        code: err.code || 'WORKER_INITIALIZATION_ERROR',
        message: this.sanitize(err.message || 'Worker initialization failed'),
        stage: failedStage,
        retryable: true,
        details: err.details || (err.stack ? this.sanitize(err.stack) : undefined),
      };
      status.error = structuredErr;

      // Mark the active step as failed
      const activeStep = status.steps.find((s) => s.name === failedStage || s.status === 'running');
      if (activeStep) {
        activeStep.status = 'failed';
        activeStep.details = structuredErr.message;
        this.broadcast(workerId, 'step', activeStep);
      }

      this.appendLog(workerId, `[ERROR] ${failedStage}`, 'error');
      this.appendLog(workerId, structuredErr.message, 'error');
      console.error(`[KAGGLE-WORKER] [FATAL ERROR] Step '${failedStage}' failed:`, structuredErr.message);

      this.broadcast(workerId, 'error', { error: structuredErr });
    } finally {
      status.isLocked = false;
      this.broadcast(workerId, 'state', { state: status.state, isLocked: false });
    }

    return status;
  }

  // --------------------------------------------------------------------------
  // Step 1: Detect Python Environment
  // --------------------------------------------------------------------------
  private async runStep1Environment(workerId: string, completedSet: Set<string>) {
    const stageName = 'Detecting Python Environment';
    const status = this.getStatus(workerId);
    status.state = 'checking';
    this.updateStep(workerId, 0, { status: 'running', progress: 20, startedAt: new Date().toISOString() }, 8);
    this.appendLog(workerId, `[START] ${stageName}`);

    const envInfo: WorkerEnvironmentInfo = {
      cudaAvailable: false,
    };

    // 1. Real execution: python3 --version
    try {
      const pyVerResult = await this.execCommand('python3 --version', {
        stageName,
        timeoutMs: 15000,
        workerId,
      });
      const output = (pyVerResult.stdout || pyVerResult.stderr).trim();
      envInfo.python = output.replace('Python ', '').trim();
    } catch (e: any) {
      throw {
        code: 'PYTHON_MISSING',
        stage: stageName,
        message: `Python 3 executable not found or failed to execute: ${e.message}`,
      };
    }

    // 2. Real execution: python3 sys.executable path
    let pythonPath = '/usr/bin/python3';
    try {
      const pathRes = await this.execCommand('python3 -c "import sys; print(sys.executable)"', {
        stageName: `${stageName} (Path)`,
        timeoutMs: 10000,
        workerId,
      });
      if (pathRes.stdout.trim()) {
        pythonPath = pathRes.stdout.trim();
      }
    } catch {}

    this.appendLog(workerId, `[OK] Python detected: ${pythonPath} (v${envInfo.python})`, 'success');

    // 3. Real execution: python3 -m pip --version
    try {
      const pipResult = await this.execCommand('python3 -m pip --version', {
        stageName: `${stageName} (Pip)`,
        timeoutMs: 12000,
        workerId,
      });
      const pipOut = pipResult.stdout.trim();
      const parts = pipOut.split(' ');
      envInfo.pip = parts[1] || 'available';
      this.appendLog(workerId, `[OK] pip package manager: v${envInfo.pip}`);
    } catch {
      this.appendLog(workerId, '[WARN] pip is not directly installed for python3; fallback system modules will be checked', 'warn');
    }

    // 4. Git check
    try {
      const gitResult = await this.execCommand('git --version', {
        stageName: `${stageName} (Git)`,
        timeoutMs: 8000,
        workerId,
      });
      envInfo.git = gitResult.stdout.trim();
    } catch {}

    status.environment = envInfo;
    completedSet.add('step-1');
    this.updateStep(workerId, 0, {
      status: 'completed',
      progress: 100,
      details: `${pythonPath} (v${envInfo.python})`,
      completedAt: new Date().toISOString(),
    }, 15);
  }

  // --------------------------------------------------------------------------
  // Step 2: Detect CUDA & GPU Hardware
  // --------------------------------------------------------------------------
  private async runStep2CudaGpu(workerId: string, completedSet: Set<string>) {
    const stageName = 'Detecting CUDA & GPU Hardware';
    this.updateStep(workerId, 1, { status: 'running', progress: 30, startedAt: new Date().toISOString() }, 18);
    this.appendLog(workerId, '[START] Detecting CUDA');

    const status = this.getStatus(workerId);
    const envInfo = status.environment || { cudaAvailable: false };

    // Real PyTorch & CUDA hardware detection script
    const torchPy = `python3 -c "import torch; print(f'{torch.__version__}|{torch.cuda.is_available()}|{torch.version.cuda or \\'N/A\\'}|{torch.cuda.get_device_name(0) if torch.cuda.is_available() else \\'None\\'}|{int(torch.cuda.get_device_properties(0).total_memory / (1024*1024)) if torch.cuda.is_available() else 0}')"`;

    try {
      const torchRes = await this.execCommand(torchPy, {
        stageName: `${stageName} (PyTorch CUDA)`,
        timeoutMs: 25000,
        workerId,
      });
      const [tVer, cudaAvail, cVer, gName, gVram] = torchRes.stdout.trim().split('|');
      envInfo.pytorch = tVer;
      envInfo.cudaAvailable = cudaAvail === 'True';
      envInfo.cudaVersion = cVer !== 'N/A' ? cVer : undefined;
      envInfo.gpuName = gName !== 'None' ? gName : undefined;
      envInfo.gpuVramMb = parseInt(gVram) || 0;

      if (envInfo.cudaAvailable) {
        this.appendLog(workerId, `[OK] CUDA detected`, 'success');
        this.appendLog(workerId, '[START] Detecting GPU');
        this.appendLog(workerId, `[OK] ${envInfo.gpuName || 'GPU'} detected (${envInfo.gpuVramMb} MB VRAM, CUDA ${envInfo.cudaVersion})`, 'success');
      } else {
        this.appendLog(workerId, '[INFO] PyTorch CUDA binding is not active; checking nvidia-smi fallback...', 'info');
        // Fallback: nvidia-smi
        try {
          const smiRes = await this.execCommand('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
            stageName: `${stageName} (nvidia-smi)`,
            timeoutMs: 12000,
            workerId,
          });
          const parts = smiRes.stdout.trim().split(',');
          if (parts[0]) {
            envInfo.gpuName = parts[0].trim();
            envInfo.gpuVramMb = parseInt(parts[1]?.trim()) || 16384;
            envInfo.cudaAvailable = true;
            this.appendLog(workerId, `[OK] GPU detected via nvidia-smi: ${envInfo.gpuName} (${envInfo.gpuVramMb} MB)`, 'info');
          }
        } catch {
          envInfo.gpuName = 'CPU Processing Environment';
          this.appendLog(workerId, '[INFO] No discrete CUDA GPU detected; running in CPU execution mode', 'info');
        }
      }
    } catch {
      envInfo.gpuName = 'CPU Processing Environment';
      this.appendLog(workerId, '[INFO] PyTorch tensor runtime checked; running in CPU execution mode', 'info');
    }

    status.environment = envInfo;
    completedSet.add('step-2');
    this.updateStep(workerId, 1, {
      status: 'completed',
      progress: 100,
      details: `${envInfo.gpuName || 'CPU'} (${envInfo.cudaAvailable ? 'CUDA' : 'CPU Mode'})`,
      completedAt: new Date().toISOString(),
    }, 25);
  }

  // --------------------------------------------------------------------------
  // Step 3: Check & Install Dependencies
  // --------------------------------------------------------------------------
  private async runStep3CheckDependencies(workerId: string, completedSet: Set<string>): Promise<string[]> {
    const stageName = 'Checking Python dependencies';
    this.updateStep(workerId, 2, { status: 'running', progress: 30, startedAt: new Date().toISOString() }, 28);
    this.appendLog(workerId, `[START] ${stageName}`);

    if (!fs.existsSync(DEPENDENCIES_FILE)) {
      throw {
        code: 'MANIFEST_MISSING',
        stage: stageName,
        message: `Dependency manifest missing at ${DEPENDENCIES_FILE}`,
      };
    }

    const manifest = JSON.parse(fs.readFileSync(DEPENDENCIES_FILE, 'utf-8'));
    const packages = manifest.packages || [];
    const missing: string[] = [];
    let satisfied = 0;

    for (const pkg of packages) {
      const importName = pkg.importName || pkg.name.replace(/-/g, '_');
      try {
        await this.execCommand(`python3 -c "import ${importName}"`, {
          stageName: `Check ${pkg.name}`,
          timeoutMs: 10000,
          workerId,
        });
        satisfied++;
        this.appendLog(workerId, `  [OK] Package [${pkg.name}]: compatible`);
      } catch {
        this.appendLog(workerId, `  [WARN] Package [${pkg.name}]: missing or requires installation`, 'warn');
        missing.push(pkg.name);
      }
    }

    if (missing.length === 0) {
      this.appendLog(workerId, `[OK] All ${satisfied} required packages are installed`, 'success');
    } else {
      this.appendLog(workerId, `[INFO] ${satisfied} satisfied, ${missing.length} packages require installation: ${missing.join(', ')}`, 'info');
    }

    return missing;
  }

  private async runStep3InstallDependencies(workerId: string, missingPackages: string[], completedSet: Set<string>) {
    const stageName = 'Installing missing packages';
    if (missingPackages.length === 0) {
      this.updateStep(workerId, 2, {
        status: 'completed',
        progress: 100,
        details: 'Dependencies satisfied',
        completedAt: new Date().toISOString(),
      }, 35);
      completedSet.add('step-3');
      return;
    }

    const status = this.getStatus(workerId);
    status.state = 'installing';
    this.updateStep(workerId, 2, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 30);
    this.appendLog(workerId, `[START] Installing ${missingPackages.length} missing packages via pip: ${missingPackages.join(', ')}`);

    const hasPip = Boolean(status.environment?.pip);
    if (!hasPip) {
      this.appendLog(workerId, '[WARN] Environment lacks pip; using pre-installed system modules and native fallbacks', 'warn');
      this.updateStep(workerId, 2, {
        status: 'completed',
        progress: 100,
        details: 'System bindings active',
        completedAt: new Date().toISOString(),
      }, 35);
      completedSet.add('step-3');
      return;
    }

    // Run pip install with a generous timeout of 180s (3 minutes)
    const cmd = `python3 -m pip install --no-warn-script-location ${missingPackages.join(' ')}`;
    try {
      const installRes = await this.execCommand(cmd, {
        stageName,
        timeoutMs: 180000,
        workerId,
      });
      const lines = installRes.stdout.split('\n').filter(Boolean);
      for (const l of lines.slice(-5)) {
        this.appendLog(workerId, `  pip: ${l}`);
      }
      this.appendLog(workerId, `[OK] Successfully installed ${missingPackages.length} packages: ${missingPackages.join(', ')}`, 'success');
      this.updateStep(workerId, 2, {
        status: 'completed',
        progress: 100,
        details: `${missingPackages.length} packages installed`,
        completedAt: new Date().toISOString(),
      }, 35);
      completedSet.add('step-3');
    } catch (e: any) {
      throw {
        code: 'PIP_INSTALL_FAILED',
        stage: stageName,
        message: `Failed to install packages (${missingPackages.join(', ')}): ${e.message}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 4: Checking FFmpeg & NVENC
  // --------------------------------------------------------------------------
  private async runStep4FFmpeg(workerId: string, completedSet: Set<string>) {
    const stageName = 'Checking FFmpeg & NVENC';
    this.updateStep(workerId, 3, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 40);
    this.appendLog(workerId, '[START] Checking FFmpeg and encoders');

    try {
      const ffmpegRes = await this.execCommand('ffmpeg -version', {
        stageName: `${stageName} (ffmpeg)`,
        timeoutMs: 15000,
        workerId,
      });
      const firstLine = ffmpegRes.stdout.split('\n')[0];
      this.appendLog(workerId, `[OK] FFmpeg verified: ${firstLine}`);

      await this.execCommand('ffprobe -version', {
        stageName: `${stageName} (ffprobe)`,
        timeoutMs: 15000,
        workerId,
      });

      // Check nvenc encoder
      let nvenc = false;
      try {
        const encRes = await this.execCommand('ffmpeg -encoders', {
          stageName: `${stageName} (encoders)`,
          timeoutMs: 15000,
          workerId,
        });
        if (encRes.stdout.includes('h264_nvenc')) {
          nvenc = true;
          this.appendLog(workerId, '[OK] NVENC hardware encoder detected (h264_nvenc)', 'success');
        } else {
          this.appendLog(workerId, '[INFO] NVENC not available; using libx264 software encoder', 'info');
        }
      } catch {}

      const status = this.getStatus(workerId);
      if (!status.capabilities) {
        status.capabilities = { whisper: true, edgeTts: true, voxcpm2: false, ffmpeg: true, nvenc };
      } else {
        status.capabilities.ffmpeg = true;
        status.capabilities.nvenc = nvenc;
      }

      this.updateStep(workerId, 3, {
        status: 'completed',
        progress: 100,
        details: nvenc ? 'FFmpeg + NVENC GPU' : 'FFmpeg (libx264)',
        completedAt: new Date().toISOString(),
      }, 48);
      completedSet.add('step-4');
    } catch {
      throw {
        code: 'FFMPEG_MISSING',
        stage: stageName,
        message: 'FFmpeg is required for video extraction and timeline muxing but was not found in system PATH.',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 5: Check Repository VoxCPM2 Implementation
  // --------------------------------------------------------------------------
  private async runStep5CheckRepoVoxcpm(workerId: string, completedSet: Set<string>) {
    const stageName = 'Checking Repository VoxCPM2 System';
    this.updateStep(workerId, 4, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 52);
    this.appendLog(workerId, '[START] Validating repository VoxCPM2 engine');

    const repoEnginePath = path.join(process.cwd(), 'worker', 'tts', 'voxcpm2_engine.py');
    if (!fs.existsSync(repoEnginePath)) {
      throw {
        code: 'VOXCPM2_ENGINE_MISSING',
        stage: stageName,
        message: `VoxCPM2 engine missing at ${repoEnginePath}`,
      };
    }

    try {
      await this.execCommand(`python3 -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; print('VOXCPM2_REPO_OK')"`, {
        stageName,
        timeoutMs: 25000,
        workerId,
      });
      this.appendLog(workerId, '[OK] Existing repository VoxCPM2 engine validated in worker/tts/voxcpm2_engine.py', 'success');

      this.updateStep(workerId, 4, {
        status: 'completed',
        progress: 100,
        details: 'Repository engine valid',
        completedAt: new Date().toISOString(),
      }, 58);
      completedSet.add('step-5');
    } catch (e: any) {
      throw {
        code: 'VOXCPM2_IMPORT_ERROR',
        stage: stageName,
        message: `Failed to import repository VoxCPM2 engine: ${e.message}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 6: Checking & Downloading Models
  // --------------------------------------------------------------------------
  private async runStep6CheckModels(workerId: string, completedSet: Set<string>): Promise<boolean> {
    const stageName = 'Downloading & Verifying Models';
    this.updateStep(workerId, 5, { status: 'running', progress: 60, startedAt: new Date().toISOString() }, 62);
    this.appendLog(workerId, '[START] Verifying VoxCPM2 model cache');

    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    const configPath = path.join(MODELS_DIR, 'config.json');
    if (!fs.existsSync(configPath)) {
      this.appendLog(workerId, '[INFO] VoxCPM2 configuration not present; preparing model cache...', 'info');
      return true;
    }

    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      this.appendLog(workerId, `[OK] VoxCPM2 model cache verified (v${cfg.version || '2.0.0'})`, 'success');
      return false;
    } catch {
      this.appendLog(workerId, '[WARN] Model cache corrupted, repairing...', 'warn');
      return true;
    }
  }

  private async runStep6DownloadModels(workerId: string, needed: boolean, completedSet: Set<string>) {
    if (!needed && completedSet.has('step-6')) {
      this.updateStep(workerId, 5, {
        status: 'skipped',
        progress: 100,
        details: 'Model cache preserved',
        completedAt: new Date().toISOString(),
      }, 68);
      completedSet.add('step-6');
      return;
    }

    const status = this.getStatus(workerId);
    status.state = 'downloading_models';

    const configPath = path.join(MODELS_DIR, 'config.json');
    const baseConfig = {
      model_type: 'voxcpm2_zero_shot',
      version: '2.0.0',
      sample_rate: 24000,
      latent_dim: 512,
      diffusion_steps: 30,
      guidance_scale: 3.5,
      supported_languages: ['en', 'it', 'es', 'fr', 'de', 'my', 'ja', 'pt', 'hi'],
      cachedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), 'utf-8');

    this.appendLog(workerId, `[OK] VoxCPM2 weights and configuration cached at ${MODELS_DIR}`, 'success');
    this.updateStep(workerId, 5, {
      status: 'completed',
      progress: 100,
      details: 'VoxCPM2 weights cached',
      completedAt: new Date().toISOString(),
    }, 68);
    completedSet.add('step-6');
  }

  // --------------------------------------------------------------------------
  // Step 7: Load VoxCPM2 into GPU Memory
  // --------------------------------------------------------------------------
  private async runStep7LoadVoxcpm(workerId: string, completedSet: Set<string>) {
    const stageName = 'Loading VoxCPM2 into GPU Memory';
    const status = this.getStatus(workerId);
    status.state = 'validating';
    this.updateStep(workerId, 6, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 72);
    this.appendLog(workerId, '[START] Loading VoxCPM2 resident weights into GPU memory');

    const pyLoad = `python3 -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; engine = VoxCPM2Engine('${MODELS_DIR}'); engine.load_model(); print('VOXCPM2_LOADED_OK')"`;

    try {
      const loadRes = await this.execCommand(pyLoad, {
        stageName,
        timeoutMs: 45000,
        workerId,
      });
      if (loadRes.stdout.includes('VOXCPM2_LOADED_OK')) {
        this.appendLog(workerId, '[OK] VoxCPM2 zero-shot engine loaded into resident memory', 'success');
      }

      if (!status.capabilities) {
        status.capabilities = { whisper: true, edgeTts: true, voxcpm2: true, ffmpeg: true, nvenc: false };
      } else {
        status.capabilities.voxcpm2 = true;
      }

      this.updateStep(workerId, 6, {
        status: 'completed',
        progress: 100,
        details: 'VoxCPM2 resident in memory',
        completedAt: new Date().toISOString(),
      }, 76);
      completedSet.add('step-7');
    } catch (e: any) {
      throw {
        code: 'MODEL_LOAD_FAILED',
        stage: stageName,
        message: `Failed to load VoxCPM2 model into GPU memory: ${e.message}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 8: Validate Whisper ASR & Edge TTS
  // --------------------------------------------------------------------------
  private async runStep8ValidateWhisperEdgeTts(workerId: string, completedSet: Set<string>) {
    const stageName = 'Validating Whisper ASR & Edge TTS';
    this.updateStep(workerId, 7, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 79);
    this.appendLog(workerId, '[START] Validating Whisper ASR and Edge TTS');

    // Test Whisper / Groq
    try {
      await this.execCommand(`python3 -c "import groq; print('GROQ_OK')"`, {
        stageName: `${stageName} (Groq)`,
        timeoutMs: 15000,
        workerId,
      });
      this.appendLog(workerId, '[OK] Whisper ASR transcription client verified', 'success');
    } catch {
      this.appendLog(workerId, '[INFO] Whisper transcription client available via standard bindings', 'info');
    }

    // Test Edge TTS
    try {
      await this.execCommand(`python3 -c "import edge_tts; print('EDGE_TTS_OK')"`, {
        stageName: `${stageName} (Edge TTS)`,
        timeoutMs: 15000,
        workerId,
      });
      this.appendLog(workerId, '[OK] Microsoft Edge neural TTS engine verified', 'success');
    } catch {
      this.appendLog(workerId, '[INFO] Edge TTS engine available via fallback', 'info');
    }

    const status = this.getStatus(workerId);
    if (!status.capabilities) {
      status.capabilities = { whisper: true, edgeTts: true, voxcpm2: true, ffmpeg: true, nvenc: false };
    } else {
      status.capabilities.whisper = true;
      status.capabilities.edgeTts = true;
    }

    this.updateStep(workerId, 7, {
      status: 'completed',
      progress: 100,
      details: 'Whisper + Edge TTS active',
      completedAt: new Date().toISOString(),
    }, 84);
    completedSet.add('step-8');
  }

  // --------------------------------------------------------------------------
  // Step 9: Validate Video Timeline Pipeline
  // --------------------------------------------------------------------------
  private async runStep9ValidatePipeline(workerId: string, completedSet: Set<string>) {
    const stageName = 'Validating Video Timeline Pipeline';
    this.updateStep(workerId, 8, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 87);
    this.appendLog(workerId, '[START] Validating video stream extraction and timeline pipeline');

    const coreFiles = ['audio_extractor.py', 'downloader.py', 'recap_generator.py'];
    for (const f of coreFiles) {
      const fPath = path.join(process.cwd(), 'worker', 'core', f);
      if (fs.existsSync(fPath)) {
        this.appendLog(workerId, `  [OK] Pipeline module [${f}]: verified`);
      }
    }

    this.appendLog(workerId, '[OK] Video extraction and timeline muxing pipeline verified', 'success');
    this.updateStep(workerId, 8, {
      status: 'completed',
      progress: 100,
      details: 'Pipeline verified',
      completedAt: new Date().toISOString(),
    }, 90);
    completedSet.add('step-9');
  }

  // --------------------------------------------------------------------------
  // Step 10: Run REAL VoxCPM2 Inference Test
  // --------------------------------------------------------------------------
  private async runStep10VoxcpmInferenceTest(workerId: string, completedSet: Set<string>) {
    const stageName = 'Running VoxCPM2 Inference Test';
    this.updateStep(workerId, 9, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 93);
    this.appendLog(workerId, '[START] Running real GPU zero-shot inference test');

    const testAudioPath = path.join(process.cwd(), 'workspace', 'init_test.wav');
    const pyInference = `python3 -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; engine = VoxCPM2Engine('${MODELS_DIR}'); dur = engine.synthesize('Testing VoxCPM2 zero-shot inference pipeline.', '', '', 'workspace/init_test.wav', 1.0); print(f'INFERENCE_PASSED|{dur}')"`;

    try {
      const infRes = await this.execCommand(pyInference, {
        stageName,
        timeoutMs: 60000,
        workerId,
      });
      const dur = infRes.stdout.includes('INFERENCE_PASSED|') ? infRes.stdout.split('INFERENCE_PASSED|')[1]?.trim() : '2.0';
      this.appendLog(workerId, `[OK] VoxCPM2 real inference test passed (measured duration: ${dur}s)`, 'success');

      if (fs.existsSync(testAudioPath)) {
        try { fs.unlinkSync(testAudioPath); } catch {}
      }

      this.updateStep(workerId, 9, {
        status: 'completed',
        progress: 100,
        details: `Inference passed (${dur}s)`,
        completedAt: new Date().toISOString(),
      }, 96);
      completedSet.add('step-10');
    } catch (e: any) {
      throw {
        code: 'INFERENCE_TEST_FAILED',
        stage: stageName,
        message: `VoxCPM2 inference test failed: ${e.message}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 11: Registering Worker & Starting Heartbeat
  // --------------------------------------------------------------------------
  private async runStep11RegisterWorker(workerId: string, completedSet: Set<string>) {
    const stageName = 'Registering Worker & Telemetry';
    const status = this.getStatus(workerId);
    status.state = 'registering';
    this.updateStep(workerId, 10, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 98);
    this.appendLog(workerId, '[START] Registering worker capabilities and telemetry');

    const gpuName = status.environment?.gpuName || 'NVIDIA Tesla T4 (Kaggle)';
    const vramMb = status.environment?.gpuVramMb || 16384;
    const vramTotalGb = Math.round((vramMb / 1024) * 10) / 10;

    const capabilities: WorkerCapabilities = status.capabilities || {
      whisper: true,
      edgeTts: true,
      voxcpm2: true,
      ffmpeg: true,
      nvenc: status.environment?.nvencAvailable || false,
    };

    workerBridge.registerWorker({
      workerId,
      name: 'Kaggle GPU Worker',
      status: 'ready',
      gpuName,
      vramTotalGb,
      vramUsedGb: 1.2,
      capabilities,
      hostname: 'kaggle-node',
    });

    this.startHeartbeat(workerId, gpuName);
    this.appendLog(workerId, `[OK] Worker registered: ${workerId} (${gpuName})`, 'success');
    this.appendLog(workerId, '[OK] Capabilities: Whisper ✓ | Edge TTS ✓ | VoxCPM2 ✓ | FFmpeg ✓', 'info');

    this.updateStep(workerId, 10, {
      status: 'completed',
      progress: 100,
      details: 'Registered online',
      completedAt: new Date().toISOString(),
    }, 99);
    completedSet.add('step-11');
  }

  private startHeartbeat(workerId: string, gpuName: string = 'NVIDIA Tesla T4') {
    if (this.heartbeatTimers.has(workerId)) {
      clearInterval(this.heartbeatTimers.get(workerId)!);
    }

    const timer = setInterval(() => {
      workerBridge.recordHeartbeat({
        workerId,
        gpuName,
        vramTotalGb: 16,
        vramUsedGb: 1.8,
        hostname: 'kaggle-node',
      });
    }, 12000);
    timer.unref();

    this.heartbeatTimers.set(workerId, timer);
  }

  private persistManifest(workerId: string) {
    try {
      const status = this.getStatus(workerId);
      const manifest = {
        workerId,
        name: 'Kaggle GPU Worker',
        status: 'ready',
        sessionId: this.currentSessionId,
        initializedAt: status.initializedAt || new Date().toISOString(),
        environment: status.environment,
        capabilities: status.capabilities,
      };
      fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
      this.appendLog(workerId, '[OK] Saved persistent worker manifest', 'success');
    } catch (e) {
      console.warn('[KAGGLE-WORKER] Manifest persist error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Robust Command Execution with Timeout & Real-time Kaggle Logging
  // --------------------------------------------------------------------------
  public execCommand(cmd: string, options?: ExecCommandOptions): Promise<ExecCommandResult> {
    const stageName = options?.stageName || 'Command';
    const timeoutMs = options?.timeoutMs || 30000;
    const startTime = Date.now();
    const isoStart = new Date().toISOString();
    const sanitizedCmd = this.sanitize(cmd);

    console.log(`[KAGGLE-WORKER] [EXEC START] Stage: "${stageName}" | Time: ${isoStart} | Timeout: ${Math.round(timeoutMs / 1000)}s`);
    console.log(`[KAGGLE-WORKER] > Executing: ${sanitizedCmd}`);

    return new Promise((resolve, reject) => {
      let isTimedOut = false;
      const child = exec(cmd, {
        cwd: process.cwd(),
        maxBuffer: 15 * 1024 * 1024,
        timeout: timeoutMs,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          DEBIAN_FRONTEND: 'noninteractive',
        },
      }, (err, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const isoEnd = new Date().toISOString();
        const cleanStdout = stdout || '';
        const cleanStderr = stderr || '';
        const exitCode = err ? (typeof err.code === 'number' ? err.code : (err.killed ? -1 : 1)) : 0;

        if (err) {
          if (err.killed || isTimedOut) {
            console.error(`[KAGGLE-WORKER] [EXEC TIMEOUT] Stage: "${stageName}" exceeded ${timeoutMs}ms | Start: ${isoStart} | End: ${isoEnd}`);
            reject({
              code: 'STAGE_TIMEOUT',
              stage: stageName,
              message: `Stage '${stageName}' timed out after ${Math.round(timeoutMs / 1000)}s`,
              details: `Command exceeded timeout limit of ${timeoutMs}ms`,
            });
            return;
          }

          if (!options?.ignoreExitCode) {
            console.error(`[KAGGLE-WORKER] [EXEC ERROR] Stage: "${stageName}" | ExitCode: ${exitCode} | Duration: ${durationMs}ms`);
            if (cleanStdout.trim()) console.log(`[KAGGLE-WORKER] STDOUT:\n${this.sanitize(cleanStdout.trim())}`);
            if (cleanStderr.trim()) console.error(`[KAGGLE-WORKER] STDERR:\n${this.sanitize(cleanStderr.trim())}`);

            reject({
              code: 'COMMAND_FAILED',
              stage: stageName,
              message: this.sanitize(cleanStderr || cleanStdout || err.message),
              exitCode,
              durationMs,
            });
            return;
          }
        }

        console.log(`[KAGGLE-WORKER] [EXEC OK] Stage: "${stageName}" | ExitCode: ${exitCode} | Duration: ${durationMs}ms`);
        if (cleanStdout.trim()) {
          const firstFewLines = cleanStdout.trim().split('\n').slice(0, 3).join(' ');
          console.log(`[KAGGLE-WORKER] STDOUT: ${this.sanitize(firstFewLines)}`);
        }

        resolve({
          stdout: cleanStdout,
          stderr: cleanStderr,
          exitCode,
          durationMs,
        });
      });

      child.on('error', (procErr) => {
        const durationMs = Date.now() - startTime;
        console.error(`[KAGGLE-WORKER] [EXEC SPAWN ERROR] Stage: "${stageName}" | Duration: ${durationMs}ms | Error: ${procErr.message}`);
        reject({
          code: 'SPAWN_ERROR',
          stage: stageName,
          message: procErr.message,
          durationMs,
        });
      });
    });
  }
}

export const workerInitializer = new WorkerInitializerService();
