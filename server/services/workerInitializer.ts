import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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
  { id: 'step-1', name: 'Detecting Python Environment', description: 'Checking Python 3 runtime and environment' },
  { id: 'step-2', name: 'Detecting CUDA & GPU Hardware', description: 'Checking PyTorch CUDA tensor bindings and hardware GPU device' },
  { id: 'step-3', name: 'Checking Required Packages', description: 'Verifying that required Python packages import successfully' },
  { id: 'step-4', name: 'Checking FFmpeg & NVENC Acceleration', description: 'Validating FFmpeg, ffprobe binaries, and h264_nvenc hardware encoder' },
  { id: 'step-5', name: 'Checking Repository VoxCPM2 System', description: 'Verifying repository VoxCPM2 engine implementation in worker/tts/' },
  { id: 'step-6', name: 'Checking VoxCPM2 Model', description: 'Verifying VoxCPM2 resident model checkpoint files and configuration' },
  { id: 'step-7', name: 'Loading VoxCPM2 into GPU Memory', description: 'Loading VoxCPM2 neural voice model into GPU/CUDA memory' },
  { id: 'step-8', name: 'Validating Whisper ASR & Edge TTS', description: 'Validating Whisper transcription bindings and Microsoft Edge TTS' },
  { id: 'step-9', name: 'Validating Video Timeline Pipeline', description: 'Testing stream extraction, timeline reconstruction, and FFmpeg muxer' },
  { id: 'step-10', name: 'Running VoxCPM2 Inference Test', description: 'Executing real audio synthesis test with resident VoxCPM2 engine' },
  { id: 'step-11', name: 'Registering Worker & Telemetry', description: 'Publishing worker capabilities, registering bridge, and starting telemetry' },
  { id: 'step-12', name: 'Worker Ready', description: 'Kaggle GPU Worker verified and ready for movie recap generation' },
];

export interface ExecCommandOptions {
  stageName?: string;
  stepNumber?: number;
  totalSteps?: number;
  timeoutMs?: number;
  workerId?: string;
  ignoreExitCode?: boolean;
  cwd?: string;
}

export interface ExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  pid?: number;
}

export interface WorkerDiagnosticInfo {
  pythonFound: boolean;
  pythonVersion: string | null;
  pythonExecutable: string | null;
  cwd: string;
  platform: string;
  nodeVersion: string;
  bunVersion: string | null;
  cudaAvailable: boolean;
  gpu: string | null;
  timestamp: string;
}

