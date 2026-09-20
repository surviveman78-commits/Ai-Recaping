import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { MovieUrlInput } from './components/MovieUrlInput.tsx';
import { ProcessingQueue } from './components/ProcessingQueue.tsx';
import { TimelineInspectorModal } from './components/TimelineInspectorModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { VoiceUploadModal } from './components/VoiceUploadModal.tsx';
import { WorkerSetupScreen } from './components/WorkerSetupScreen.tsx';
import { useJobs } from './hooks/useJobs.ts';
import { useWorkerStatus } from './hooks/useWorkerStatus.ts';
import { useWorkerInitialization } from './hooks/useWorkerInitialization.ts';
import {
  fetchVoiceProfiles,
  fetchSettings,
  createJob,
  cancelJob,
  retryJob,
  deleteVoiceProfile,
} from './services/api.ts';
import {
  isVoiceCompatibleWithLanguage,
  getDefaultVoiceForLanguage,
} from './services/edgeVoices.ts';
import { Job, VoiceProfile, AppSettings, AudioMode } from './types/index.ts';

const DEFAULT_SETTINGS: AppSettings = {
  groqApiKeyConfigured: false,
  geminiApiKeyConfigured: false,
  groqApiKey: '',
  geminiApiKey: '',
  workerSecretToken: 'recap-kaggle-token-2026',
  defaultTtsEngine: 'edge-tts',
  defaultEdgeVoice: 'en-US-ChristopherNeural',
  defaultSubtitleConfig: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 24,
    fontColor: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 3,
    shadowOffset: 2,
    shadowBlur: 4,
    shadowColor: 'rgba(0,0,0,0.8)',
    position: 'bottom',
    bottomMargin: 48,
  },
};

