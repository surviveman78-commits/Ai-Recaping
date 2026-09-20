import { Job, Segment, VoiceProfile, AppSettings, StructuredError, ProcessingStageName, PROCESSING_STAGES, SubtitleConfig, JobSourceType, AudioMode } from '../../src/types/index.ts';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

class JobStoreManager extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private voiceProfiles: Map<string, VoiceProfile> = new Map();
  private settings: AppSettings;
  private rawGroqApiKey: string = process.env.GROQ_API_KEY || '';
  private rawGeminiApiKey: string = process.env.GEMINI_API_KEY || '';

  constructor() {
    super();
    this.setMaxListeners(100);

    const defaultSubConfig: SubtitleConfig = {
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 24,
      fontColor: '#ffffff',
      position: 'bottom',
      bottomMargin: 48,
      outlineColor: '#000000',
      outlineWidth: 3,
      shadowBlur: 4,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowOffset: 2,
    };

    this.settings = {
      groqApiKeyConfigured: Boolean(this.rawGroqApiKey),
      geminiApiKeyConfigured: Boolean(this.rawGeminiApiKey),
      groqApiKeyMasked: this.maskKey(this.rawGroqApiKey),
      geminiApiKeyMasked: this.maskKey(this.rawGeminiApiKey),
      defaultTtsEngine: 'edge-tts',
      defaultEdgeVoice: 'en-US-ChristopherNeural',
      defaultTargetLanguage: 'English',
      defaultVoxProfileId: 'vox-prof-1',
      workerSecretToken: process.env.WORKER_SECRET_TOKEN || 'recap-kaggle-token-2026',
      defaultSubtitleConfig: defaultSubConfig,
      subtitleDefaults: defaultSubConfig,
    };

    this.seedDefaultVoiceProfiles();
    this.seedDemoJobs();
  }

  private maskKey(key?: string): string {
    if (!key || key.length < 6) return '';
    return key.slice(0, 4) + '••••••••••••' + key.slice(-4);
  }

  private seedDefaultVoiceProfiles() {
    const defaultProfiles: VoiceProfile[] = [
      {
        id: 'vox-prof-1',
        name: 'The Cinematic Storyteller (Deep Baritone)',
        engine: 'voxcpm2',
        referenceAudioFilename: 'cinematic_baritone_sample.wav',
        referenceText: 'In a world governed by silence, one voice dared to chronicle the extraordinary truth behind the shadows.',
        speed: 1.0,
        styleSettings: {
          emotion: 'Suspenseful & Dramatic',
          pitch: 0,
          accent: 'American Narrative',
        },
        generationSettings: {
          temperature: 0.72,
          topP: 0.85,
          diffusionSteps: 30,
          guidanceScale: 3.5,
        },
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        id: 'vox-prof-2',
        name: 'Documentary Historian (Calm & Precise)',
        engine: 'voxcpm2',
        referenceAudioFilename: 'documentary_calm_sample.wav',
        referenceText: 'Decades after the event, archival footage reveals what really occurred behind closed doors on that fateful morning.',
        speed: 0.95,
        styleSettings: {
          emotion: 'Informative & Gripping',
          pitch: -2,
          accent: 'British Received Pronunciation',
        },
        generationSettings: {
          temperature: 0.65,
          topP: 0.80,
          diffusionSteps: 35,
          guidanceScale: 4.0,
        },
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'vox-prof-3',
        name: 'High-Paced Action Recap Host',
        engine: 'voxcpm2',
        referenceAudioFilename: 'action_host_sample.wav',
        referenceText: 'He had exactly three seconds to make the impossible jump before the entire facility collapsed behind him.',
        speed: 1.08,
        styleSettings: {
          emotion: 'Energetic & Fast-Paced',
          pitch: 1,
          accent: 'Modern Media',
        },
        generationSettings: {
          temperature: 0.78,
          topP: 0.90,
          diffusionSteps: 25,
          guidanceScale: 3.0,
        },
        createdAt: new Date().toISOString(),
      },
    ];

    for (const profile of defaultProfiles) {
      this.voiceProfiles.set(profile.id, profile);
    }
  }

  private seedDemoJobs() {
    // Seed a completed sample job showing the timeline reconstruction with TTS durations
    const sampleSegments: Segment[] = [
      {
        id: 'seg-1',
        sourceStart: 12.0,
        sourceEnd: 20.0,
        sourceDuration: 8.0,
        scriptText: 'Our story begins in 1984, inside a remote classified observatory high in the Chilean Andes.',
        ttsAudioPath: '/storage/audio/job-sample-1/seg-1.wav',
        ttsDuration: 10.4, // Notice: 8.0 source -> 10.4 TTS! Reconstructed timeline expands video!
        finalStart: 0.0,
        finalEnd: 10.4,
        subtitleStart: 0.2,
        subtitleEnd: 10.2,
      },
      {
        id: 'seg-2',
        sourceStart: 21.5,
        sourceEnd: 32.0,
        sourceDuration: 10.5,
        scriptText: 'Dr. Evelyn Vance notices an anomaly in sector nine that defies every known law of astrophysics.',
        ttsAudioPath: '/storage/audio/job-sample-1/seg-2.wav',
        ttsDuration: 8.6, // Notice: 10.5 source -> 8.6 TTS! Trimmed/compacted timeline!
        finalStart: 10.4,
        finalEnd: 19.0,
        subtitleStart: 10.6,
        subtitleEnd: 18.8,
      },
      {
        id: 'seg-3',
        sourceStart: 45.0,
        sourceEnd: 56.2,
        sourceDuration: 11.2,
        scriptText: 'Before she can alert the rest of the crew, the main generator abruptly loses all primary power.',
        ttsAudioPath: '/storage/audio/job-sample-1/seg-3.wav',
        ttsDuration: 9.8,
        finalStart: 19.0,
        finalEnd: 28.8,
        subtitleStart: 19.2,
        subtitleEnd: 28.6,
      },
    ];

    const demoJob: Job = {
      id: 'job-sample-1',
      sourceType: 'url',
      sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
      title: 'Tears of Steel (Sci-Fi Short Recap)',
      thumbnailUrl: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=800&auto=format&fit=crop&q=80',
      sourceVideoPath: '/storage/videos/job-sample-1/source.mp4',
      extractedAudioPath: '/storage/audio/job-sample-1/source_audio.wav',
      originalTranscript: [
        { start: 12.0, end: 20.0, text: 'Look at the data stream right here. It is fluctuating beyond baseline.' },
        { start: 21.5, end: 32.0, text: 'Are you sure? Sector nine never shows interference unless something breached.' },
        { start: 45.0, end: 56.2, text: 'Power failure in terminal three! Everyone get to emergency stations now!' },
      ],
      translatedScript: 'Our story begins in 1984, inside a remote classified observatory high in the Chilean Andes. Dr. Evelyn Vance notices an anomaly in sector nine that defies every known law of astrophysics. Before she can alert the rest of the crew, the main generator abruptly loses all primary power.',
      selectedTtsEngine: 'voxcpm2',
      voiceProfileId: 'vox-prof-1',
      subtitleConfig: this.settings.subtitleDefaults,
      segments: sampleSegments,
      status: 'completed',
      currentStage: 'Completed',
      currentStageNumber: 10,
      progress: 100,
      outputVideoPath: '/storage/outputs/job-sample-1/final_recap.mp4',
      outputVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
      startedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      completedAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
      processingTimeSeconds: 142,
    };

    // Note: Pre-seeded sample jobs removed per user request for clean queue
  }

  // --- JOB OPERATIONS ---

  public createJob(params: {
    sourceType?: JobSourceType;
    sourceUrl?: string;
    uploadedFileId?: string;
    uploadedFileName?: string;
    uploadedFileSize?: number;
    audioMode?: AudioMode;
    selectedTtsEngine?: 'edge-tts' | 'voxcpm2';
    voiceProfileId?: string;
    edgeVoice?: string;
    subtitleConfig?: SubtitleConfig;
    customTitle?: string;
    targetLanguage?: string;
  }): Job {
    const id = 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString();
    const sourceType: JobSourceType = params.sourceType || (params.uploadedFileId ? 'upload' : 'url');

    // Generate a fallback clean title
    let title = params.customTitle;
    if (!title) {
      if (sourceType === 'upload') {
        title = params.uploadedFileName ? params.uploadedFileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') : 'Uploaded Movie Video';
      } else if (params.sourceUrl) {
        try {
          const urlObj = new URL(params.sourceUrl);
          const pathSegments = urlObj.pathname.split('/').filter(Boolean);
          const last = pathSegments[pathSegments.length - 1] || 'Movie Stream';
          title = decodeURIComponent(last).replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
        } catch {
          title = 'Recap: ' + params.sourceUrl.slice(0, 30);
        }
      } else {
        title = 'Movie Recap';
      }
    }

    const ttsEngine = params.selectedTtsEngine || this.settings.defaultTtsEngine;
    const voiceProfileId = params.voiceProfileId || (ttsEngine === 'voxcpm2' ? this.settings.defaultVoxProfileId : undefined);
    const activeVoiceProfile = voiceProfileId ? this.voiceProfiles.get(voiceProfileId) : undefined;
    const edgeVoice = params.edgeVoice || this.settings.defaultEdgeVoice;
    const targetLanguage = params.targetLanguage || 'English';
    const audioMode: AudioMode = params.audioMode || 'recap';

    const ttsSnapshot = {
      ttsEngine,
      voiceProfileId,
      edgeVoice,
      targetLanguage,
      audioMode,
      speed: activeVoiceProfile?.speed || 1.0,
      generationSettings: activeVoiceProfile?.generationSettings || { cfg_value: 3.5, inference_timesteps: 30, temperature: 0.72, topP: 0.85 },
      voiceProfile: activeVoiceProfile ? { ...activeVoiceProfile } : undefined,
    };

    // Ensure isolated workspace directory exists for this job
    const workspaceSourceDir = path.join(process.cwd(), 'workspace', 'jobs', id, 'source');
    try {
      fs.mkdirSync(workspaceSourceDir, { recursive: true });
      if (sourceType === 'upload' && params.uploadedFileId) {
        const uploadsDir = path.join(process.cwd(), 'uploads', 'videos');
        if (fs.existsSync(uploadsDir)) {
          const candidateFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith(params.uploadedFileId!));
          if (candidateFiles.length > 0) {
            const sourcePath = path.join(uploadsDir, candidateFiles[0]);
            const destPath = path.join(workspaceSourceDir, 'movie.mp4');
            fs.copyFileSync(sourcePath, destPath);
          }
        }
      }
    } catch (e) {
      console.warn('Could not initialize workspace directory for job', id, e);
    }

    const newJob: Job = {
      id,
      sourceType,
      sourceUrl: params.sourceUrl || (sourceType === 'upload' ? `local://${params.uploadedFileName || 'video.mp4'}` : ''),
      uploadedFileId: params.uploadedFileId,
      uploadedFileName: params.uploadedFileName,
      uploadedFileSize: params.uploadedFileSize,
      audioMode,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      thumbnailUrl: `https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop&q=80`,
      targetLanguage,
      selectedTtsEngine: ttsEngine,
      voiceProfileId,
      edgeVoice,
      ttsSnapshot,
      subtitleConfig: params.subtitleConfig || this.settings.subtitleDefaults,
      segments: [],
      status: 'queued',
      currentStage: 'Downloading',
      currentStageNumber: 1,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, newJob);

    const timestamp = new Date().toISOString();
    console.log(`[QUEUE-TRACE] [${timestamp}] [JOB_CREATED] job ID: ${id} | worker ID: ${newJob.assignedWorkerId || 'unassigned'} | current job status: ${newJob.status} | current worker status: ready`);
    console.log(`[QUEUE-TRACE] [${timestamp}] [QUEUED] job ID: ${id} | worker ID: ${newJob.assignedWorkerId || 'unassigned'} | current job status: queued | current worker status: ready`);

    this.emit('job-created', newJob);
    this.emit('job-updated', newJob);
    this.emit(`job-${id}`, newJob);
    return newJob;
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  public getAllJobs(): Job[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public updateJob(id: string, updates: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const updatedJob: Job = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Calculate processing duration if completed
    if (updates.status === 'completed' && updatedJob.startedAt && !updatedJob.completedAt) {
      updatedJob.completedAt = new Date().toISOString();
      const diffMs = new Date(updatedJob.completedAt).getTime() - new Date(updatedJob.startedAt).getTime();
      updatedJob.processingTimeSeconds = Math.round(diffMs / 1000);
    }

    this.jobs.set(id, updatedJob);
    this.emit('job-updated', updatedJob);
    this.emit(`job-${id}`, updatedJob);
    return updatedJob;
  }

  public cancelJob(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === 'completed') return job;

    return this.updateJob(id, {
      status: 'cancelled',
      error: {
        stage: job.currentStage,
        code: 'USER_CANCELLED',
        message: 'Processing was cancelled by the user.',
        retryable: true,
        timestamp: new Date().toISOString(),
      },
    });
  }

  public retryJob(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    return this.updateJob(id, {
      status: 'queued',
      currentStage: 'Downloading',
      currentStageNumber: 1,
      progress: 0,
      error: null,
      startedAt: undefined,
      completedAt: undefined,
      processingTimeSeconds: undefined,
    });
  }

  public failJob(id: string, error: StructuredError): Job | undefined {
    return this.updateJob(id, {
      status: 'failed',
      error: {
        ...error,
        timestamp: new Date().toISOString(),
      },
    });
  }

  public getNextQueuedJob(): Job | undefined {
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') {
        return job;
      }
    }
    return undefined;
  }

  // --- VOICE PROFILES ---

  public getAllVoiceProfiles(): VoiceProfile[] {
    return Array.from(this.voiceProfiles.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getVoiceProfile(id: string): VoiceProfile | undefined {
    return this.voiceProfiles.get(id);
  }

  public createVoiceProfile(profile: Omit<VoiceProfile, 'id' | 'createdAt'>): VoiceProfile {
    const id = 'vox-prof-' + Date.now().toString(36);
    const newProfile: VoiceProfile = {
      ...profile,
      id,
      createdAt: new Date().toISOString(),
    };
    this.voiceProfiles.set(id, newProfile);
    return newProfile;
  }

  public deleteVoiceProfile(id: string): boolean {
    return this.voiceProfiles.delete(id);
  }

  // --- SETTINGS ---

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public getRawKeys(): { groqApiKey: string; geminiApiKey: string } {
    return {
      groqApiKey: this.rawGroqApiKey || process.env.GROQ_API_KEY || '',
      geminiApiKey: this.rawGeminiApiKey || process.env.GEMINI_API_KEY || '',
    };
  }

  public updateSettings(updates: Partial<AppSettings> & { groqApiKey?: string; geminiApiKey?: string }): AppSettings {
    if (updates.groqApiKey !== undefined && updates.groqApiKey !== '') {
      this.rawGroqApiKey = updates.groqApiKey;
      this.settings.groqApiKeyConfigured = true;
      this.settings.groqApiKeyMasked = this.maskKey(this.rawGroqApiKey);
    }

    if (updates.geminiApiKey !== undefined && updates.geminiApiKey !== '') {
      this.rawGeminiApiKey = updates.geminiApiKey;
      this.settings.geminiApiKeyConfigured = true;
      this.settings.geminiApiKeyMasked = this.maskKey(this.rawGeminiApiKey);
    }

    if (updates.defaultTtsEngine) {
      this.settings.defaultTtsEngine = updates.defaultTtsEngine;
    }
    if (updates.defaultEdgeVoice) {
      this.settings.defaultEdgeVoice = updates.defaultEdgeVoice;
    }
    if (updates.defaultTargetLanguage) {
      this.settings.defaultTargetLanguage = updates.defaultTargetLanguage;
    }
    if (updates.defaultVoxProfileId) {
      this.settings.defaultVoxProfileId = updates.defaultVoxProfileId;
    }
    const subUpdate = updates.defaultSubtitleConfig || updates.subtitleDefaults;
    if (subUpdate) {
      this.settings.defaultSubtitleConfig = {
        ...this.settings.defaultSubtitleConfig,
        ...subUpdate,
      };
      this.settings.subtitleDefaults = this.settings.defaultSubtitleConfig;
    }
    if (updates.workerSecretToken) {
      this.settings.workerSecretToken = updates.workerSecretToken;
    }

    this.emit('settings-updated', this.settings);
    return { ...this.settings };
  }
}

export const jobStore = new JobStoreManager();
