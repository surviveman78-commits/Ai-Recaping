import React from 'react';
import { Settings, Cpu, Terminal, Clapperboard, Sparkles } from 'lucide-react';
import { GpuWorkerStatus } from '../types/index.ts';

interface HeaderProps {
  workerStatus: GpuWorkerStatus;
  onOpenSettings: () => void;
  onOpenKaggleGuide: () => void;
  onOpenWorkerSetup?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workerStatus,
  onOpenSettings,
  onOpenKaggleGuide,
  onOpenWorkerSetup,
}) => {
  // Determine badge colors for the 4 status states
  const getStatusBadge = () => {
    switch (workerStatus.state) {
      case 'Worker Online':
        return {
          bg: 'bg-emerald-50 border-emerald-200/80 text-emerald-800',
          dot: 'bg-emerald-500 animate-pulse',
          iconColor: 'text-emerald-600',
        };
      case 'Processing':
        return {
          bg: 'bg-violet-50 border-violet-200/80 text-violet-800',
          dot: 'bg-violet-600 animate-ping',
          iconColor: 'text-violet-600',
        };
      case 'Queue Busy':
        return {
          bg: 'bg-amber-50 border-amber-200/80 text-amber-800',
          dot: 'bg-amber-500 animate-pulse',
          iconColor: 'text-amber-600',
        };
      case 'Worker Offline':
      default:
        return {
          bg: 'bg-slate-100 border-slate-200 text-slate-700',
          dot: 'bg-slate-400',
          iconColor: 'text-slate-500',
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <header className="sticky top-0 z-30 w-full liquid-glass border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand & Logo */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-purple-500 flex items-center justify-center shadow-md shadow-violet-500/20 text-white">
            <Clapperboard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Movie Recap Studio
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100/70 text-violet-700 border border-violet-200/50">
                <Sparkles className="w-3 h-3" />
                Dynamic Timeline
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden md:block">
              Kaggle GPU Worker Architecture · Whisper · Gemini · VoxCPM2 & Edge TTS
            </p>
          </div>
        </div>

        {/* Right Actions: Worker Status & Modals */}
        <div className="flex items-center gap-3">
          {/* Worker Status Pill */}
          <button
            onClick={onOpenKaggleGuide}
            title="Click to view Kaggle GPU worker connection details"
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all shadow-xs hover:shadow-sm cursor-pointer ${badge.bg}`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`rounded-full h-2 w-2 ${badge.dot}`}></span>
            </span>
            <span className="font-semibold">{workerStatus.state}</span>
            {workerStatus.gpuName && (
              <span className="hidden lg:inline text-slate-400 font-normal border-l border-slate-200 pl-2">
                {workerStatus.gpuName}
              </span>
            )}
          </button>

          {/* Worker Setup Screen Button */}
          {onOpenWorkerSetup && (
            <button
              onClick={onOpenWorkerSetup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-violet-700 hover:text-violet-800 bg-violet-50/80 hover:bg-violet-100/80 border border-violet-200 transition-colors shadow-xs"
              title="Open Worker Initialization & Setup Screen"
            >
              <Cpu className="w-4 h-4 text-violet-600" />
              <span className="hidden sm:inline">Worker Setup</span>
            </button>
          )}

          {/* Kaggle Terminal Guide Button */}
          <button
            onClick={onOpenKaggleGuide}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-violet-700 bg-white hover:bg-violet-50 border border-slate-200/90 hover:border-violet-300 transition-colors shadow-xs"
          >
            <Terminal className="w-4 h-4 text-violet-600" />
            <span className="hidden sm:inline">Kaggle GPU</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            id="settings-modal-trigger"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 transition-colors shadow-xs"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4 text-slate-600" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
};
