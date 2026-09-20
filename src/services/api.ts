import {
  Job,
  VoiceProfile,
  AppSettings,
  GpuWorkerStatus,
  SubtitleConfig,
  TtsEngine,
  WorkerInitializationStatus,
} from '../types/index.ts';

const BASE_URL = '';

export async function fetchJobs(): Promise<Job[]> {
  const res = await fetch(`${BASE_URL}/api/jobs`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE_URL}/api/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to fetch job details');
  return res.json();
}

export async function uploadVideoFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; uploadedFileId: string; fileName: string; fileSize: number; filePath: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/jobs/upload`);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          onProgress(pct);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error('Invalid response from video upload endpoint'));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData.error || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Video upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during video upload'));
    };

    const formData = new FormData();
    formData.append('video', file);
    xhr.send(formData);
  });
}

export async function createJob(params: {
  sourceType?: 'url' | 'upload';
  sourceUrl?: string;
  uploadedFileId?: string;
  uploadedFileName?: string;
  uploadedFileSize?: number;
  audioMode?: 'recap' | 'dialogue';
  selectedTtsEngine?: TtsEngine;
  voiceProfileId?: string;
  edgeVoice?: string;
  subtitleConfig?: SubtitleConfig;
  customTitle?: string;
  targetLanguage?: string;
  autoSimulate?: boolean;
}): Promise<Job> {
  const res = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to submit movie to queue');
  }
  return res.json();
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE_URL}/api/jobs/${id}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to cancel job');
  return res.json();
}

export async function retryJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE_URL}/api/jobs/${id}/retry`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to retry job');
  return res.json();
}

export async function simulateJob(id: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/jobs/${id}/simulate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger job pipeline simulation');
  return res.json();
}

export async function fetchVoiceProfiles(): Promise<VoiceProfile[]> {
  const res = await fetch(`${BASE_URL}/api/voices`);
  if (!res.ok) throw new Error('Failed to fetch voice profiles');
  return res.json();
}

export async function createVoiceProfile(formData: FormData): Promise<VoiceProfile> {
  const res = await fetch(`${BASE_URL}/api/voices`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create voice profile');
  }
  return res.json();
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/voices/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete voice profile');
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function updateSettings(
  settings: Partial<AppSettings> & { groqApiKey?: string; geminiApiKey?: string }
): Promise<AppSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
}

export async function testGeminiApiKey(apiKey?: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/api/settings/test-gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function testGroqApiKey(apiKey?: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/api/settings/test-groq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function fetchWorkerStatus(): Promise<GpuWorkerStatus> {
  const res = await fetch(`${BASE_URL}/api/worker/status`);
  if (!res.ok) throw new Error('Failed to fetch GPU worker status');
  return res.json();
}

export async function uploadCustomFont(file: File): Promise<{ fontName: string; filename: string; url: string }> {
  const formData = new FormData();
  formData.append('fontFile', file);

  const res = await fetch(`${BASE_URL}/api/fonts/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to upload font');
  }
  return res.json();
}

// -----------------------------------------------------------------------------
// Kaggle Worker One-Click Initialization API
// -----------------------------------------------------------------------------

export async function fetchWorkerInitialization(workerId: string = 'kaggle-gpu-worker'): Promise<WorkerInitializationStatus> {
  const res = await fetch(`${BASE_URL}/api/workers/${encodeURIComponent(workerId)}/initialization`);
  if (!res.ok) throw new Error('Failed to fetch worker initialization status');
  return res.json();
}

export async function initializeWorker(workerId: string = 'kaggle-gpu-worker'): Promise<WorkerInitializationStatus> {
  const res = await fetch(`${BASE_URL}/api/workers/${encodeURIComponent(workerId)}/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to initialize worker');
  }
  return res.json();
}

export async function retryWorkerInitialization(workerId: string = 'kaggle-gpu-worker'): Promise<WorkerInitializationStatus> {
  const res = await fetch(`${BASE_URL}/api/workers/${encodeURIComponent(workerId)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to retry worker initialization');
  }
  return res.json();
}

export function subscribeWorkerInitialization(
  workerId: string = 'kaggle-gpu-worker',
  callbacks: {
    onSnapshot?: (status: WorkerInitializationStatus) => void;
    onLog?: (log: any) => void;
    onStep?: (step: any) => void;
    onProgress?: (progress: { progress: number; currentStep: string }) => void;
    onState?: (state: { state: string; isLocked: boolean }) => void;
    onComplete?: (data: { status: WorkerInitializationStatus }) => void;
    onError?: (err: any) => void;
  }
): () => void {
  const eventSource = new EventSource(`${BASE_URL}/api/workers/${encodeURIComponent(workerId)}/initialization/events`);

  eventSource.addEventListener('snapshot', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onSnapshot?.(data);
    } catch {}
  });

  eventSource.addEventListener('log', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onLog?.(data);
    } catch {}
  });

  eventSource.addEventListener('step', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onStep?.(data);
    } catch {}
  });

  eventSource.addEventListener('progress', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onProgress?.(data);
    } catch {}
  });

  eventSource.addEventListener('state', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onState?.(data);
    } catch {}
  });

  eventSource.addEventListener('complete', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      callbacks.onComplete?.(data);
    } catch {}
  });

  eventSource.addEventListener('error', (e: MessageEvent) => {
    try {
      if (e.data) {
        const data = JSON.parse(e.data);
        callbacks.onError?.(data.error || data);
      }
    } catch {}
  });

  return () => {
    eventSource.close();
  };
}

export async function fetchDebugInitialization(workerId: string = 'kaggle-gpu-worker') {
  const res = await fetch(`${BASE_URL}/api/workers/debug-initialization?workerId=${encodeURIComponent(workerId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch debug initialization');
  }
  return res.json();
}

