import React, { useState } from 'react';
import {
  X,
  Mic,
  Upload,
  Volume2,
  Sliders,
  Check,
  Music,
  Sparkles,
} from 'lucide-react';
import { VoiceProfile } from '../types/index.ts';
import { createVoiceProfile } from '../services/api.ts';

interface VoiceUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (profile: VoiceProfile) => void;
}

export const VoiceUploadModal: React.FC<VoiceUploadModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [referenceText, setReferenceText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [emotion, setEmotion] = useState('Cinematic Suspense');
  const [temperature, setTemperature] = useState<number>(0.72);
  const [diffusionSteps, setDiffusionSteps] = useState<number>(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      if (dropped.type.startsWith('audio/') || ['.wav', '.mp3', '.m4a', '.ogg', '.flac'].some(ext => dropped.name.toLowerCase().endsWith(ext))) {
        setFile(dropped);
      } else {
        setError('Please drop a valid audio file (.wav, .mp3, .m4a, .ogg, .flac)');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a profile name');
      return;
    }
    if (!referenceText.trim()) {
      setError('Please provide the exact reference text spoken in the audio');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('referenceText', referenceText.trim());
      formData.append('speed', speed.toString());
      formData.append(
        'styleSettings',
        JSON.stringify({ emotion, pitch: 0.0, energy: 1.0 })
      );
      formData.append(
        'generationSettings',
        JSON.stringify({
          temperature,
          top_p: 0.85,
          diffusionSteps,
          guidanceScale: 3.5,
          cfg_value: 3.5,
          inference_timesteps: diffusionSteps,
        })
      );
      if (file) {
        formData.append('referenceAudio', file);
        formData.append('audioFile', file);
      }

      const created = await createVoiceProfile(formData);
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create voice profile');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl liquid-glass rounded-3xl border border-slate-200 shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-200/80 flex items-center justify-between bg-white/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                New VoxCPM2 Voice Profile
              </h3>
              <p className="text-xs text-slate-500">
                Zero-shot voice cloning for cinematic movie narration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          {/* Voice Profile Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Voice Profile Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Deep Dramatic Narrator"
              className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 placeholder:text-slate-400 focus:outline-none font-medium"
            />
          </div>

          {/* Audio Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reference Audio Sample (.wav, .mp3)
            </label>
            <label
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center p-5 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                isDragging
                  ? 'border-violet-500 bg-violet-100/50 scale-[1.01]'
                  : 'border-slate-200 hover:border-violet-400 bg-slate-50/50 hover:bg-violet-50/30'
              }`}
            >
              <Upload className="w-6 h-6 text-violet-600 mb-2" />
              <span className="text-xs font-bold text-slate-700">
                {file ? file.name : 'Click or drop 5-15s clean voice recording'}
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : 'WAV or MP3 with minimal background noise'}
              </span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setFile(e.target.files[0]);
                  }
                }}
              />
            </label>
          </div>

          {/* Reference Audio Text */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Exact Reference Text (Transcript of Reference Audio)
            </label>
            <textarea
              required
              rows={2}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              placeholder="Type exactly what is spoken in the reference audio clip..."
              className="w-full px-3.5 py-2.5 text-xs rounded-xl liquid-glass-input text-slate-900 placeholder:text-slate-400 focus:outline-none font-medium"
            />
          </div>

          {/* Emotion & Speed Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Emotion / Tone Style
              </label>
              <select
                value={emotion}
                onChange={(e) => setEmotion(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl liquid-glass-input text-slate-900 focus:outline-none bg-white font-medium"
              >
                <option value="Cinematic Suspense">Cinematic Suspense</option>
                <option value="Documentary Serious">Documentary Serious</option>
                <option value="High Action Energetic">High Action Energetic</option>
                <option value="Calm Storyteller">Calm Storyteller</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Speed Cadence</span>
                <span className="text-violet-700 font-mono">{speed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.75"
                max="1.35"
                step="0.05"
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full accent-violet-600 mt-2"
              />
            </div>
          </div>

          {/* Diffusion & Temperature Generation Settings */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3 text-xs">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-violet-600" />
              <span>VoxCPM2 Generation Parameters</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-slate-500 block mb-1">Temperature ({temperature})</span>
                <input
                  type="range"
                  min="0.4"
                  max="1.0"
                  step="0.02"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block mb-1">Diffusion Steps ({diffusionSteps})</span>
                <input
                  type="range"
                  min="15"
                  max="50"
                  step="5"
                  value={diffusionSteps}
                  onChange={(e) => setDiffusionSteps(parseInt(e.target.value, 10))}
                  className="w-full accent-violet-600"
                />
              </div>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 active:scale-[0.98] transition-all shadow-md shadow-violet-500/20 disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Saving Profile...' : 'Save Voice Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