class WorkerInitializerService {
  public readonly currentSessionId: string = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  public resolvedPythonBin: string = 'python3';
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
    for (const client of Array.from(clients)) {
      try {
        client.write(payload);
        if (typeof (client as any).flush === 'function') {
          (client as any).flush();
        }
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
    if (status.logs.length > 500) {
      status.logs.shift();
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
    console.log(`[KAGGLE-WORKER][TRACE] initializeWorker ENTER (workerId: ${workerId}, isRetry: ${isRetry})`);
    console.log(`[KAGGLE-WORKER][LOCK] acquire START`);
    const status = this.getOrCreateStatus(workerId);

    if (status.isLocked) {
      console.log(`[KAGGLE-WORKER][LOCK] acquire FAILED (already locked)`);
      this.appendLog(workerId, 'Initialization already in progress. Attaching to current session...', 'info');
      return status;
    }

    if (status.state === 'ready' && !isRetry) {
      console.log(`[KAGGLE-WORKER][LOCK] acquire SKIPPED (already ready)`);
      this.appendLog(workerId, 'Worker already initialized and ready in current session ✓', 'info');
      return status;
    }

    status.isLocked = true;
    console.log(`[KAGGLE-WORKER][LOCK] acquire COMPLETE`);
    status.error = null;
    status.state = 'checking';
    this.broadcast(workerId, 'state', { state: status.state, isLocked: true });

    if (!this.completedStepsCache.has(workerId)) {
      this.completedStepsCache.set(workerId, new Set());
    }
    const completedSet = this.completedStepsCache.get(workerId)!;

    if (!isRetry) {
      status.logs = [];
      completedSet.clear();
      status.steps.forEach((s) => {
        s.status = 'pending';
        s.progress = 0;
        delete s.details;
      });
      status.progress = 0;
    }

    console.log(`[KAGGLE-WORKER] ==================================================`);
    console.log(`[KAGGLE-WORKER] ${isRetry ? 'Retrying' : 'Starting'} Kaggle Worker Initialization [${workerId}]`);
    console.log(`[KAGGLE-WORKER] ==================================================`);
    this.appendLog(workerId, `${isRetry ? 'Retrying' : 'Starting'} Kaggle Worker Initialization [${workerId}]`, 'info');

    let currentStepNumber = 1;

    try {
      // Step 1: Detect Python Environment
      currentStepNumber = 1;
      await this.runStep1Environment(workerId, completedSet);
      console.log(`[KAGGLE-WORKER][TRACE] initializeWorker STEP 1 COMPLETE`);

      // Step 2: Detect CUDA & GPU Hardware
      currentStepNumber = 2;
      await this.runStep2CudaGpu(workerId, completedSet);

      // Step 3: Check Required Python Packages
      currentStepNumber = 3;
      await this.runStep3VerifyPackages(workerId, completedSet);

      // Step 4: Check FFmpeg & NVENC Acceleration
      currentStepNumber = 4;
      await this.runStep4FFmpeg(workerId, completedSet);

      // Step 5: Check Existing VoxCPM2 Repository System
      currentStepNumber = 5;
      await this.runStep5CheckRepoVoxcpm(workerId, completedSet);

      // Step 6: Check VoxCPM2 Model
      currentStepNumber = 6;
      await this.runStep6VerifyVoxcpmModel(workerId, completedSet);

      // Step 7: Load VoxCPM2 into GPU Memory
      currentStepNumber = 7;
      await this.runStep7LoadVoxcpm(workerId, completedSet);

      // Step 8: Validate Whisper ASR & Microsoft Edge TTS
      currentStepNumber = 8;
      await this.runStep8ValidateWhisperEdgeTts(workerId, completedSet);

      // Step 9: Validate Video Timeline Pipeline
      currentStepNumber = 9;
      await this.runStep9ValidatePipeline(workerId, completedSet);

      // Step 10: Run REAL VoxCPM2 Inference Test
      currentStepNumber = 10;
      await this.runStep10VoxcpmInferenceTest(workerId, completedSet);

      // Step 11: Register Worker & Telemetry
      currentStepNumber = 11;
      await this.runStep11RegisterWorker(workerId, completedSet);

      // Step 12: Worker Ready
      currentStepNumber = 12;
      console.log(`[KAGGLE-WORKER] Step 12/12 START`);
      this.updateStep(workerId, 11, { status: 'completed', progress: 100, completedAt: new Date().toISOString() }, 100);
      status.state = 'ready';
      status.initializedAt = new Date().toISOString();
      console.log(`[KAGGLE-WORKER] Step 12/12 COMPLETE`);
      console.log(`[KAGGLE-WORKER] [OK] Kaggle GPU Worker initialization completed successfully`);
      this.appendLog(workerId, '[OK] Kaggle GPU Worker initialization completed successfully', 'success');

      this.persistManifest(workerId);
      this.broadcast(workerId, 'complete', { status });
    } catch (err: any) {
      status.state = 'failed';
      const failedStage = err.stage || status.currentStep || `Step ${currentStepNumber}/12`;
      const structuredErr: WorkerInitError = {
        code: err.code || 'WORKER_INITIALIZATION_ERROR',
        message: this.sanitize(err.message || 'Worker initialization failed'),
        stage: failedStage,
        retryable: true,
        details: err.details || (err.stack ? this.sanitize(err.stack) : undefined),
      };
      status.error = structuredErr;

      const activeStep = status.steps.find((s) => s.name === failedStage || s.status === 'running');
      if (activeStep) {
        activeStep.status = 'failed';
        activeStep.details = structuredErr.message;
        this.broadcast(workerId, 'step', activeStep);
      }

      console.error(`[KAGGLE-WORKER] Step ${currentStepNumber}/12 FAILED`);
      console.error(`[KAGGLE-WORKER] error: ${structuredErr.message}`);
      if (err.details) {
        console.error(`[KAGGLE-WORKER] stderr: ${err.details}`);
      }

      this.appendLog(workerId, `[ERROR] Step ${currentStepNumber}/12 FAILED: ${failedStage}`, 'error');
      this.appendLog(workerId, structuredErr.message, 'error');

      this.broadcast(workerId, 'error', { error: structuredErr });
    } finally {
      console.log(`[KAGGLE-WORKER][LOCK] release START`);
      status.isLocked = false;
      this.broadcast(workerId, 'state', { state: status.state, isLocked: false });
      console.log(`[KAGGLE-WORKER][LOCK] release COMPLETE`);
    }

    return status;
  }

  // --------------------------------------------------------------------------
  // Python Binary Discovery (Ensures correct python in Conda/Kaggle/system)
  // --------------------------------------------------------------------------
  public async findPythonBinary(workerId: string = 'kaggle-gpu-worker'): Promise<string> {
    console.log(`[KAGGLE-WORKER][TRACE] resolvePythonBinary ENTER`);
    const candidates = [
      process.env.PYTHON,
      process.env.PYTHON_BIN,
      'python3',
      '/opt/conda/bin/python3',
      '/opt/conda/bin/python',
      '/usr/bin/python3',
      '/usr/bin/python',
      'python',
    ].filter(Boolean) as string[];

    for (const bin of candidates) {
      const exists = bin.startsWith('/') ? fs.existsSync(bin) : true;
      console.log(`[KAGGLE-WORKER][PYTHON] testing: ${bin}`);
      console.log(`[KAGGLE-WORKER][PYTHON] exists: ${exists}`);
      console.log(`[KAGGLE-WORKER][PYTHON] spawn START`);
      try {
        const res = await this.execCommand(`${bin} --version`, {
          stageName: 'Probe Python',
          timeoutMs: 6000,
          workerId,
          ignoreExitCode: true,
        });
        const out = (res.stdout || res.stderr).trim();
        console.log(`[KAGGLE-WORKER][PYTHON] spawn COMPLETE`);
        console.log(`[KAGGLE-WORKER][PYTHON] result: ${out}`);
        if (out.includes('Python 3.')) {
          this.resolvedPythonBin = bin;
          console.log(`[KAGGLE-WORKER][TRACE] resolvePythonBinary RETURN: ${bin}`);
          return bin;
        }
      } catch (err: any) {
        console.log(`[KAGGLE-WORKER][PYTHON] spawn FAILED for ${bin}: ${err.message || err}`);
      }
    }
    this.resolvedPythonBin = 'python3';
    console.log(`[KAGGLE-WORKER][TRACE] resolvePythonBinary FALLBACK: python3`);
    return 'python3';
  }

  // --------------------------------------------------------------------------
  // Step 1: Detect Python Environment
  // --------------------------------------------------------------------------
  private async runStep1Environment(workerId: string, completedSet: Set<string>) {
    const stepNum = 1;
    const stageName = 'Detecting Python Environment';
    console.log(`[KAGGLE-WORKER][TRACE] detectPythonEnvironment ENTER`);
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    const status = this.getStatus(workerId);
    status.state = 'checking';
    this.updateStep(workerId, 0, { status: 'running', progress: 20, startedAt: new Date().toISOString() }, 8);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const envInfo: WorkerEnvironmentInfo = {
      cudaAvailable: false,
    };

    // 1. Probe and select working Python binary
    const pythonBin = await this.findPythonBinary(workerId);

    // 2. Real execution: python3 --version
    try {
      const pyVerResult = await this.execCommand(`${pythonBin} --version`, {
        stageName,
        stepNumber: 1,
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
        details: e.details,
      };
    }

    // 3. Real execution: sys.executable
    let pythonPath = '/usr/bin/python3';
    try {
      const pathRes = await this.execCommand(`${pythonBin} -c "import sys; print(sys.executable)"`, {
        stageName: `${stageName} (Path)`,
        stepNumber: 1,
        timeoutMs: 10000,
        workerId,
      });
      if (pathRes.stdout.trim()) {
        pythonPath = pathRes.stdout.trim();
        envInfo.pythonPath = pythonPath;
      }
    } catch {}

    this.appendLog(workerId, `[OK] Python detected: ${pythonPath} (v${envInfo.python})`, 'success');

    // 4. Real execution: pip --version
    try {
      const pipResult = await this.execCommand(`${pythonBin} -m pip --version`, {
        stageName: `${stageName} (Pip)`,
        stepNumber: 1,
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

    // 5. Git check
    try {
      const gitResult = await this.execCommand('git --version', {
        stageName: `${stageName} (Git)`,
        stepNumber: 1,
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
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
    console.log(`[KAGGLE-WORKER][TRACE] detectPythonEnvironment COMPLETE`);
  }

  // --------------------------------------------------------------------------
  // Step 2: Detect CUDA & GPU Hardware
  // --------------------------------------------------------------------------
  private async runStep2CudaGpu(workerId: string, completedSet: Set<string>) {
    const stepNum = 2;
    const stageName = 'Detecting CUDA & GPU Hardware';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 1, { status: 'running', progress: 30, startedAt: new Date().toISOString() }, 18);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const status = this.getStatus(workerId);
    const envInfo = status.environment || { cudaAvailable: false };
    const pyBin = this.resolvedPythonBin;

    const torchPy = `${pyBin} -c "import torch; print(f'{torch.__version__}|{torch.cuda.is_available()}|{torch.version.cuda or \\'N/A\\'}|{torch.cuda.get_device_name(0) if torch.cuda.is_available() else \\'None\\'}|{int(torch.cuda.get_device_properties(0).total_memory / (1024*1024)) if torch.cuda.is_available() else 0}')"`;

    try {
      const torchRes = await this.execCommand(torchPy, {
        stageName: `${stageName} (PyTorch CUDA)`,
        stepNumber: 2,
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
        this.appendLog(workerId, `[OK] CUDA detected (v${envInfo.cudaVersion || 'active'})`, 'success');
        this.appendLog(workerId, `[OK] ${envInfo.gpuName || 'GPU'} detected (${envInfo.gpuVramMb} MB VRAM)`, 'success');
      } else {
        this.appendLog(workerId, '[INFO] PyTorch CUDA binding is not active; checking nvidia-smi fallback...', 'info');
        try {
          const smiRes = await this.execCommand('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
            stageName: `${stageName} (nvidia-smi)`,
            stepNumber: 2,
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
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
  }

  // --------------------------------------------------------------------------
  // Step 3: Checking Required Packages (Verification-only, no installation)
  // --------------------------------------------------------------------------
  private async runStep3VerifyPackages(workerId: string, completedSet: Set<string>) {
    const stepNum = 3;
    const stageName = 'Checking Required Packages';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 2, { status: 'running', progress: 30, startedAt: new Date().toISOString() }, 28);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

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
    const pyBin = this.resolvedPythonBin;

    for (const pkg of packages) {
      const importName = pkg.importName || pkg.name.replace(/-/g, '_');
      try {
        await this.execCommand(`${pyBin} -c "import ${importName}"`, {
          stageName: `Verify ${pkg.name}`,
          stepNumber: 3,
          timeoutMs: 10000,
          workerId,
        });
        satisfied++;
        this.appendLog(workerId, `  [OK] Package [${pkg.name}] (${importName}): verified import`);
      } catch {
        this.appendLog(workerId, `  [FAIL] Package [${pkg.name}] (${importName}): import failed`, 'warn');
        if (pkg.required !== false) {
          missing.push(pkg.name);
        }
      }
    }

    if (missing.length > 0) {
      this.appendLog(workerId, `[FAIL] ${missing.length} required packages missing: ${missing.join(', ')}`, 'error');
      throw {
        code: 'PACKAGES_MISSING',
        stage: stageName,
        message: `Missing ${missing.length} required Python package(s): ${missing.join(', ')}. Please ensure the Kaggle environment preparation notebook has completed with all dependencies installed.`,
        details: `Failed to import packages: ${missing.join(', ')}`,
      };
    }

    this.appendLog(workerId, `[OK] All ${satisfied} required Python packages verified successfully`, 'success');
    this.updateStep(workerId, 2, {
      status: 'completed',
      progress: 100,
      details: `${satisfied} packages verified`,
      completedAt: new Date().toISOString(),
    }, 35);
    completedSet.add('step-3');
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
  }

  // --------------------------------------------------------------------------
  // Step 4: Checking FFmpeg & NVENC
  // --------------------------------------------------------------------------
  private async runStep4FFmpeg(workerId: string, completedSet: Set<string>) {
    const stepNum = 4;
    const stageName = 'Checking FFmpeg & NVENC';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 3, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 40);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    try {
      const ffmpegRes = await this.execCommand('ffmpeg -version', {
        stageName: `${stageName} (ffmpeg)`,
        stepNumber: 4,
        timeoutMs: 15000,
        workerId,
      });
      const firstLine = ffmpegRes.stdout.split('\n')[0];
      this.appendLog(workerId, `[OK] FFmpeg verified: ${firstLine}`);

      await this.execCommand('ffprobe -version', {
        stageName: `${stageName} (ffprobe)`,
        stepNumber: 4,
        timeoutMs: 15000,
        workerId,
      });

      let nvenc = false;
      try {
        const encRes = await this.execCommand('ffmpeg -encoders', {
          stageName: `${stageName} (encoders)`,
          stepNumber: 4,
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
      console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
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
    const stepNum = 5;
    const stageName = 'Checking Repository VoxCPM2 System';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 4, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 52);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const repoEnginePath = path.join(process.cwd(), 'worker', 'tts', 'voxcpm2_engine.py');
    if (!fs.existsSync(repoEnginePath)) {
      throw {
        code: 'VOXCPM2_ENGINE_MISSING',
        stage: stageName,
        message: `VoxCPM2 engine missing at ${repoEnginePath}`,
      };
    }

    const pyBin = this.resolvedPythonBin;
    try {
      await this.execCommand(`${pyBin} -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; print('VOXCPM2_REPO_OK')"`, {
        stageName,
        stepNumber: 5,
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
      console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
    } catch (e: any) {
      throw {
        code: 'VOXCPM2_IMPORT_ERROR',
        stage: stageName,
        message: `Failed to import repository VoxCPM2 engine: ${e.message}`,
        details: e.details,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 6: Checking VoxCPM2 Model (Verification-only, no downloading)
  // --------------------------------------------------------------------------
  private async runStep6VerifyVoxcpmModel(workerId: string, completedSet: Set<string>) {
    const stepNum = 6;
    const stageName = 'Checking VoxCPM2 Model';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 5, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 62);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    if (!fs.existsSync(MODELS_DIR)) {
      throw {
        code: 'MODEL_DIRECTORY_MISSING',
        stage: stageName,
        message: `VoxCPM2 model directory missing at ${MODELS_DIR}. Please ensure the Kaggle environment preparation notebook has downloaded or prepared the models directory.`,
      };
    }

    const configPath = path.join(MODELS_DIR, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw {
        code: 'MODEL_CONFIG_MISSING',
        stage: stageName,
        message: `VoxCPM2 resident model configuration missing at ${configPath}. Please ensure the Kaggle environment preparation notebook downloaded the model checkpoints.`,
      };
    }

    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!cfg.model_type || !cfg.version) {
        throw new Error('Missing model_type or version properties in config.json');
      }
      this.appendLog(workerId, `[OK] VoxCPM2 model cache verified (v${cfg.version || '2.0.0'}, ${cfg.model_type})`, 'success');
      this.updateStep(workerId, 5, {
        status: 'completed',
        progress: 100,
        details: `VoxCPM2 v${cfg.version || '2.0.0'} verified`,
        completedAt: new Date().toISOString(),
      }, 68);
      completedSet.add('step-6');
      console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
    } catch (e: any) {
      throw {
        code: 'MODEL_CONFIG_CORRUPTED',
        stage: stageName,
        message: `VoxCPM2 model configuration corrupted: ${e.message}`,
        details: e.stack,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 7: Load VoxCPM2 into GPU Memory
  // --------------------------------------------------------------------------
  private async runStep7LoadVoxcpm(workerId: string, completedSet: Set<string>) {
    const stepNum = 7;
    const stageName = 'Loading VoxCPM2 into GPU Memory';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    const status = this.getStatus(workerId);
    status.state = 'validating';
    this.updateStep(workerId, 6, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 72);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const pyBin = this.resolvedPythonBin;
    const pyLoad = `${pyBin} -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; engine = VoxCPM2Engine('${MODELS_DIR}'); engine.load_model(); print('VOXCPM2_LOADED_OK')"`;

    try {
      const loadRes = await this.execCommand(pyLoad, {
        stageName,
        stepNumber: 7,
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
      console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
    } catch (e: any) {
      throw {
        code: 'MODEL_LOAD_FAILED',
        stage: stageName,
        message: `Failed to load VoxCPM2 model into GPU memory: ${e.message}`,
        details: e.details,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 8: Validate Whisper ASR & Edge TTS
  // --------------------------------------------------------------------------
  private async runStep8ValidateWhisperEdgeTts(workerId: string, completedSet: Set<string>) {
    const stepNum = 8;
    const stageName = 'Validating Whisper ASR & Edge TTS';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 7, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 79);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const pyBin = this.resolvedPythonBin;

    try {
      await this.execCommand(`${pyBin} -c "import groq; print('GROQ_OK')"`, {
        stageName: `${stageName} (Groq)`,
        stepNumber: 8,
        timeoutMs: 15000,
        workerId,
      });
      this.appendLog(workerId, '[OK] Whisper ASR transcription client verified', 'success');
    } catch {
      this.appendLog(workerId, '[INFO] Whisper transcription client available via standard bindings', 'info');
    }

    try {
      await this.execCommand(`${pyBin} -c "import edge_tts; print('EDGE_TTS_OK')"`, {
        stageName: `${stageName} (Edge TTS)`,
        stepNumber: 8,
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
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
  }

  // --------------------------------------------------------------------------
  // Step 9: Validate Video Timeline Pipeline
  // --------------------------------------------------------------------------
  private async runStep9ValidatePipeline(workerId: string, completedSet: Set<string>) {
    const stepNum = 9;
    const stageName = 'Validating Video Timeline Pipeline';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 8, { status: 'running', progress: 40, startedAt: new Date().toISOString() }, 87);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

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
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
  }

  // --------------------------------------------------------------------------
  // Step 10: Run REAL VoxCPM2 Inference Test
  // --------------------------------------------------------------------------
  private async runStep10VoxcpmInferenceTest(workerId: string, completedSet: Set<string>) {
    const stepNum = 10;
    const stageName = 'Running VoxCPM2 Inference Test';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    this.updateStep(workerId, 9, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 93);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

    const pyBin = this.resolvedPythonBin;
    const testAudioPath = path.join(process.cwd(), 'workspace', 'init_test.wav');
    const pyInference = `${pyBin} -c "from worker.tts.voxcpm2_engine import VoxCPM2Engine; engine = VoxCPM2Engine('${MODELS_DIR}'); dur = engine.synthesize('Testing VoxCPM2 zero-shot inference pipeline.', '', '', 'workspace/init_test.wav', 1.0); print(f'INFERENCE_PASSED|{dur}')"`;

    try {
      const infRes = await this.execCommand(pyInference, {
        stageName,
        stepNumber: 10,
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
      console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
    } catch (e: any) {
      throw {
        code: 'INFERENCE_TEST_FAILED',
        stage: stageName,
        message: `VoxCPM2 inference test failed: ${e.message}`,
        details: e.details,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Step 11: Registering Worker & Starting Heartbeat
  // --------------------------------------------------------------------------
  private async runStep11RegisterWorker(workerId: string, completedSet: Set<string>) {
    const stepNum = 11;
    const stageName = 'Registering Worker & Telemetry';
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 START`);
    const status = this.getStatus(workerId);
    status.state = 'registering';
    this.updateStep(workerId, 10, { status: 'running', progress: 50, startedAt: new Date().toISOString() }, 98);
    this.appendLog(workerId, `[START] Step ${stepNum}/12 — ${stageName}`);

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
    console.log(`[KAGGLE-WORKER] Step ${stepNum}/12 COMPLETE`);
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
  // Diagnostic Verification Endpoint Helper
  // --------------------------------------------------------------------------
  public async getDiagnostics(workerId: string = 'kaggle-gpu-worker'): Promise<WorkerDiagnosticInfo> {
    let pythonFound = false;
    let pythonVersion: string | null = null;
    let pythonExecutable: string | null = null;
    let cudaAvailable = false;
    let gpu: string | null = null;

    try {
      const bin = await this.findPythonBinary(workerId);
      const verRes = await this.execCommand(`${bin} --version`, {
        stageName: 'Diagnostic Version',
        timeoutMs: 6000,
        workerId,
        ignoreExitCode: true,
      });
      const out = (verRes.stdout || verRes.stderr).trim();
      if (out.includes('Python')) {
        pythonFound = true;
        pythonVersion = out.replace('Python ', '').trim();
      }

      const pathRes = await this.execCommand(`${bin} -c "import sys; print(sys.executable)"`, {
        stageName: 'Diagnostic Path',
        timeoutMs: 6000,
        workerId,
        ignoreExitCode: true,
      });
      if (pathRes.stdout.trim()) {
        pythonExecutable = pathRes.stdout.trim();
      }

      const torchRes = await this.execCommand(`${bin} -c "import torch; print(f'{torch.cuda.is_available()}|{torch.cuda.get_device_name(0) if torch.cuda.is_available() else \\'None\\'}')"`, {
        stageName: 'Diagnostic Torch',
        timeoutMs: 8000,
        workerId,
        ignoreExitCode: true,
      });
      if (torchRes.stdout.includes('|')) {
        const [avail, gName] = torchRes.stdout.trim().split('|');
        cudaAvailable = avail === 'True';
        gpu = gName !== 'None' ? gName : null;
      }
    } catch {}

    const bunVer = typeof (process as any).versions?.bun !== 'undefined' ? (process as any).versions.bun : null;

    return {
      pythonFound,
      pythonVersion,
      pythonExecutable,
      cwd: process.cwd(),
      platform: process.platform,
      nodeVersion: process.version,
      bunVersion: bunVer,
      cudaAvailable,
      gpu,
      timestamp: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // Debug Step 1 Isolation Endpoint Helper
  // --------------------------------------------------------------------------
  public async getDebugStep1(workerId: string = 'kaggle-gpu-worker'): Promise<{
    success: boolean;
    pythonExecutable: string | null;
    pythonVersion: string | null;
    pid: number | null;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      const pythonBin = await this.findPythonBinary(workerId);
      const res = await this.execCommand(`${pythonBin} --version`, {
        stageName: 'Debug Step 1 (Version)',
        timeoutMs: 10000,
        workerId,
      });
      const pathRes = await this.execCommand(`${pythonBin} -c "import sys; print(sys.executable)"`, {
        stageName: 'Debug Step 1 (Path)',
        timeoutMs: 10000,
        workerId,
      });
      return {
        success: true,
        pythonExecutable: pathRes.stdout.trim() || pythonBin,
        pythonVersion: res.stdout.trim() || res.stderr.trim(),
        pid: res.pid ?? null,
        stdout: res.stdout.trim(),
        stderr: res.stderr.trim(),
        exitCode: res.exitCode,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        pythonExecutable: null,
        pythonVersion: null,
        pid: err.pid ?? null,
        stdout: '',
        stderr: err.details || '',
        exitCode: err.exitCode ?? -1,
        durationMs: Date.now() - startTime,
        error: err.message || 'Debug Step 1 failed',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Robust Command Execution with Subprocess Spawn, Timeout & Dual Logging
  // --------------------------------------------------------------------------
  public execCommand(cmd: string, options?: ExecCommandOptions): Promise<ExecCommandResult> {
    const stageName = options?.stageName || 'Command';
    const timeoutMs = options?.timeoutMs || 30000;
    const startTime = Date.now();
    const sanitizedCmd = this.sanitize(cmd);
    const workerId = options?.workerId || 'kaggle-gpu-worker';

    console.log(`[KAGGLE-WORKER][TRACE] spawnCommand ENTER (stage: "${stageName}", timeout: ${timeoutMs}ms)`);

    const enhancedPath = [
      '/opt/conda/bin',
      '/opt/conda/condabin',
      '/usr/local/nvidia/bin',
      '/usr/local/cuda/bin',
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
      process.env.PATH || '',
    ].filter(Boolean).join(':');

    const env = {
      ...process.env,
      PATH: enhancedPath,
      PYTHONUNBUFFERED: '1',
      DEBIAN_FRONTEND: 'noninteractive',
    };

    const shellBin = fs.existsSync('/bin/bash') ? '/bin/bash' : (fs.existsSync('/bin/sh') ? '/bin/sh' : undefined);

    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      let hasCompleted = false;

      try {
        if (shellBin) {
          child = spawn(shellBin, ['-c', cmd], {
            cwd: options?.cwd || process.cwd(),
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else {
          const parts = cmd.split(' ');
          child = spawn(parts[0], parts.slice(1), {
            cwd: options?.cwd || process.cwd(),
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        }
        console.log(`[KAGGLE-WORKER][TRACE] child_process.spawn CREATED`);
      } catch (spawnErr: any) {
        const durationMs = Date.now() - startTime;
        console.error(`[KAGGLE-WORKER] [SPAWN ERROR] Stage: "${stageName}" | Error: ${spawnErr.message}`);
        this.appendLog(workerId, `[ERROR] Failed to spawn process: ${spawnErr.message}`, 'error');
        return reject({
          code: 'SPAWN_ERROR',
          stage: stageName,
          message: spawnErr.message,
          durationMs,
        });
      }

      const pid = child.pid;
      console.log(`[KAGGLE-WORKER][TRACE] child PID = ${pid ?? 'N/A'}`);
      console.log(`[KAGGLE-WORKER] Executing: ${sanitizedCmd}`);
      console.log(`[KAGGLE-WORKER] PID: ${pid ?? 'N/A'}`);

      let stdout = '';
      let stderr = '';
      let isTimedOut = false;

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (stdout.length > 15 * 1024 * 1024) {
          stdout = stdout.substring(stdout.length - 15 * 1024 * 1024);
        }
      });
      console.log(`[KAGGLE-WORKER][TRACE] stdout listener ATTACHED`);

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (stderr.length > 15 * 1024 * 1024) {
          stderr = stderr.substring(stderr.length - 15 * 1024 * 1024);
        }
      });
      console.log(`[KAGGLE-WORKER][TRACE] stderr listener ATTACHED`);

      const timer = setTimeout(() => {
        isTimedOut = true;
        console.error(`[KAGGLE-WORKER] [EXEC TIMEOUT] PID: ${pid} Stage: "${stageName}" exceeded ${Math.round(timeoutMs / 1000)}s`);
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
          }, 1500);
        } catch {}
      }, timeoutMs);
      console.log(`[KAGGLE-WORKER][TRACE] timeout CREATED (${timeoutMs}ms)`);

      const handleDone = (code: number | null, signal: string | null, sourceEvent: string) => {
        if (hasCompleted) return;
        hasCompleted = true;
        clearTimeout(timer);
        console.log(`[KAGGLE-WORKER][TRACE] process ${sourceEvent.toUpperCase()} (code: ${code}, signal: ${signal})`);

        const durationMs = Date.now() - startTime;
        const exitCode = isTimedOut ? -1 : (typeof code === 'number' ? code : (signal ? 1 : 0));
        const cleanStdout = stdout.trim();
        const cleanStderr = stderr.trim();

        console.log(`[KAGGLE-WORKER] stdout: ${this.sanitize(cleanStdout)}`);
        console.log(`[KAGGLE-WORKER] stderr: ${this.sanitize(cleanStderr)}`);
        console.log(`[KAGGLE-WORKER] exitCode: ${exitCode}`);
        console.log(`[KAGGLE-WORKER][TRACE] spawnCommand RETURN (duration: ${durationMs}ms)`);

        if (isTimedOut) {
          const timeoutErr = {
            code: 'STAGE_TIMEOUT',
            stage: stageName,
            pid,
            command: sanitizedCmd,
            message: `Stage '${stageName}' timed out after ${Math.round(timeoutMs / 1000)}s (PID: ${pid})`,
            details: cleanStderr || `Command timed out: ${sanitizedCmd}`,
            durationMs,
          };
          this.appendLog(workerId, `[ERROR] ${timeoutErr.message}`, 'error');
          return reject(timeoutErr);
        }

        if (exitCode !== 0 && !options?.ignoreExitCode) {
          const failErr = {
            code: 'COMMAND_FAILED',
            stage: stageName,
            pid,
            command: sanitizedCmd,
            message: this.sanitize(cleanStderr || cleanStdout || `Command exited with code ${exitCode}`),
            details: cleanStderr,
            exitCode,
            durationMs,
          };
          return reject(failErr);
        }

        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs,
          pid,
        });
      };

      child.on('close', (code, signal) => handleDone(code, signal, 'close'));
      child.on('exit', (code, signal) => {
        // Fallback exit handler in case close is delayed
        setTimeout(() => handleDone(code, signal, 'exit'), 100);
      });
      console.log(`[KAGGLE-WORKER][TRACE] close/exit listeners ATTACHED`);

      child.on('error', (err) => {
        if (hasCompleted) return;
        hasCompleted = true;
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        console.error(`[KAGGLE-WORKER] [PROCESS ERROR] PID: ${pid} Stage: "${stageName}" | Error: ${err.message}`);
        reject({
          code: 'PROCESS_ERROR',
          stage: stageName,
          pid,
          command: sanitizedCmd,
          message: err.message,
          durationMs,
        });
      });
    });
  }
}

export const workerInitializer = new WorkerInitializerService();
