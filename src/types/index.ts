export type ProcessingStageName =
  | 'Downloading'
  | 'Extracting Audio'
  | 'Transcribing'
  | 'Translating / Rewriting'
  | 'Generating TTS'
  | 'Rebuilding Timeline'
  | 'Mixing Audio'
  | 'Rendering Subtitles'
  | 'Encoding Final Video'
  | 'Completed';

export const PROCESSING_STAGES: { stage: number; name: ProcessingStageName; description: string }[] = [
  { stage: 1, name: 'Downloading', description: 'Fetching video stream from source URL' },
  { stage: 2, name: 'Extracting Audio', description: 'Extracting high-fidelity audio track via FFmpeg' },
  { stage: 3, name: 'Transcribing', description: 'Generating timestamped transcript via Groq Whisper' },
  { stage: 4, name: 'Translating / Rewriting', description: 'Generating cinematic recap narration script via Gemini' },
  { stage: 5, name: 'Generating TTS', description: 'Synthesizing voice audio & measuring exact durations' },
  { stage: 6, name: 'Rebuilding Timeline', description: 'Reconstructing video cuts dynamically from TTS length' },
  { stage: 7, name: 'Mixing Audio', description: 'Ducking ambient tracks and mastering narration' },
  { stage: 8, name: 'Rendering Subtitles', description: 'Burning typography-styled subtitles with custom font' },
  { stage: 9, name: 'Encoding Final Video', description: 'Assembling and encoding final H.264 video deliverable' },
  { stage: 10, name: 'Completed', description: 'Recap generated successfully and ready for export' },
];

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type TtsEngine = 'edge-tts' | 'voxcpm2';

export interface StructuredError {
  stage: string;
  code: string;
  message: string;
  retryable: boolean;
  timestamp?: string;
  details?: string;
}

export interface Segment {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  sourceDuration: number;
  scriptText: string;
  ttsAudioPath?: string;
  ttsDuration: number;
  finalStart: number;
  finalEnd: number;
  subtitleStart: number;
  subtitleEnd: number;
  operation?: 'direct' | 'trim' | 'extend_forward' | 'loop' | 'freeze_last_frame';
  videoPath?: string;
}

export interface SubtitleConfig {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  customFontUrl?: string;
  customFontFilename?: string;
  position: 'bottom' | 'middle' | 'top';
  bottomMargin: number;
  outlineColor: string;
  outlineWidth: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOffset: number;
}

