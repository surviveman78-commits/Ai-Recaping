import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Key,
  Type,
  Volume2,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Upload,
  Copy,
  Check,
  Sparkles,
  Save,
  Trash2,
  Plus,
  Mic,
  Languages,
  RotateCcw,
  Sliders,
  CheckCheck,
} from 'lucide-react';
import { AppSettings, SubtitleConfig, VoiceProfile, TtsEngine } from '../types/index.ts';
import {
  updateSettings,
  testGeminiApiKey,
  testGroqApiKey,
  uploadCustomFont,
} from '../services/api.ts';
import {
  getCompatibleEdgeVoices,
  resolveLanguageCode,
  isVoiceCompatibleWithLanguage,
  getDefaultVoiceForLanguage,
} from '../services/edgeVoices.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  voiceProfiles: VoiceProfile[];
  onSettingsUpdated: (updated: AppSettings) => void;
  initialTab?: 'keys' | 'tts' | 'subtitles' | 'kaggle';
  onDeleteVoiceProfile?: (id: string) => Promise<void>;
  onOpenVoiceModal?: () => void;
}

const LANGUAGE_PRESETS = [
  'English',
  'Italian',
  'Spanish',
  'French',
  'German',
  'Burmese',
  'Japanese',
  'Portuguese',
  'Hindi',
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  voiceProfiles,
  onSettingsUpdated,
  initialTab = 'keys',
  onDeleteVoiceProfile,
  onOpenVoiceModal,
}) => {
  const [activeTab, setActiveTab] = useState<'keys' | 'tts' | 'subtitles' | 'kaggle'>(initialTab);

  // Form states
  const [groqKey, setGroqKey] = useState(settings.groqApiKey || '');
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey || '');
  const [workerToken, setWorkerToken] = useState(settings.workerSecretToken || 'recap-kaggle-token-2026');
  const [defaultTtsEngine, setDefaultTtsEngine] = useState<TtsEngine>(settings.defaultTtsEngine);
  const [defaultEdgeVoice, setDefaultEdgeVoice] = useState(settings.defaultEdgeVoice);
  const [targetLanguage, setTargetLanguage] = useState(settings.defaultTargetLanguage || 'English');
  const [isCustomLang, setIsCustomLang] = useState(
    !LANGUAGE_PRESETS.includes(settings.defaultTargetLanguage || 'English')
  );
  const [customLangInput, setCustomLangInput] = useState(
    LANGUAGE_PRESETS.includes(settings.defaultTargetLanguage || 'English')
      ? ''
      : (settings.defaultTargetLanguage || '')
  );

  const [defaultVoxProfileId, setDefaultVoxProfileId] = useState(
    settings.defaultVoxProfileId || voiceProfiles[0]?.id || ''
  );

  // Subtitle config
  const [subtitleConfig, setSubtitleConfig] = useState<SubtitleConfig>(settings.defaultSubtitleConfig);
  const [fontUploading, setFontUploading] = useState(false);

  // Test statuses
  const [testingGroq, setTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Kaggle copy state
  const [copiedScript, setCopiedScript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Current active language for voice filtering
  const activeLanguage = isCustomLang ? (customLangInput.trim() || 'English') : targetLanguage;

  // Compute compatible Edge TTS voices dynamically based on activeLanguage
  const compatibleEdgeVoices = useMemo(() => {
    return getCompatibleEdgeVoices(activeLanguage);
  }, [activeLanguage]);

  const targetLangCode = useMemo(() => {
    return resolveLanguageCode(activeLanguage);
  }, [activeLanguage]);

  // Handle language change within TTS settings
  const handleSelectPresetLang = (lang: string) => {
    setIsCustomLang(false);
    setTargetLanguage(lang);

    // Auto-update Edge voice if not compatible
    if (!isVoiceCompatibleWithLanguage(defaultEdgeVoice, lang)) {
      const fallback = getDefaultVoiceForLanguage(lang);
      if (fallback) {
        setDefaultEdgeVoice(fallback.shortName);
      }
    }
  };

  const handleSelectCustomLang = () => {
    setIsCustomLang(true);
    if (customLangInput.trim()) {
      if (!isVoiceCompatibleWithLanguage(defaultEdgeVoice, customLangInput.trim())) {
        const fallback = getDefaultVoiceForLanguage(customLangInput.trim());
        if (fallback) {
          setDefaultEdgeVoice(fallback.shortName);
        }
      }
    }
  };

  // Keep defaultEdgeVoice compatible whenever compatibleEdgeVoices change
  useEffect(() => {
    if (compatibleEdgeVoices.length > 0) {
      const isCurrentValid = compatibleEdgeVoices.some(
        (v) => v.shortName === defaultEdgeVoice || v.name === defaultEdgeVoice
      );
      if (!isCurrentValid) {
        setDefaultEdgeVoice(compatibleEdgeVoices[0].shortName);
      }
    }
  }, [compatibleEdgeVoices, defaultEdgeVoice]);

  // Sync defaultVoxProfileId if empty
  useEffect(() => {
    if (!defaultVoxProfileId && voiceProfiles.length > 0) {
      setDefaultVoxProfileId(voiceProfiles[0].id);
    }
  }, [voiceProfiles, defaultVoxProfileId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      const updated = await updateSettings({
        groqApiKey: groqKey,
        geminiApiKey: geminiKey,
        workerSecretToken: workerToken,
        defaultTtsEngine,
        defaultEdgeVoice,
        defaultTargetLanguage: activeLanguage,
        defaultVoxProfileId,
        defaultSubtitleConfig: subtitleConfig,
      });
      onSettingsUpdated(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKeys = () => {
    setGroqKey('');
    setGeminiKey('');
    setGroqTestResult(null);
    setGeminiTestResult(null);
  };

  const handleTestGemini = async () => {
    try {
      setTestingGemini(true);
      setGeminiTestResult(null);
      const res = await testGeminiApiKey(geminiKey || undefined);
      setGeminiTestResult(res);
    } catch (e: any) {
      setGeminiTestResult({ success: false, message: e.message });
    } finally {
      setTestingGemini(false);
    }
  };

  const handleTestGroq = async () => {
    try {
      setTestingGroq(true);
      setGroqTestResult(null);
      const res = await testGroqApiKey(groqKey || undefined);
      setGroqTestResult(res);
    } catch (e: any) {
      setGroqTestResult({ success: false, message: e.message });
    } finally {
      setTestingGroq(false);
    }
  };

  const handleFontUpload = async (file: File) => {
    try {
      setFontUploading(true);
      const res = await uploadCustomFont(file);
      setSubtitleConfig((prev) => ({
        ...prev,
        fontFamily: res.fontName,
        customFontUrl: res.url,
      }));
    } catch (e: any) {
      alert(e.message || 'Failed to upload custom font file');
    } finally {
      setFontUploading(false);
    }
  };

  const kaggleSnippet = `# ==============================================================================
# Movie Recap Studio - Kaggle Worker Launch Script
# Run in Kaggle Notebook with GPU Accelerator (T4 x2 or P100)
# ==============================================================================
!git clone https://github.com/aistudio/movie-recap-studio.git recap_worker
%cd recap_worker
!pip install -q -r requirements-worker.txt

# Run worker agent connected to AI Studio backend
import os
os.environ["RECAP_STUDIO_HOST"] = "${window.location.origin}"
os.environ["RECAP_WORKER_TOKEN"] = "${workerToken}"
os.environ["TTS_ENGINE_DEFAULT"] = "${defaultTtsEngine}"

!python -m worker.agent
`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] liquid-glass-modal rounded-3xl border border-slate-200/90 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-slate-200/80 flex items-center justify-between bg-white/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center border border-violet-200/60 shadow-xs">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Studio Settings</h3>
              <p className="text-xs text-slate-500">
                Configure API keys, language, TTS voice defaults, and Kaggle worker cluster
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 px-6 pt-3.5 pb-2 bg-slate-50/70 border-b border-slate-200/60 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'keys'
                ? 'bg-white text-violet-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            API Keys
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tts')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'tts'
                ? 'bg-white text-violet-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            TTS Configuration
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('subtitles')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'subtitles'
                ? 'bg-white text-violet-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Type className="w-3.5 h-3.5" />
            Subtitle Typography
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('kaggle')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'kaggle'
                ? 'bg-white text-violet-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Worker / System
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* ======================================================== */}
          {/* TAB 1: API KEYS (Groq, Gemini, Worker Token, Clear/Test) */}
          {/* ======================================================== */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">API Credentials</h4>
                  <p className="text-xs text-slate-500">
                    Configure your AI provider keys for transcription and recap generation
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearKeys}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 text-xs font-semibold transition-colors cursor-pointer border border-slate-200"
                  title="Clear API key fields"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>

              {/* Groq Whisper API Key */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-violet-600" />
                      Groq API Key (Whisper Large v3)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Used for lightning-fast speech-to-text with segment timestamps
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGroqKey('')}
                      className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleTestGroq}
                      disabled={testingGroq}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {testingGroq ? 'Testing...' : 'Test'}
                    </button>
                  </div>
                </div>
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl liquid-glass-input text-slate-900 focus:outline-none"
                />
                {groqTestResult && (
                  <div
                    className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium ${
                      groqTestResult.success
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {groqTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{groqTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Gemini API Key */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-violet-600" />
                      Gemini API Key (Gemini 3.8 Flash)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Used server-side for cinematic movie recap narrative translation and rewriting
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGeminiKey('')}
                      className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleTestGemini}
                      disabled={testingGemini}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {testingGemini ? 'Testing...' : 'Test'}
                    </button>
                  </div>
                </div>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl liquid-glass-input text-slate-900 focus:outline-none"
                />
                {geminiTestResult && (
                  <div
                    className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium ${
                      geminiTestResult.success
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {geminiTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{geminiTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Worker Secret Token */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-2">
                <h4 className="text-xs font-bold text-slate-900">
                  Worker Secret Auth Token
                </h4>
                <p className="text-[11px] text-slate-500">
                  Shared bearer token to authenticate Kaggle GPU worker heartbeats and job claiming
                </p>
                <input
                  type="text"
                  value={workerToken}
                  onChange={(e) => setWorkerToken(e.target.value)}
                  placeholder="e.g. recap-kaggle-token-2026"
                  className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl liquid-glass-input text-slate-900 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: TTS CONFIGURATION (Language, Engine, Edge/VoxCPM2)*/}
          {/* ======================================================== */}
          {activeTab === 'tts' && (
            <div className="space-y-6">
              {/* 1. TARGET RECAP LANGUAGE (Moved into Settings -> TTS) */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Languages className="w-4 h-4 text-violet-600" />
                      Target Recap Language
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Select output narrative language for script translation and voice narration.
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-200">
                    {activeLanguage}
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {LANGUAGE_PRESETS.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => handleSelectPresetLang(lang)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        !isCustomLang && targetLanguage === lang
                          ? 'bg-violet-600 text-white shadow-xs'
                          : 'bg-slate-100/90 text-slate-700 hover:bg-slate-200/90 border border-slate-200/60'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={handleSelectCustomLang}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isCustomLang
                        ? 'bg-violet-600 text-white shadow-xs'
                        : 'bg-slate-100/90 text-slate-700 hover:bg-slate-200/90 border border-slate-200/60'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {/* Custom Language Text Input */}
                {isCustomLang && (
                  <div className="pt-2">
                    <input
                      type="text"
                      value={customLangInput}
                      onChange={(e) => {
                        setCustomLangInput(e.target.value);
                        if (e.target.value.trim()) {
                          if (!isVoiceCompatibleWithLanguage(defaultEdgeVoice, e.target.value.trim())) {
                            const fallback = getDefaultVoiceForLanguage(e.target.value.trim());
                            if (fallback) setDefaultEdgeVoice(fallback.shortName);
                          }
                        }
                      }}
                      placeholder="Type custom language (e.g. Thai, Arabic, Vietnamese)..."
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* 2. TTS ENGINE SELECTION */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">TTS Narration Engine</h4>
                    <p className="text-[11px] text-slate-500">
                      Select speech synthesis engine for movie narration
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-200">
                    Global Setting
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setDefaultTtsEngine('edge-tts')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      defaultTtsEngine === 'edge-tts'
                        ? 'bg-violet-50/80 border-violet-600 ring-2 ring-violet-500/10'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-slate-900">Microsoft Edge TTS</div>
                      {defaultTtsEngine === 'edge-tts' && (
                        <CheckCheck className="w-4 h-4 text-violet-600" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Fast multi-language neural broadcast narration (CPU/Cloud)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDefaultTtsEngine('voxcpm2')}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      defaultTtsEngine === 'voxcpm2'
                        ? 'bg-violet-50/80 border-violet-600 ring-2 ring-violet-500/10'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-slate-900">VoxCPM2 (GPU Worker)</div>
                      {defaultTtsEngine === 'voxcpm2' && (
                        <CheckCheck className="w-4 h-4 text-violet-600" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Zero-shot custom voice cloning on Kaggle GPU
                    </div>
                  </button>
                </div>
              </div>

              {/* 3. CONDITIONAL SUBSECTION: MICROSOFT EDGE TTS */}
              {defaultTtsEngine === 'edge-tts' && (
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4">
                  {/* Voice Language / Compatibility Indicator */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4 text-violet-600" />
                      <div>
                        <span className="text-xs font-bold text-slate-900">
                          Voice Language / Compatibility:
                        </span>{' '}
                        <span className="text-xs font-semibold text-violet-700">
                          {activeLanguage}
                        </span>
                        {targetLangCode && (
                          <span className="text-[11px] text-slate-500 ml-1">
                            ({targetLangCode.toUpperCase()})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {compatibleEdgeVoices.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          {compatibleEdgeVoices.length} Neural Voices Available
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          No Microsoft Voice Found
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Voice Dropdown */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800">
                      Edge TTS Voice
                    </label>

                    {compatibleEdgeVoices.length > 0 ? (
                      <select
                        id="edge-tts-voice-select"
                        value={defaultEdgeVoice}
                        onChange={(e) => setDefaultEdgeVoice(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 focus:outline-none bg-white font-medium"
                      >
                        {compatibleEdgeVoices.map((v) => (
                          <option key={v.shortName} value={v.shortName}>
                            {v.friendlyName} [{v.locale} - {v.gender}]
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-800 text-xs font-medium space-y-1">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>No compatible Microsoft Edge TTS voice found for this language.</span>
                        </div>
                        <p className="text-[11px] text-amber-700 pl-6">
                          Please select a language with Microsoft Neural voice support (English, Italian, Spanish, French, German, Burmese, Japanese, Portuguese, Hindi, etc.) or switch to VoxCPM2 zero-shot voice cloning.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. CONDITIONAL SUBSECTION: VOXCPM2 (GPU WORKER) */}
              {defaultTtsEngine === 'voxcpm2' && (
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Mic className="w-4 h-4 text-violet-600" />
                        VoxCPM2 Voice Profiles
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Zero-shot voice cloning with 5–15 second audio samples
                      </p>
                    </div>

                    {onOpenVoiceModal && (
                      <button
                        type="button"
                        onClick={onOpenVoiceModal}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold transition-colors cursor-pointer border border-violet-200/80 shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        + Upload Custom Voice
                      </button>
                    )}
                  </div>

                  {/* Active Profile Dropdown */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800">
                      Default Voice Profile
                    </label>
                    <select
                      value={defaultVoxProfileId}
                      onChange={(e) => setDefaultVoxProfileId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 focus:outline-none bg-white font-medium"
                    >
                      {voiceProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.styleSettings.emotion || 'Natural'}{p.sampleRate ? ` • ${(p.sampleRate / 1000).toFixed(0)}kHz` : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Manage Voice Profiles List */}
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Manage Voice Profiles ({voiceProfiles.length})
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {voiceProfiles.map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0 flex-1 mr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 truncate">{p.name}</span>
                              <span className="text-slate-400 text-[11px]">
                                ({p.styleSettings.emotion || 'Natural'})
                              </span>
                              {defaultVoxProfileId === p.id && (
                                <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.2 rounded">
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 italic mt-0.5 truncate">
                              "{p.referenceText}"
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {onDeleteVoiceProfile && (
                              <button
                                type="button"
                                onClick={() => onDeleteVoiceProfile(p.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Delete Profile"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: SUBTITLES (Typography, Live Preview, Font Upload) */}
          {/* ======================================================== */}
          {activeTab === 'subtitles' && (
            <div className="space-y-6">
              {/* Interactive Live Subtitle Preview */}
              <div className="liquid-glass-card rounded-2xl p-5 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Live SRT Subtitle Rendering Preview</span>
                  <span className="text-[11px] text-slate-400">Exact video overlay mockup</span>
                </div>

                <div className="relative w-full h-36 rounded-xl bg-slate-900 overflow-hidden flex items-center justify-center p-4 border border-slate-800 shadow-inner">
                  <div
                    className="text-center font-bold px-4 py-2 transition-all select-none"
                    style={{
                      fontFamily: subtitleConfig.fontFamily,
                      fontSize: `${Math.min(26, subtitleConfig.fontSize)}px`,
                      color: subtitleConfig.fontColor,
                      textShadow: `${subtitleConfig.shadowOffset}px ${subtitleConfig.shadowOffset}px ${subtitleConfig.shadowBlur}px ${subtitleConfig.shadowColor}`,
                      WebkitTextStroke: `${subtitleConfig.outlineWidth}px ${subtitleConfig.outlineColor}`,
                    }}
                  >
                    "The classified anomaly in sector nine is fluctuating beyond baseline."
                  </div>
                </div>
              </div>

              {/* Font Family & Custom TTF Upload */}
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    Font Family Selection
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer transition-colors">
                    <Upload className="w-3 h-3" />
                    {fontUploading ? 'Uploading...' : 'Upload .TTF/.OTF'}
                    <input
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFontUpload(file);
                      }}
                      className="hidden"
                      disabled={fontUploading}
                    />
                  </label>
                </div>

                <select
                  value={subtitleConfig.fontFamily}
                  onChange={(e) => setSubtitleConfig((p) => ({ ...p, fontFamily: e.target.value }))}
                  className="w-full px-3.5 py-2 text-xs rounded-lg liquid-glass-input text-slate-900 focus:outline-none bg-white font-medium"
                >
                  <option value="Plus Jakarta Sans">Plus Jakarta Sans (Modern Clean)</option>
                  <option value="Arial">Arial (Standard Sans)</option>
                  <option value="Impact">Impact (Bold Cinematic)</option>
                  <option value="Trebuchet MS">Trebuchet MS (High Readability)</option>
                  <option value="Verdana">Verdana (Clear Subtitle)</option>
                </select>
              </div>

              {/* Sliders: Size, Outline, Shadow */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700 block">
                    Font Size ({subtitleConfig.fontSize}px)
                  </span>
                  <input
                    type="range"
                    min="16"
                    max="48"
                    value={subtitleConfig.fontSize}
                    onChange={(e) =>
                      setSubtitleConfig((p) => ({ ...p, fontSize: parseInt(e.target.value, 10) }))
                    }
                    className="w-full accent-violet-600 cursor-pointer"
                  />
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700 block">
                    Outline Width ({subtitleConfig.outlineWidth}px)
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    value={subtitleConfig.outlineWidth}
                    onChange={(e) =>
                      setSubtitleConfig((p) => ({ ...p, outlineWidth: parseInt(e.target.value, 10) }))
                    }
                    className="w-full accent-violet-600 cursor-pointer"
                  />
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700 block">
                    Shadow Depth ({subtitleConfig.shadowOffset}px)
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    value={subtitleConfig.shadowOffset}
                    onChange={(e) =>
                      setSubtitleConfig((p) => ({ ...p, shadowOffset: parseInt(e.target.value, 10) }))
                    }
                    className="w-full accent-violet-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: WORKER / SYSTEM CONFIGURATION                     */}
          {/* ======================================================== */}
          {activeTab === 'kaggle' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-slate-900 text-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-violet-400" />
                    <span className="text-xs font-mono font-bold text-violet-300">
                      Kaggle Worker Runner Script
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(kaggleSnippet);
                      setCopiedScript(true);
                      setTimeout(() => setCopiedScript(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 transition-colors cursor-pointer"
                  >
                    {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedScript ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto p-2 bg-black/40 rounded-lg whitespace-pre">
                  {kaggleSnippet}
                </pre>
              </div>

              {/* Storage Architecture Overview */}
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-900">Workspace & Storage Architecture</h4>
                <p className="text-slate-500 text-[11px]">
                  Each job maintains an isolated workspace directory with strict subfolder separation:
                </p>
                <div className="font-mono text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-700">
                  workspace/jobs/&lt;job-id&gt;/<br />
                  &nbsp;&nbsp;├── source/ (movie.mp4, metadata.json)<br />
                  &nbsp;&nbsp;├── audio/ (source.wav, metadata.json)<br />
                  &nbsp;&nbsp;├── transcript/ (original.json, recap.json)<br />
                  &nbsp;&nbsp;├── tts/ (segments.json, segment audio clips)<br />
                  &nbsp;&nbsp;├── timeline/ (timeline.json)<br />
                  &nbsp;&nbsp;├── subtitles/ (subtitles.srt)<br />
                  &nbsp;&nbsp;└── output/ (final_recap.mp4)
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer: Save Button */}
        <div className="px-6 py-4 border-t border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {saveSuccess && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Settings saved successfully
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              id="save-settings-btn"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-md shadow-violet-500/20 hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
