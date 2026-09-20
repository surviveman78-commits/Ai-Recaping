import React, { useState, useRef } from 'react';
import {
  Link2,
  Plus,
  Video,
  Upload,
  Sparkles,
  Film,
  X,
  FileVideo,
} from 'lucide-react';
import { AudioMode } from '../types/index.ts';
import { uploadVideoFile } from '../services/api.ts';

interface MovieUrlInputProps {
  onAddJob: (params: {
    sourceType: 'url' | 'upload';
    sourceUrl?: string;
    uploadedFileId?: string;
    uploadedFileName?: string;
    uploadedFileSize?: number;
    customTitle?: string;
    audioMode?: AudioMode;
  }) => Promise<void>;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const MovieUrlInput: React.FC<MovieUrlInputProps> = ({ onAddJob }) => {
  const [url, setUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [audioMode, setAudioMode] = useState<AudioMode>('recap');

  // File Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  // Trigger device file picker (works on Desktop, iPhone/iPad, Android)
  const handlePickFile = () => {
    setInputError(null);
    fileInputRef.current?.click();
  };

  // Handle file selection from picker
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ['mp4', 'mov', 'mkv', 'webm'];
    if (!ext || !allowed.includes(ext)) {
      setInputError(`Unsupported format .${ext}. Please select an MP4, MOV, MKV, or WEBM video.`);
      return;
    }

    setSelectedFile(file);
    // If a file is selected, clear URL to avoid ambiguity
    setUrl('');
    setInputError(null);
    setUploadProgress(null);
  };

  // Clear selected file
  const handleClearFile = () => {
    setSelectedFile(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Unified "Add to Queue" handler situated underneath both URL and Video Upload
  const handleAddToQueue = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!selectedFile && !url.trim()) {
      setInputError('Please enter a Movie URL or select a video file to upload');
      return;
    }

    try {
      setIsProcessing(true);
      setInputError(null);

      if (selectedFile) {
        // Upload local video file first with real-time progress
        setUploadProgress(0);
        const res = await uploadVideoFile(selectedFile, (pct) => {
          setUploadProgress(pct);
        });

        // Add upload job to queue
        await onAddJob({
          sourceType: 'upload',
          uploadedFileId: res.uploadedFileId,
          uploadedFileName: res.fileName,
          uploadedFileSize: res.fileSize,
          customTitle: customTitle.trim() || undefined,
          audioMode,
        });

        handleClearFile();
        setCustomTitle('');
      } else {
        // Add URL job to queue
        await onAddJob({
          sourceType: 'url',
          sourceUrl: url.trim(),
          customTitle: customTitle.trim() || undefined,
          audioMode,
        });

        setUrl('');
        setCustomTitle('');
      }
    } catch (err: any) {
      setInputError(err.message || 'Failed to submit movie to queue');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full liquid-glass-card rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
      {/* Header & Description */}
      <div className="border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-violet-50 text-violet-700 border border-violet-200/60">
            <Film className="w-5 h-5 text-violet-600" />
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            Movie Source
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
          Provide a web movie stream URL or upload a local video file to generate an AI recap.
        </p>
      </div>

      {/* ERROR BANNER */}
      {inputError && (
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
            <span className="font-medium">{inputError}</span>
          </div>
          <button
            type="button"
            onClick={() => setInputError(null)}
            className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* SOURCE SELECTION: A. MOVIE URL  OR  B. UPLOAD VIDEO      */}
      {/* ======================================================== */}
      <div className="space-y-5">
        {/* SOURCE A: URL INPUT */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Link2 className="w-4 h-4" />
          </div>
          <input
            type="url"
            id="movie-url-input"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (selectedFile) handleClearFile();
              if (inputError) setInputError(null);
            }}
            placeholder="Paste Movie URL (YouTube, Vimeo, direct MP4 or video stream link)..."
            className="w-full pl-10 pr-10 py-3.5 text-xs sm:text-sm rounded-2xl liquid-glass-input text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            disabled={isProcessing}
          />
          {url && (
            <button
              type="button"
              onClick={() => setUrl('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* OR DIVIDER */}
        <div className="relative flex items-center justify-center">
          <div className="w-full border-t border-slate-200/80" />
          <span className="absolute px-4 bg-[#f8fafc] text-xs font-black uppercase text-slate-400 tracking-wider">
            OR
          </span>
        </div>

        {/* SOURCE B: UPLOAD LOCAL VIDEO FILE */}
        <div>
          {/* Hidden HTML5 File Input supporting MP4, MOV, MKV, WEBM on Desktop & Mobile */}
          <input
            ref={fileInputRef}
            type="file"
            id="video-file-picker"
            accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
            onChange={handleFileChange}
            className="hidden"
          />

          {!selectedFile ? (
            /* Upload Video Trigger Button / Drop Area */
            <div
              onClick={handlePickFile}
              className="group border-2 border-dashed border-slate-200 hover:border-violet-400 bg-white/60 hover:bg-violet-50/30 rounded-2xl p-6 transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-2"
            >
              <div className="w-11 h-11 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center group-hover:scale-105 transition-transform border border-violet-200/60">
                <Video className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-violet-700 flex items-center justify-center gap-1.5">
                  <span>🎬 Upload Video</span>
                  <span className="text-xs font-normal text-slate-400">(Desktop, iPhone, iPad, Android)</span>
                </div>
                <p className="text-xs text-slate-500">
                  Tap to choose file • Formats: <span className="font-semibold text-slate-700">MP4, MOV, MKV, WEBM</span>
                </p>
              </div>
            </div>
          ) : (
            /* Selected File Preview Card */
            <div className="p-4 rounded-2xl bg-white border border-violet-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0 border border-violet-200">
                    <FileVideo className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                        {selectedFile.name}
                      </p>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-50 text-violet-700 border border-violet-200">
                        {selectedFile.name.split('.').pop()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatFileSize(selectedFile.size)} • Selected for recap processing
                    </p>
                  </div>
                </div>

                {!isProcessing && (
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                    title="Remove file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Upload Progress Bar (when active) */}
              {isProcessing && uploadProgress !== null && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-violet-700 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 animate-bounce" />
                      Uploading video to server...
                    </span>
                    <span className="font-mono text-slate-700">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* OPTIONAL CONTENT PARAMETERS: Title & Audio Mode          */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200/70">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700">
            Movie Title (Optional Override)
          </label>
          <input
            type="text"
            id="movie-title-override-input"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="e.g. Inception: Final Act Breakdown"
            className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 focus:outline-none placeholder:text-slate-400"
            disabled={isProcessing}
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700">
            Audio Mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAudioMode('recap')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                audioMode === 'recap'
                  ? 'bg-violet-50 text-violet-700 border-violet-600 ring-2 ring-violet-500/10'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              disabled={isProcessing}
            >
              <div>🎙️ Recap</div>
              <div className="text-[10px] font-normal text-slate-500">Full Storyteller</div>
            </button>

            <button
              type="button"
              onClick={() => setAudioMode('dialogue')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                audioMode === 'dialogue'
                  ? 'bg-violet-50 text-violet-700 border-violet-600 ring-2 ring-violet-500/10'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              disabled={isProcessing}
            >
              <div>🎭 Dialogue</div>
              <div className="text-[10px] font-normal text-slate-500">Preserve Beats</div>
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* UNIFIED ADD TO QUEUE BUTTON UNDERNEATH BOTH URL & UPLOAD */}
      {/* ======================================================== */}
      <div className="pt-2">
        <button
          type="button"
          id="unified-add-to-queue-btn"
          onClick={() => handleAddToQueue()}
          disabled={isProcessing || (!url.trim() && !selectedFile)}
          className="w-full inline-flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isProcessing ? (
            <>
              <Upload className="w-4 h-4 animate-bounce" />
              <span>{selectedFile ? `Uploading & Queuing (${uploadProgress ?? 0}%)...` : 'Adding to Queue...'}</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>+ Add to Queue</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
