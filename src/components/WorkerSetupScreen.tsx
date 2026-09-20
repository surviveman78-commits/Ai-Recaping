import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Terminal,
  RefreshCw,
  Sparkles,
  Server,
  Layers,
  FileVideo,
  Mic,
  Volume2,
  Sliders,
  Maximize2,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { WorkerInitializationStatus, WorkerInitStep } from '../types/index.ts';

interface WorkerSetupScreenProps {
  status: WorkerInitializationStatus | null;
  loading: boolean;
  isInitializing: boolean;
  isReady: boolean;
  isFailed: boolean;
  onInitialize: () => void;
  onRetry: () => void;
  onOpenDashboard: () => void;
}

export const WorkerSetupScreen: React.FC<WorkerSetupScreenProps> = ({
  status,
  loading,
  isInitializing,
  isReady,
  isFailed,
  onInitialize,
  onRetry,
  onOpenDashboard,
}) => {
  const [showLogs, setShowLogs] = useState<boolean>(true);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [status?.logs, autoScroll]);

  const env = status?.environment;
  const capabilities = status?.capabilities;
  const progress = status?.progress ?? 0;
  const currentStep = status?.currentStep || 'Ready for Initialization';

  const gpuName = env?.gpuName || 'NVIDIA GPU (Kaggle)';
  const vramDisplay = env?.gpuVramMb ? `${(env.gpuVramMb / 1024).toFixed(1)} GB VRAM` : '16.0 GB VRAM';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex flex-col justify-between selection:bg-violet-500/20 selection:text-violet-900">
      {/* Top Subtle Bar */}
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20 text-white">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-slate-900 text-lg">MOVIE RECAP STUDIO</span>
              <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200/60">
                Worker Setup
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
              <span
                className={`w-2 h-2 rounded-full ${
                  isReady ? 'bg-emerald-500 animate-pulse' : isInitializing ? 'bg-violet-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span>
                {isReady ? 'Worker Online' : isInitializing ? 'Initializing...' : isFailed ? 'Initialization Failed' : 'Not Ready'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Setup Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 flex flex-col justify-center">
        {/* 1. STATE: READY SCREEN */}
        {isReady && (
          <div className="bg-white/90 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/50 p-8 sm:p-10 space-y-8 animate-fadeIn">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mb-2 shadow-sm">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Worker Ready ✓</h1>
              <p className="text-slate-600 max-w-md mx-auto text-sm leading-relaxed">
                Your Kaggle GPU worker has been validated, dependencies are satisfied, and VoxCPM2 resident models are loaded in memory.
              </p>
            </div>

            {/* Hardware & Environment Verification Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 text-center space-y-1">
                <div className="text-xs font-medium text-slate-500">Kaggle GPU</div>
                <div className="text-sm font-semibold text-slate-900 truncate" title={gpuName}>
                  {gpuName}
                </div>
                <div className="text-xs text-slate-400">{vramDisplay}</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 text-center space-y-1">
                <div className="text-xs font-medium text-slate-500">CUDA Runtime</div>
                <div className="text-sm font-semibold text-emerald-600 flex items-center justify-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>{env?.cudaAvailable ? 'Available' : 'CPU Mode'}</span>
                </div>
                <div className="text-xs text-slate-400">{env?.cudaVersion || 'PyTorch 2.x'}</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 text-center space-y-1">
                <div className="text-xs font-medium text-slate-500">FFmpeg Codec</div>
                <div className="text-sm font-semibold text-emerald-600 flex items-center justify-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Ready</span>
                </div>
                <div className="text-xs text-slate-400">{capabilities?.nvenc ? 'NVENC H.264' : 'libx264 Codec'}</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 text-center space-y-1">
                <div className="text-xs font-medium text-slate-500">VoxCPM2 Neural TTS</div>
                <div className="text-sm font-semibold text-emerald-600 flex items-center justify-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Resident</span>
                </div>
                <div className="text-xs text-slate-400">Zero-Shot Cloning</div>
              </div>
            </div>

            {/* Pipeline Capabilities Badges */}
            <div className="border border-slate-200/80 rounded-xl p-4 bg-slate-50/50 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Verified Pipeline Capabilities</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Whisper ASR</span>
                </span>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Edge TTS</span>
                </span>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>VoxCPM2 Voice Cloning</span>
                </span>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>FFmpeg Timeline Muxer</span>
                </span>
                {capabilities?.nvenc && (
                  <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-indigo-100/70 text-indigo-800 border border-indigo-200">
                    <Check className="w-3.5 h-3.5 text-indigo-600" />
                    <span>NVENC GPU Acceleration</span>
                  </span>
                )}
              </div>
            </div>

            {/* Launch Dashboard Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={onOpenDashboard}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-base shadow-lg shadow-violet-500/25 transition-all flex items-center justify-center space-x-2.5 active:scale-[0.99] cursor-pointer"
              >
                <span>Open Movie Recap Studio</span>
                <ArrowRight className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={onRetry}
                className="w-full sm:w-auto px-5 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-all flex items-center justify-center space-x-2 border border-slate-200 active:scale-[0.99] cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-slate-500" />
                <span>Re-check Environment</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. STATE: FAILURE SCREEN */}
        {isFailed && (
          <div className="bg-white/90 backdrop-blur-md border border-rose-200 rounded-2xl shadow-xl shadow-rose-100/50 p-8 sm:p-10 space-y-6 animate-fadeIn">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mb-1">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Worker Initialization Failed</h1>
              <p className="text-slate-600 text-sm">
                An issue was encountered during worker setup. Completed steps have been saved and will not need to be re-run.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200/80 space-y-2 text-sm">
              <div className="flex items-center justify-between text-rose-900 font-semibold text-xs tracking-wider uppercase">
                <span>Failing Stage: {status?.error?.stage || currentStep}</span>
                <span>Error Code: {status?.error?.code || 'ERROR'}</span>
              </div>
              <div className="font-mono text-xs text-rose-800 bg-rose-100/60 p-3 rounded-lg break-all">
                {status?.error?.message || 'An unexpected error occurred during worker initialization.'}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onRetry}
                disabled={loading}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm shadow-md shadow-violet-500/20 transition-all flex items-center justify-center space-x-2 active:scale-[0.99] cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Retry Initialization</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLogs((prev) => !prev)}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-all flex items-center justify-center space-x-2 border border-slate-200 cursor-pointer"
              >
                <Terminal className="w-4 h-4 text-slate-500" />
                <span>{showLogs ? 'Hide Logs' : 'View Logs'}</span>
              </button>
            </div>
          </div>
        )}

        {/* 3. STATE: NOT READY (PRE-INIT) OR IN-PROGRESS INITIALIZING */}
        {!isReady && !isFailed && (
          <div className="bg-white/90 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/50 p-8 sm:p-10 space-y-8 animate-fadeIn">
            {/* Header / Intro */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                    {isInitializing ? 'Verifying Kaggle GPU Worker...' : 'Kaggle GPU Worker Setup'}
                  </h1>
                  <p className="text-slate-600 text-sm max-w-xl leading-relaxed">
                    {isInitializing
                      ? 'Automated environment verification in progress. Detecting CUDA, verifying dependencies, loading resident VoxCPM2 models, and validating pipeline.'
                      : 'The worker needs to verify its required packages, models and GPU environment before the Movie Recap Studio can be opened.'}
                  </p>
                </div>

                <div className="hidden sm:flex flex-col items-end text-xs text-slate-500 space-y-1">
                  <div className="flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5 text-violet-600" />
                    <span className="font-semibold text-slate-700">Kaggle GPU Worker</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400">ID: {status?.workerId || 'kaggle-gpu-worker'}</div>
                </div>
              </div>

              {/* Status Bar */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 font-medium text-slate-700">
                  <span className="text-slate-400">Worker:</span>
                  <span className="font-semibold text-slate-900">Kaggle GPU Worker</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400">Status:</span>
                  <span className={`font-semibold ${isInitializing ? 'text-violet-600' : 'text-slate-500'}`}>
                    {isInitializing ? currentStep : 'Ready for initialization'}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Trigger for Pre-Init State */}
            {!isInitializing && (
              <div className="py-4 text-center space-y-4">
                <button
                  type="button"
                  onClick={onInitialize}
                  disabled={loading}
                  className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-base shadow-lg shadow-violet-500/25 transition-all flex items-center justify-center space-x-2.5 mx-auto active:scale-[0.99] cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Initialize Worker</span>
                </button>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Click to detect GPU, verify packages, load resident VoxCPM2 models into memory, and validate the video recap pipeline.
                </p>
              </div>
            )}

            {/* Progress Bar & Steps Checklist for In-Progress State */}
            {isInitializing && (
              <div className="space-y-6">
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-violet-700 flex items-center space-x-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{currentStep}</span>
                    </span>
                    <span className="font-mono text-slate-700">{progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                    <div
                      className="bg-gradient-to-r from-violet-600 to-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Steps List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                  {status?.steps.map((step) => {
                    const isCompleted = step.status === 'completed';
                    const isRunning = step.status === 'running';
                    const isSkipped = step.status === 'skipped';
                    const isStepFailed = step.status === 'failed';

                    return (
                      <div
                        key={step.id}
                        className={`flex items-center space-x-2.5 p-2.5 rounded-lg border text-xs transition-colors ${
                          isRunning
                            ? 'bg-violet-50/80 border-violet-300 text-violet-950 font-medium'
                            : isCompleted
                            ? 'bg-slate-50/60 border-slate-200 text-slate-700'
                            : isSkipped
                            ? 'bg-slate-50/40 border-slate-200/60 text-slate-400'
                            : isStepFailed
                            ? 'bg-rose-50 border-rose-200 text-rose-800 font-medium'
                            : 'bg-white border-slate-100 text-slate-400'
                        }`}
                      >
                        <div className="flex-shrink-0">
                          {isCompleted && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                          {isRunning && <RefreshCw className="w-4 h-4 text-violet-600 animate-spin" />}
                          {isSkipped && <Check className="w-4 h-4 text-slate-400" />}
                          {isStepFailed && <AlertCircle className="w-4 h-4 text-rose-600" />}
                          {step.status === 'pending' && <Clock className="w-4 h-4 text-slate-300" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{step.name}</div>
                          {step.details && <div className="text-[11px] text-slate-500 truncate">{step.details}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live Logs Terminal Box */}
        {(isInitializing || isFailed || (status?.logs && status.logs.length > 0)) && (
          <div className="mt-6 bg-slate-900 text-slate-200 rounded-xl shadow-lg border border-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 font-mono">
                <Terminal className="w-3.5 h-3.5 text-violet-400" />
                <span className="font-semibold text-slate-300">Live Worker Logs</span>
                <span className="text-slate-500">({status?.logs.length || 0} events)</span>
              </div>
              <div className="flex items-center space-x-3">
                <label className="flex items-center space-x-1.5 text-slate-400 cursor-pointer hover:text-slate-200 select-none">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-violet-500 focus:ring-0 w-3 h-3"
                  />
                  <span>Auto-scroll</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowLogs((prev) => !prev)}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {showLogs && (
              <div className="p-4 font-mono text-xs max-h-56 overflow-y-auto space-y-1 select-text">
                {status?.logs && status.logs.length > 0 ? (
                  status.logs.map((l, i) => (
                    <div
                      key={i}
                      className={`leading-relaxed ${
                        l.level === 'error'
                          ? 'text-rose-400'
                          : l.level === 'warn'
                          ? 'text-amber-300'
                          : l.level === 'success'
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }`}
                    >
                      <span className="text-slate-500 mr-2">{l.timestamp}</span>
                      <span>{l.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 italic">No logs recorded yet. Waiting for initialization...</div>
                )}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 bg-white/50 py-4 text-center text-xs text-slate-400">
        Movie Recap Studio · Automated Kaggle Worker Initialization Engine
      </footer>
    </div>
  );
};
