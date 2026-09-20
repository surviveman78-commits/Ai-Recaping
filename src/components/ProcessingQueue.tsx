import React, { useState } from 'react';
import { Layers, Film, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { Job } from '../types/index.ts';
import { JobCard } from './JobCard.tsx';

interface ProcessingQueueProps {
  jobs: Job[];
  loading: boolean;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenDetails: (job: Job) => void;
  onRefresh: () => void;
}

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({
  jobs,
  loading,
  onCancel,
  onRetry,
  onOpenDetails,
  onRefresh,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'active') return job.status === 'processing' || job.status === 'queued';
    if (filter === 'completed') return job.status === 'completed';
    if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled';
    return true;
  });

  const activeCount = jobs.filter((j) => j.status === 'processing' || j.status === 'queued').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="w-full space-y-4">
      {/* Queue Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-violet-100/80 text-violet-700">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Processing Queue
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
                {jobs.length}
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Live updates via Server-Sent Events (SSE) from Kaggle GPU Worker
            </p>
          </div>
        </div>

        {/* Filter Pills & Refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 text-xs font-semibold text-slate-600">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              All ({jobs.length})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                filter === 'active'
                  ? 'bg-white text-violet-700 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                filter === 'completed'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              Done ({completedCount})
            </button>
            {failedCount > 0 && (
              <button
                onClick={() => setFilter('failed')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filter === 'failed'
                    ? 'bg-white text-rose-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
              >
                Failed ({failedCount})
              </button>
            )}
          </div>

          <button
            onClick={onRefresh}
            title="Refresh queue"
            className="p-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-violet-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Jobs List */}
      {filteredJobs.length > 0 ? (
        <div className="space-y-4">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onCancel={onCancel}
              onRetry={onRetry}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </div>
      ) : (
        <div className="liquid-glass-card rounded-2xl p-12 text-center border border-dashed border-slate-300/80 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center mx-auto">
            <Film className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-800">
              {filter !== 'all' ? `No ${filter} jobs found` : 'Your processing queue is empty'}
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Paste a Movie URL in the input above to begin Whisper transcription, Gemini narrative generation, and TTS timeline reconstruction.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
