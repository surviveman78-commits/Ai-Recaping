import React, { useState } from 'react';
import {
  X,
  Layers,
  Clock,
  ArrowRight,
  Play,
  FileText,
  Volume2,
  Sparkles,
  CheckCircle2,
  Video,
  Scissors,
  Sliders,
  Copy,
  Check,
  FolderTree,
  Languages,
  Film,
  Download,
} from 'lucide-react';
import { Job, Segment, RecapSegment, TranscriptSegment } from '../types/index.ts';

interface TimelineInspectorModalProps {
  job: Job | null;
  onClose: () => void;
}

export const TimelineInspectorModal: React.FC<TimelineInspectorModalProps> = ({
  job,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'recap' | 'transcript' | 'tts' | 'timeline' | 'artifacts'>('recap');
  const [copied, setCopied] = useState(false);

  if (!job) return null;

  const totalSourceDuration = job.segments.reduce((acc, s) => acc + s.sourceDuration, 0);
  const totalTtsDuration = job.segments.reduce((acc, s) => acc + s.ttsDuration, 0);
  const finalTimelineDuration = job.segments.length > 0 ? job.segments[job.segments.length - 1].finalEnd : 0;

  // Normalized transcript array
  const rawTranscript: TranscriptSegment[] = Array.isArray(job.originalTranscript)
    ? job.originalTranscript
    : [];

  // Normalized recap segments
  const recapSegments: RecapSegment[] = Array.isArray(job.recapSegments)
    ? job.recapSegments
    : [];

  // Normalized TTS chunks
  const ttsChunks = Array.isArray(job.ttsChunks) ? job.ttsChunks : [];

  const handleCopyScript = () => {
    const textToCopy = job.translatedScript || recapSegments.map(s => s.targetText).join('\n\n');
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl liquid-glass rounded-3xl border border-slate-200 shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200/80 flex items-center justify-between shrink-0 bg-white/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-purple-500 text-white flex items-center justify-center shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">
                  Job Pipeline & Recap Inspector
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-violet-100 text-violet-700 border border-violet-200 flex items-center gap-1">
                  <Languages className="w-3 h-3" />
                  {job.targetLanguage || 'English'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  {job.currentStage} ({job.progress}%)
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate max-w-xl">
                {job.title} · Job ID: <span className="font-mono text-slate-700">{job.id}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation & High-level Duration Metrics */}
        <div className="px-6 pt-4 pb-3 bg-slate-50/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center p-1 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-600">
            <button
              onClick={() => setActiveTab('recap')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'recap'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generated Recap ({recapSegments.length || (job.translatedScript ? 1 : 0)})
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'transcript'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Original Transcript ({rawTranscript.length})
            </button>
            <button
              onClick={() => setActiveTab('tts')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'tts'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              TTS Chunks & Voices ({ttsChunks.length || recapSegments.length})
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'timeline'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              Reconstructed Timeline ({job.segments.length})
            </button>
            <button
              onClick={() => setActiveTab('artifacts')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'artifacts'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              Workspace Artifacts
            </button>
          </div>

          {/* Quick Metrics Comparison */}
          <div className="flex items-center gap-4 text-xs font-medium">
            {totalSourceDuration > 0 && (
              <>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="text-slate-400">Raw Cuts:</span>
                  <span className="font-mono font-bold text-slate-800">{totalSourceDuration.toFixed(1)}s</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </>
            )}
            {finalTimelineDuration > 0 ? (
              <div className="flex items-center gap-1.5 text-violet-700 font-semibold bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-200">
                <span>Timeline Length:</span>
                <span className="font-mono font-bold text-violet-900">{finalTimelineDuration.toFixed(1)}s</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                <span>Target:</span>
                <span className="font-semibold text-slate-700">{job.targetLanguage || 'English'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: GENERATED RECAP (GEMINI NARRATION & SEGMENT MAPPING) */}
          {activeTab === 'recap' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                    Cinematic Recap Narration ({job.targetLanguage || 'English'})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Chronological story beats structured for narrator voiceover with source timestamp mapping.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyScript}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copied Script</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Copy Full Script</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Segmented Recap View */}
              {recapSegments.length > 0 ? (
                <div className="space-y-3">
                  {recapSegments.map((seg, idx) => (
                    <div
                      key={seg.id || idx}
                      className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-2 hover:border-violet-300 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 font-mono text-[11px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-mono text-xs font-bold text-violet-900 bg-violet-50/80 px-2.5 py-1 rounded-lg border border-violet-200/60">
                            {formatSecondsToTimestamp(seg.sourceStart)} → {formatSecondsToTimestamp(seg.sourceEnd)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>Cut Duration: <strong className="font-mono text-slate-800">{seg.sourceDuration.toFixed(1)}s</strong></span>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1">
                        <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                          {seg.targetText}
                        </p>
                        {seg.sourceText && (
                          <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <span className="font-semibold text-slate-400 not-italic mr-1">Source dialogue:</span>
                            "{seg.sourceText}"
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : job.translatedScript ? (
                <div className="p-5 rounded-2xl bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-normal">
                  {job.translatedScript}
                </div>
              ) : (
                <div className="p-10 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Recap Script in Progress</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    The structured recap JSON will be displayed here as soon as Stage 4 (Translating / Rewriting) finishes.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ORIGINAL WHISPER TRANSCRIPT */}
          {activeTab === 'transcript' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-600" />
                    Original Whisper Dialogue Transcript
                  </h4>
                  <p className="text-xs text-slate-500">
                    Exact timestamped speech recognized by Groq Whisper-large-v3 from 16kHz mono audio.
                  </p>
                </div>
                <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                  {rawTranscript.length} Dialogue Turns
                </span>
              </div>

              {rawTranscript.length > 0 ? (
                <div className="space-y-2">
                  {rawTranscript.map((turn, i) => (
                    <div
                      key={turn.id ?? i}
                      className="p-3.5 rounded-xl bg-white border border-slate-200/90 text-xs flex items-start gap-3.5 hover:border-slate-300 transition-colors shadow-2xs"
                    >
                      <span className="font-mono text-[11px] font-bold text-violet-800 px-2.5 py-1 rounded-lg bg-violet-50 shrink-0 border border-violet-200/60">
                        {formatSecondsToTimestamp(turn.start)} → {formatSecondsToTimestamp(turn.end)}
                      </span>
                      <div className="flex-1">
                        <p className="text-slate-800 font-medium leading-relaxed">{turn.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : typeof job.originalTranscript === 'string' && job.originalTranscript ? (
                <div className="p-5 rounded-xl bg-white border border-slate-200 text-xs font-mono whitespace-pre-wrap">
                  {job.originalTranscript}
                </div>
              ) : (
                <div className="p-10 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Audio Transcription in Queue</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Timestamped dialogue segments will stream in real-time as Groq Whisper processes audio chunks.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TTS CHUNKS & AUTHORITATIVE VOICES */}
          {activeTab === 'tts' && (
            <div className="space-y-6">
              {/* Voice & Snapshot Configuration Banner */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-5 h-5 text-violet-600" />
                      <h4 className="text-sm font-bold text-slate-900">
                        {job.selectedTtsEngine === 'voxcpm2'
                          ? 'VoxCPM2 Custom Voice Cloning'
                          : 'Microsoft Edge Neural TTS'}
                      </h4>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 uppercase">
                        {job.selectedTtsEngine}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Immutable job snapshot captured at creation time · Sequential safe inference
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">Voice:</span>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold font-mono">
                      {job.ttsSnapshot?.voiceName || job.ttsSnapshot?.voiceProfileName || job.edgeVoice || job.voiceProfileId || 'Default Voice'}
                    </span>
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Target Language</span>
                    <span className="text-xs font-bold text-slate-900 mt-0.5 block">{job.targetLanguage || 'English'}</span>
                    <span className="text-[10px] text-slate-500">Recap translation</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Speech Rate</span>
                    <span className="text-xs font-bold text-slate-900 mt-0.5 block">
                      {job.ttsSnapshot?.speed ? `${job.ttsSnapshot.speed}x` : '1.0x'}
                    </span>
                    <span className="text-[10px] text-slate-500">Cadence factor</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Total TTS Duration</span>
                    <span className="text-xs font-bold text-violet-700 font-mono mt-0.5 block">
                      {totalTtsDuration > 0 ? `${totalTtsDuration.toFixed(2)}s` : 'Measuring...'}
                    </span>
                    <span className="text-[10px] text-slate-500">Authoritative measured</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Inference Mode</span>
                    <span className="text-xs font-bold text-emerald-700 mt-0.5 block">Concurrency: 1</span>
                    <span className="text-[10px] text-slate-500">GPU VRAM protected</span>
                  </div>
                </div>
              </div>

              {/* Chunks List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <FolderTree className="w-3.5 h-3.5 text-violet-600" />
                    Synthesized TTS Audio Chunks ({ttsChunks.length})
                  </span>
                  <span className="text-slate-400 text-[11px]">
                    20–27s preferred chunk windows · Measured via FFprobe
                  </span>
                </div>

                {ttsChunks.length > 0 ? (
                  <div className="space-y-2.5">
                    {ttsChunks.map((chunk, idx) => {
                      const id = chunk.ttsChunkId || chunk.chunkId || `chunk_${idx + 1}`;
                      const segIdx = chunk.segmentIndex ?? chunk.chunkIndex ?? idx;
                      const duration = chunk.actualDuration ?? chunk.ttsDuration ?? 0;
                      const text = chunk.text || chunk.chunkText || chunk.targetText || '';
                      const chars = chunk.characterCount ?? text.length;
                      const audioFile = chunk.audioFilename || chunk.ttsAudioPath || chunk.audioPath || `tts/chunks/${id}.wav`;

                      return (
                        <div
                          key={id}
                          className="p-4 rounded-xl bg-white border border-slate-200 hover:border-violet-300 transition-all shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-mono text-xs font-bold">
                                #{idx + 1}
                              </span>
                              <span className="text-xs font-bold text-slate-800 font-mono">
                                {id}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                (Segment #{segIdx + 1})
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                                {duration.toFixed(2)}s measured
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium capitalize">
                                {chunk.status || 'ready'}
                              </span>
                            </div>
                          </div>

                          {/* Chunk Script Text */}
                          <p className="text-xs text-slate-800 font-medium leading-relaxed">
                            "{text}"
                          </p>

                          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 font-mono">
                            <span>Chars: {chars}</span>
                            <span className="text-slate-400 truncate max-w-sm">
                              {audioFile}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : job.segments.length > 0 && job.segments.some(s => s.ttsDuration > 0) ? (
                  /* Fallback to segments if chunks array not yet populated */
                  <div className="space-y-2.5">
                    {job.segments.map((seg, idx) => (
                      <div
                        key={seg.id || idx}
                        className="p-4 rounded-xl bg-white border border-slate-200 space-y-2"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-mono text-xs font-bold">
                            Segment #{idx + 1}
                          </span>
                          <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                            {seg.ttsDuration.toFixed(2)}s measured
                          </span>
                        </div>
                        <p className="text-xs text-slate-800 font-medium">
                          "{seg.scriptText}"
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
                    <p className="text-xs font-semibold text-slate-700">TTS Synthesis in Stage 5</p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Once Stage 4 (Gemini Recap) generates structured narration segments, the TTS manager chunks sentences into 20–27s segments, invokes the selected engine sequentially, and records precise audio durations here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DYNAMIC TIMELINE (TTS & SUBTITLE SYNC) */}
          {activeTab === 'timeline' && (
            <div className="space-y-6">
              {/* Educational Rule Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-50 via-purple-50 to-indigo-50 border border-violet-200/80 text-xs text-violet-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-violet-900">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  TTS-Driven Dynamic Timeline Principle
                </div>
                <p className="text-slate-600 leading-relaxed">
                  The original video segment duration is never forced onto speech. Instead, each narration sentence is synthesized at natural cadence, its actual audio duration is measured with sub-millisecond precision, and the video frames are extended or trimmed to match the exact TTS duration.
                </p>
              </div>

              {/* Video Player (if completed or output available) */}
              {(job.outputVideoUrl || job.status === 'completed') && (
                <div className="liquid-glass-card rounded-2xl p-4 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <Video className="w-4 h-4 text-violet-600" />
                      Final Recap Deliverable Preview
                    </span>
                  </div>
                  <div className="relative aspect-video rounded-xl overflow-hidden bg-black shadow-inner border border-slate-800">
                    <video
                      controls
                      className="w-full h-full object-contain"
                      src={job.outputVideoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'}
                    />
                  </div>
                </div>
              )}

              {/* Segments List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Reconstructed Timeline Segments</span>
                  <div className="flex items-center gap-3">
                    <span className="text-violet-700 font-mono">
                      {job.segments.length} Cuts Synchronized
                    </span>
                    {job.segments.length > 0 && (
                      <a
                        href={`/api/jobs/${job.id}/subtitles`}
                        download={`${job.title || 'recap'}.srt`}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-xs shadow-xs transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download recap.srt
                      </a>
                    )}
                  </div>
                </div>

                {job.segments.length > 0 ? (
                  <div className="space-y-3">
                    {job.segments.map((seg, idx) => {
                      const durDiff = seg.ttsDuration - seg.sourceDuration;
                      const isExpanded = durDiff > 0.08;
                      const isCompacted = durDiff < -0.08;
                      const op = seg.operation || (isExpanded ? 'extend_forward' : isCompacted ? 'trim' : 'direct');

                      const opLabels: Record<string, { label: string; color: string; desc: string }> = {
                        direct: {
                          label: 'Direct Cut',
                          color: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                          desc: 'Source matches TTS duration within tolerance',
                        },
                        trim: {
                          label: 'Trim',
                          color: 'bg-cyan-100 text-cyan-800 border-cyan-200',
                          desc: 'Source cut to match shorter TTS narration',
                        },
                        extend_forward: {
                          label: 'Extend Forward',
                          color: 'bg-amber-100 text-amber-800 border-amber-200',
                          desc: 'Extended into natural video headroom before next cut',
                        },
                        loop: {
                          label: 'Seamless Loop',
                          color: 'bg-purple-100 text-purple-800 border-purple-200',
                          desc: 'Looped video segment to cover extended narration',
                        },
                        freeze_last_frame: {
                          label: 'Freeze Last Frame',
                          color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
                          desc: 'Held final frame to maintain narrative continuity',
                        },
                      };

                      const opInfo = opLabels[op] || opLabels.direct;

                      return (
                        <div
                          key={seg.id}
                          className="p-4 rounded-2xl bg-white border border-slate-200 hover:border-violet-300 transition-all shadow-2xs space-y-3"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-mono text-[11px] font-bold flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <span className="text-xs font-semibold text-slate-900">
                                Segment #{idx + 1}
                              </span>
                              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${opInfo.color}`}>
                                {opInfo.label}
                              </span>
                            </div>

                            {/* Duration Alignment Badge */}
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-slate-500">
                                Source: {seg.sourceDuration.toFixed(2)}s
                              </span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-200">
                                TTS: {seg.ttsDuration.toFixed(2)}s
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isExpanded
                                    ? 'bg-amber-100 text-amber-800'
                                    : isCompacted
                                    ? 'bg-cyan-100 text-cyan-800'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {isExpanded
                                  ? `+${durDiff.toFixed(2)}s`
                                  : isCompacted
                                  ? `${durDiff.toFixed(2)}s`
                                  : 'Exact Pace'}
                              </span>
                            </div>
                          </div>

                          {/* Narration Script Text */}
                          <div className="text-sm font-medium text-slate-900">
                            "{seg.scriptText}"
                          </div>

                          {/* Timeline Coordinates */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">Source Cut Range</span>
                              <span className="font-mono font-bold text-slate-700">
                                {seg.sourceStart.toFixed(2)}s - {seg.sourceEnd.toFixed(2)}s
                              </span>
                              <span className="block text-[10px] text-slate-500">
                                ({seg.sourceDuration.toFixed(2)}s)
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-violet-50/60 border border-violet-100">
                              <span className="text-[10px] text-violet-500 block font-semibold">Final Timeline Window</span>
                              <span className="font-mono font-bold text-violet-900">
                                {seg.finalStart.toFixed(2)}s - {seg.finalEnd.toFixed(2)}s
                              </span>
                              <span className="block text-[10px] text-violet-600">
                                (TTS length: {(seg.finalEnd - seg.finalStart).toFixed(2)}s)
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">SRT Subtitle Window</span>
                              <span className="font-mono font-bold text-slate-700">
                                {seg.subtitleStart.toFixed(2)}s - {seg.subtitleEnd.toFixed(2)}s
                              </span>
                              <span className="block text-[10px] text-slate-500">
                                Standalone subtitle
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">Intermediate Video Clip</span>
                              <span className="font-mono font-bold text-slate-700 truncate block">
                                {seg.videoPath || `segment_${String(idx + 1).padStart(4, '0')}.mp4`}
                              </span>
                              <span className="block text-[10px] text-slate-500">
                                {opInfo.desc}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 rounded-xl bg-slate-50 text-center border border-dashed border-slate-200 text-xs text-slate-500">
                    Dynamic timeline segments will appear once the worker completes Stage 5 (Generating TTS) and Stage 6 (Rebuilding Timeline).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: WORKSPACE ARTIFACTS & METRICS */}
          {activeTab === 'artifacts' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-violet-600" />
                  Job Workspace Storage Architecture
                </h4>
                <p className="text-xs text-slate-500">
                  Isolated workspace directory preserving all intermediate debugging files and assets for this run.
                </p>
              </div>

              {/* Artifacts Directory Map */}
              <div className="p-4 rounded-2xl bg-slate-900 text-slate-200 font-mono text-xs space-y-2 shadow-inner">
                <div className="text-violet-400 font-bold">workspace/jobs/{job.id}/</div>
                <div className="pl-4 space-y-1 text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── source/</span>
                    <span className="text-emerald-400">movie.mp4</span>
                    <span className="text-slate-500 text-[11px]">(yt-dlp stream download)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── audio/</span>
                    <span className="text-cyan-400">source.wav</span>
                    <span className="text-slate-500 text-[11px]">(FFmpeg 16kHz 16-bit Mono PCM)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── transcript/</span>
                    <span className="text-amber-400">original.json</span>
                    <span className="text-slate-500 text-[11px]">(authoritative Groq Whisper transcript)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   ├── original.txt</span>
                    <span className="text-slate-500 text-[11px]">(human-readable timestamped dialogue)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   ├── recap.json</span>
                    <span className="text-amber-300">recap.json</span>
                    <span className="text-slate-500 text-[11px]">(validated structured Gemini recap)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   └── recap.txt</span>
                    <span className="text-slate-500 text-[11px]">(readable narration script)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── tts/</span>
                    <span className="text-purple-300">manifest.json</span>
                    <span className="text-slate-500 text-[11px]">(TTS engine metadata snapshot)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   ├── segments.json</span>
                    <span className="text-emerald-300">segments.json</span>
                    <span className="text-slate-500 text-[11px]">(authoritative measured durations for Timeline Engine)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   ├── chunks.json</span>
                    <span className="text-purple-300">chunks.json</span>
                    <span className="text-slate-500 text-[11px]">(sentence-chunked audio metadata)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   └── chunks/</span>
                    <span className="text-cyan-300">chunk_*.wav</span>
                    <span className="text-slate-500 text-[11px]">(measured raw 24kHz/16kHz audio clips)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── timeline/</span>
                    <span className="text-indigo-300">timeline.json</span>
                    <span className="text-slate-500 text-[11px]">(authoritative reconstructed timeline)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   ├── manifest.json</span>
                    <span className="text-indigo-300">manifest.json</span>
                    <span className="text-slate-500 text-[11px]">(timeline metadata & cuts summary)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   └── segment_*.mp4</span>
                    <span className="text-indigo-300">segment_*.mp4</span>
                    <span className="text-slate-500 text-[11px]">(individual trimmed/extended video clips)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">├── subtitles/</span>
                    <span className="text-pink-300">recap.srt</span>
                    <span className="text-slate-500 text-[11px]">(standalone external subtitle file)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">│   └── manifest.json</span>
                    <span className="text-pink-300">manifest.json</span>
                    <span className="text-slate-500 text-[11px]">(SRT timing cue audit)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">└── output/</span>
                    <span className="text-violet-300">final_recap.mp4</span>
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              {job.metrics && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
                  <span className="text-xs font-bold text-slate-800">Job Pipeline Telemetry:</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {Object.entries(job.metrics).map(([key, value]) => (
                      <div key={key} className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="text-[10px] text-slate-400 block truncate">{key}</span>
                        <span className="font-mono font-bold text-slate-800 truncate block">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50/90 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs">
          <div className="text-slate-500 flex items-center gap-3">
            <span>Tts Engine: <strong className="font-semibold text-slate-800 capitalize">{job.selectedTtsEngine}</strong></span>
            {job.stageMessage && (
              <span className="text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-200 truncate max-w-md">
                {job.stageMessage}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};

function formatSecondsToTimestamp(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
