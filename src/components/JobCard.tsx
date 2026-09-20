import React, { useState } from 'react';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  Play,
  RotateCcw,
  XCircle,
  Sparkles,
  Layers,
  ChevronRight,
  ExternalLink,
  Download,
  FileText,
  Volume2,
  Mic,
} from 'lucide-react';
import { Job, PROCESSING_STAGES } from '../types/index.ts';

interface JobCardProps {
  job: Job;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenDetails: (job: Job) => void;
}

export const JobCard: React.FC<JobCardProps> = ({
  job,
  onCancel,
  onRetry,
  onOpenDetails,
}) => {
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Status Badge Formatting
  const getStatusBadge = () => {
    switch (job.status) {
      case 'completed':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
          label: 'Completed',
        };
      case 'processing':
        return {
          bg: 'bg-violet-50 text-violet-700 border-violet-200',
          icon: <div className="w-2.5 h-2.5 rounded-full bg-violet-600 animate-ping" />,
          label: 'Processing',
        };
      case 'failed':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-200',
          icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" />,
          label: 'Failed',
        };
      case 'cancelled':
        return {
          bg: 'bg-slate-100 text-slate-700 border-slate-200',
          icon: <XCircle className="w-3.5 h-3.5 text-slate-500" />,
          label: 'Cancelled',
        };
      case 'queued':
      default:
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
          icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
          label: 'Queued',
        };
    }
  };

  const statusBadge = getStatusBadge();

  // Elapsed or recorded processing time
  const renderDuration = () => {
    if (job.processingTimeSeconds !== undefined) {
      const mins = Math.floor(job.processingTimeSeconds / 60);
      const secs = job.processingTimeSeconds % 60;
      return `${mins > 0 ? `${mins}m ` : ''}${secs}s`;
    }
    if (job.startedAt && job.status === 'processing') {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000));
      return `${elapsed}s elapsed`;
    }
    return 'Pending';
  };

  return (
    <div className="w-full liquid-glass-card rounded-2xl border border-slate-200/90 overflow-hidden transition-all hover:border-violet-300 shadow-xs">
      <div className="p-5 sm:p-6 space-y-5">
        {/* Top Header: Title, Thumbnail, Status & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            {/* Thumbnail */}
            <div className="relative w-20 h-14 sm:w-24 sm:h-16 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200/80 shadow-xs">
              <img
                src={job.thumbnailUrl || 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop&q=80'}
                alt={job.title || 'Movie Thumbnail'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              {job.status === 'completed' && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                  <div className="w-7 h-7 rounded-full bg-white/90 text-violet-700 flex items-center justify-center shadow-xs">
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </div>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-900 truncate">
                  {job.title || 'Movie Stream'}
                </h3>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadge.bg}`}>
                  {statusBadge.icon}
                  {statusBadge.label}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                  {job.sourceType === 'upload' ? '🎬 Upload' : '🌐 URL'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                  {job.selectedTtsEngine === 'voxcpm2' ? (
                    <>
                      <Mic className="w-3 h-3 text-violet-600" /> VoxCPM2 GPU
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3 h-3 text-blue-600" /> Edge TTS
                    </>
                  )}
                </span>
                {job.audioMode && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                    {job.audioMode === 'dialogue' ? '🎭 Dialogue' : '🎙️ Recap'}
                  </span>
                )}
                {job.targetLanguage && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200/60 text-[11px] font-semibold">
                    {job.targetLanguage}
                  </span>
                )}
                {job.recapSegments && job.recapSegments.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/60 text-[11px] font-medium">
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    {job.recapSegments.length} Recap Beats
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                <span className="truncate max-w-[280px] sm:max-w-md font-mono text-[11px]">
                  {job.sourceType === 'upload'
                    ? (job.uploadedFileName ? `📁 ${job.uploadedFileName}` : '📁 Uploaded video file')
                    : job.sourceUrl}
                </span>
                <span className="text-slate-300">•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {renderDuration()}
                </span>
                {job.metrics?.downloadSpeed && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="font-mono text-emerald-700 font-medium">
                      {job.metrics.downloadSpeed}
                    </span>
                  </>
                )}
                {job.metrics?.videoDuration && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="font-mono text-slate-600">
                      {Number(job.metrics.videoDuration).toFixed(0)}s video
                    </span>
                  </>
                )}
                {job.segments && job.segments.length > 0 && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="font-semibold text-violet-700">
                      {job.segments.length} TTS-Driven Cuts
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {job.status === 'processing' && (
              <button
                onClick={() => onCancel(job.id)}
                className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}

            {(job.status === 'failed' || job.status === 'cancelled') && (
              <button
                onClick={() => onRetry(job.id)}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-violet-200 bg-violet-50/80 hover:bg-violet-100 text-violet-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </button>
            )}

            {/* Inspect Segments / Timeline button */}
            <button
              onClick={() => onOpenDetails(job)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-800 hover:text-violet-700 bg-white hover:bg-violet-50 border border-slate-200/90 hover:border-violet-300 transition-all shadow-xs cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-violet-600" />
              <span>Timeline Segments</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Processing Stage & Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">
                Stage {job.currentStageNumber}/10:
              </span>
              <span className="font-semibold text-violet-700">
                {job.currentStage}
              </span>
              {job.stageMessage ? (
                <span className="text-[11px] text-violet-600 font-medium truncate max-w-xs sm:max-w-md">
                  — {job.stageMessage}
                </span>
              ) : job.status === 'processing' && (
                <span className="text-[11px] text-slate-500 hidden md:inline">
                  — {PROCESSING_STAGES.find((s) => s.name === job.currentStage)?.description}
                </span>
              )}
            </div>
            <div className="font-mono font-bold text-slate-700">
              {job.progress}%
            </div>
          </div>

          {/* Liquid Glass Progress Bar */}
          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/70">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                job.status === 'completed'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                  : job.status === 'failed'
                  ? 'bg-rose-500'
                  : 'bg-gradient-to-r from-violet-600 to-purple-500'
              }`}
              style={{ width: `${Math.max(3, job.progress)}%` }}
            />
          </div>

          {/* 10-Stage Visual Track Indicator */}
          <div className="grid grid-cols-10 gap-1 pt-1">
            {PROCESSING_STAGES.map((st) => {
              const isPassed = job.currentStageNumber > st.stage;
              const isCurrent = job.currentStageNumber === st.stage;
              return (
                <div
                  key={st.stage}
                  title={`Stage ${st.stage}: ${st.name}`}
                  className={`h-1.5 rounded-full transition-all ${
                    isPassed
                      ? 'bg-violet-600'
                      : isCurrent
                      ? 'bg-violet-400 animate-pulse'
                      : 'bg-slate-200'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Stage 5 TTS Active Synthesis Telemetry Strip */}
        {job.currentStageNumber === 5 && job.status === 'processing' && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-violet-50/80 border border-violet-200/90 text-xs text-violet-950">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-violet-600 animate-pulse" />
              <span className="font-semibold">
                {job.selectedTtsEngine === 'voxcpm2' ? 'VoxCPM2 Voice Cloning' : 'Microsoft Edge TTS'}:
              </span>
              <span className="text-slate-600">
                {job.stageMessage || 'Synthesizing voice chunks sequentially...'}
              </span>
            </div>
            {job.metrics?.totalTtsDuration && (
              <span className="font-mono font-bold text-violet-700 bg-white px-2 py-0.5 rounded border border-violet-200">
                {Number(job.metrics.totalTtsDuration).toFixed(2)}s measured
              </span>
            )}
          </div>
        )}

        {/* Completed Output Strip */}
        {job.status === 'completed' && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-xs text-emerald-950">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Final recap video rendered successfully with synchronized TTS timeline and subtitles.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenDetails(job)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                Watch Recap
              </button>
              {job.outputVideoUrl && (
                <a
                  href={job.outputVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 font-semibold hover:bg-emerald-100 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  MP4
                </a>
              )}
            </div>
          </div>
        )}

        {/* Failed State with Structured Error Card */}
        {job.status === 'failed' && job.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-rose-900 font-bold">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Error in stage: {job.error.stage}</span>
                <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-mono text-[10px]">
                  {job.error.code}
                </span>
              </div>
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-[11px] text-rose-700 hover:underline font-semibold"
              >
                {showErrorDetails ? 'Hide Details' : 'View Trace'}
              </button>
            </div>
            <p className="text-rose-800 font-medium">{job.error.message}</p>
            {showErrorDetails && job.error.details && (
              <pre className="mt-2 p-2.5 rounded-lg bg-rose-950 text-rose-200 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                {job.error.details}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