export default function App() {
  const { jobs, loading: jobsLoading, refreshJobs } = useJobs();
  const { status: workerStatus } = useWorkerStatus();
  const {
    status: initStatus,
    loading: initLoading,
    isInitializing,
    isReady: initReady,
    isFailed: initFailed,
    startInitialization,
    retryInitialization,
  } = useWorkerInitialization();

  const [setupDismissed, setSetupDismissed] = useState<boolean>(() => {
    return localStorage.getItem('recap_worker_setup_dismissed') === 'true';
  });
  const [showSetupView, setShowSetupView] = useState<boolean>(false);

  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'keys' | 'tts' | 'subtitles' | 'kaggle'>('keys');
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [inspectorJob, setInspectorJob] = useState<Job | null>(null);

  // Load initial settings and voice profiles
  useEffect(() => {
    fetchVoiceProfiles()
      .then(setVoiceProfiles)
      .catch((e) => console.warn('Could not load voice profiles:', e));

    fetchSettings()
      .then(setSettings)
      .catch((e) => console.warn('Could not load settings:', e));
  }, []);

  // Handler: Add Job to Queue (from URL or Uploaded Video)
  const handleAddJob = async (params: {
    sourceType: 'url' | 'upload';
    sourceUrl?: string;
    uploadedFileId?: string;
    uploadedFileName?: string;
    uploadedFileSize?: number;
    customTitle?: string;
    targetLanguage?: string;
    audioMode?: AudioMode;
  }) => {
    // If worker is not currently online, auto-simulate so the user can see all stages live
    const autoSimulate = !workerStatus.isOnline;
    const lang = params.targetLanguage || settings.defaultTargetLanguage || 'English';

    // Snapshot TTS settings
    let resolvedEdgeVoice = settings.defaultEdgeVoice;
    if (settings.defaultTtsEngine === 'edge-tts') {
      if (!isVoiceCompatibleWithLanguage(resolvedEdgeVoice, lang)) {
        const fallback = getDefaultVoiceForLanguage(lang);
        if (fallback) {
          resolvedEdgeVoice = fallback.shortName;
        }
      }
    }

    await createJob({
      sourceType: params.sourceType,
      sourceUrl: params.sourceUrl,
      uploadedFileId: params.uploadedFileId,
      uploadedFileName: params.uploadedFileName,
      uploadedFileSize: params.uploadedFileSize,
      audioMode: params.audioMode || 'recap',
      selectedTtsEngine: settings.defaultTtsEngine,
      voiceProfileId:
        settings.defaultTtsEngine === 'voxcpm2'
          ? settings.defaultVoxProfileId || voiceProfiles[0]?.id
          : undefined,
      edgeVoice: settings.defaultTtsEngine === 'edge-tts' ? resolvedEdgeVoice : undefined,
      customTitle: params.customTitle,
      targetLanguage: lang,
      subtitleConfig: settings.defaultSubtitleConfig,
      autoSimulate,
    });

    refreshJobs();
  };

  // Handler: Cancel Job
  const handleCancelJob = async (id: string) => {
    try {
      await cancelJob(id);
      refreshJobs();
    } catch (e: any) {
      alert(e.message || 'Failed to cancel job');
    }
  };

  // Handler: Retry Job
  const handleRetryJob = async (id: string) => {
    try {
      await retryJob(id);
      refreshJobs();
    } catch (e: any) {
      alert(e.message || 'Failed to retry job');
    }
  };

  // Handler: Delete Voice Profile
  const handleDeleteVoiceProfile = async (id: string) => {
    try {
      await deleteVoiceProfile(id);
      setVoiceProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      alert(e.message || 'Failed to delete voice profile');
    }
  };

  // Open Kaggle Guide
  const handleOpenKaggleGuide = () => {
    setSettingsTab('kaggle');
    setIsSettingsOpen(true);
  };

  // Open Inspector
  const handleOpenInspector = (job: Job) => {
    setInspectorJob(job);
  };

  // Enter Studio Dashboard from Worker Setup Screen
  const handleOpenDashboardFromSetup = () => {
    setSetupDismissed(true);
    localStorage.setItem('recap_worker_setup_dismissed', 'true');
    setShowSetupView(false);
  };

  // Dashboard blocked until worker initialization is complete:
  const isDashboardBlocked = !initReady || !setupDismissed || showSetupView;

  if (isDashboardBlocked) {
    return (
      <WorkerSetupScreen
        status={initStatus}
        loading={initLoading}
        isInitializing={isInitializing}
        isReady={initReady}
        isFailed={initFailed}
        onInitialize={startInitialization}
        onRetry={retryInitialization}
        onOpenDashboard={handleOpenDashboardFromSetup}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex flex-col selection:bg-violet-500/20 selection:text-violet-900">
      {/* Top Navigation Header */}
      <Header
        workerStatus={workerStatus}
        onOpenSettings={() => {
          setSettingsTab('keys');
          setIsSettingsOpen(true);
        }}
        onOpenKaggleGuide={handleOpenKaggleGuide}
        onOpenWorkerSetup={() => setShowSetupView(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Movie Source Input (URL or Upload) with Unified Add to Queue */}
        <section aria-label="Create Recap Job">
          <MovieUrlInput onAddJob={handleAddJob} />
        </section>

        {/* Processing Queue & Dynamic Timeline Cards */}
        <section aria-label="Processing Queue">
          <ProcessingQueue
            jobs={jobs}
            loading={jobsLoading}
            onCancel={handleCancelJob}
            onRetry={handleRetryJob}
            onOpenDetails={handleOpenInspector}
            onRefresh={refreshJobs}
          />
        </section>
      </main>

      {/* Modals */}
      {/* 1. Timeline Reconstruction Inspector Modal */}
      <TimelineInspectorModal
        job={inspectorJob}
        onClose={() => setInspectorJob(null)}
      />

      {/* 2. Studio Settings Modal (API Keys, Centralized TTS, Dynamic Voice Filtering, Kaggle) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        voiceProfiles={voiceProfiles}
        initialTab={settingsTab}
        onSettingsUpdated={(updated) => setSettings(updated)}
        onDeleteVoiceProfile={handleDeleteVoiceProfile}
        onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
      />

      {/* 3. VoxCPM2 Voice Profile Upload Modal */}
      <VoiceUploadModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onCreated={(newProfile) => {
          setVoiceProfiles((prev) => [newProfile, ...prev]);
        }}
      />
    </div>
  );
}