export interface VoiceProfile {
  id: string;
  name: string;
  engine: 'voxcpm2';
  referenceAudioUrl?: string;
  referenceAudioPath?: string;
  referenceAudioFilename?: string;
  referenceText: string;
  speed: number;
  sampleRate?: number;
  styleSettings: {
    emotion?: string;
    pitch?: number;
    accent?: string;
  };
  generationSettings: {
    temperature: number;
    topP: number;
    diffusionSteps?: number;
    guidanceScale?: number;
    cfg_value?: number;
    inference_timesteps?: number;
  };
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export interface TTSChunkMeta {
  ttsChunkId: string;
  chunkId?: string;
  recapSegmentId: string;
  chunkIndex: number;
  segmentIndex?: number;
  chunkCountForRecapSegment?: number;
  sourceStart?: number;
  sourceEnd?: number;
  sourceDuration?: number;
  sourceText?: string;
  targetText?: string;
  chunkText?: string;
  text?: string;
  audioPath?: string;
  ttsAudioPath?: string;
  audioFilename?: string;
  actualDuration?: number;
  ttsDuration?: number;
  estimatedDuration?: number;
  characterCount?: number;
  ttsEngine?: string;
  status?: string;
}

export interface RecapSegment {
  id: number | string;
  sourceStart: number;
  sourceEnd: number;
  sourceDuration: number;
  sourceText: string;
  targetText: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export type JobSourceType = 'url' | 'upload';
export type AudioMode = 'recap' | 'dialogue';

export interface Job {
  id: string;
  sourceType: JobSourceType;
  sourceUrl?: string;
  uploadedFileId?: string;
  uploadedFileName?: string;
  uploadedFileSize?: number;
  audioMode?: AudioMode;
  title?: string;
  thumbnailUrl?: string;
  sourceVideoPath?: string;
  extractedAudioPath?: string;
  originalTranscript?: TranscriptSegment[] | string;
  translatedScript?: string;
  targetLanguage?: string;
  recapSegments?: RecapSegment[];
  stageMessage?: string;
  metrics?: Record<string, any>;
  selectedTtsEngine: TtsEngine;
  voiceProfileId?: string;
  edgeVoice?: string;
  ttsChunks?: TTSChunkMeta[];
  timelineSegments?: any[];
  timelineTotalDuration?: number;
  srtPath?: string;
  srtCueCount?: number;
  ttsSnapshot?: {
    ttsEngine: TtsEngine;
    voiceProfileId?: string;
    edgeVoice?: string;
    speed?: number;
    audioMode?: AudioMode;
    targetLanguage?: string;
    generationSettings?: Record<string, any>;
    voiceProfile?: VoiceProfile;
    voiceName?: string;
    voiceProfileName?: string;
  };
  subtitleConfig?: SubtitleConfig;
  segments: Segment[];
  status: JobStatus;
  currentStage: ProcessingStageName;
  currentStageNumber: number;
  progress: number;
  outputVideoPath?: string;
  outputVideoUrl?: string;
  error?: StructuredError | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  processingTimeSeconds?: number;
  assignedWorkerId?: string;
}

export type GpuWorkerState = 'Worker Offline' | 'Worker Online' | 'Processing' | 'Queue Busy';

export interface GpuWorkerStatus {
  state: GpuWorkerState;
  workerId?: string;
  gpuName?: string;
  vramTotalGb?: number;
  vramUsedGb?: number;
  lastHeartbeat?: string;
  activeJobId?: string;
  queuedJobsCount: number;
  isOnline: boolean;
  capabilities?: {
    whisper?: boolean;
    edgeTts?: boolean;
    voxcpm2?: boolean;
    ffmpeg?: boolean;
    nvenc?: boolean;
  };
}

export interface AppSettings {
  groqApiKeyConfigured: boolean;
  geminiApiKeyConfigured: boolean;
  groqApiKeyMasked?: string;
  geminiApiKeyMasked?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
  defaultTtsEngine: TtsEngine;
  defaultEdgeVoice: string;
  defaultTargetLanguage?: string;
  defaultVoxProfileId?: string;
  defaultSubtitleConfig: SubtitleConfig;
  subtitleDefaults?: SubtitleConfig;
  workerSecretToken: string;
}

export interface JobProgressUpdatePayload {
  stage: ProcessingStageName;
  stageNumber: number;
  progress: number;
  message?: string;
  stageMessage?: string;
  segments?: Segment[];
  recapSegments?: RecapSegment[];
  ttsChunks?: TTSChunkMeta[];
  originalTranscript?: TranscriptSegment[] | string;
  translatedScript?: string;
  title?: string;
  thumbnailUrl?: string;
  metrics?: Record<string, any>;
}

// -----------------------------------------------------------------------------
// Kaggle Worker One-Click Initialization Types
// -----------------------------------------------------------------------------
export type WorkerInitState =
  | 'unknown'
  | 'checking'
  | 'installing'
  | 'downloading_models'
  | 'validating'
  | 'registering'
  | 'ready'
  | 'failed';

export type WorkerStepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface WorkerInitStep {
  id: string;
  name: string;
  description: string;
  status: WorkerStepStatus;
  progress: number;
  details?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkerEnvironmentInfo {
  python?: string;
  pythonPath?: string;
  pip?: string;
  pytorch?: string;
  cudaAvailable: boolean;
  cudaVersion?: string;
  gpuName?: string;
  gpuVramMb?: number;
  ffmpeg?: string;
  ffprobe?: string;
  git?: string;
  nvencAvailable?: boolean;
}

export interface WorkerCapabilities {
  whisper: boolean;
  edgeTts: boolean;
  voxcpm2: boolean;
  ffmpeg: boolean;
  nvenc: boolean;
}

export interface WorkerInitError {
  code: string;
  message: string;
  stage: WorkerInitState;
  retryable: boolean;
  details?: string;
}

export interface WorkerInitLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface WorkerInitializationStatus {
  workerId: string;
  state: WorkerInitState;
  progress: number;
  currentStep: string;
  steps: WorkerInitStep[];
  environment?: WorkerEnvironmentInfo;
  capabilities?: WorkerCapabilities;
  error: WorkerInitError | null;
  logs: WorkerInitLogEntry[];
  initializedAt?: string;
  isLocked: boolean;
}

export interface WorkerRegistrationPayload {
  workerId: string;
  name?: string;
  status?: string;
  gpuName?: string;
  vramTotalGb?: number;
  vramUsedGb?: number;
  currentJobId?: string;
  lastHeartbeatAt?: string;
  capabilities?: WorkerCapabilities;
  hostname?: string;
}
