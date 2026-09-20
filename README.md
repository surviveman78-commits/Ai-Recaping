# 🎬 AI Movie Recap Studio

AI Movie Recap Studio is an automated, end-to-end video processing platform designed to transform long-form movie and video content into localized, dubbed video recaps with synchronized audio narration and subtitles.

---

## 📌 Table of Contents
1. [Project Overview](#-project-overview)
2. [Current Architecture & Workflow](#-current-architecture--workflow)
3. [Kaggle GPU Worker Architecture](#-kaggle-gpu-worker-architecture)
4. [Worker Setup & Initialization Flow](#-worker-setup--initialization-flow)
5. [Core Engine Components](#-core-engine-components)
   - [CUDA / GPU Detection](#cuda--gpu-detection)
   - [Automated Package & Dependency Management](#automated-package--dependency-management)
   - [Model Management & Cache Verification](#model-management--cache-verification)
   - [VoxCPM2 Resident Zero-Shot Voice Cloning](#voxcpm2-resident-zero-shot-voice-cloning)
   - [Whisper & Groq ASR Transcription](#whisper--groq-asr-transcription)
   - [Microsoft Edge Neural TTS](#microsoft-edge-neural-tts)
   - [TTS-Driven Dynamic Timeline Reconstruction](#tts-driven-dynamic-timeline-reconstruction)
   - [FFmpeg Video Processing & Audio Mixing](#ffmpeg-video-processing--audio-mixing)
   - [External SRT Subtitle Generation](#external-srt-subtitle-generation)
6. [Queue & SSE Real-Time Progress System](#-queue--sse-real-time-progress-system)
7. [Dashboard Workflow](#-dashboard-workflow)
8. [Settings & Configuration](#-settings--configuration)
9. [Kaggle Deployment & Startup](#-kaggle-deployment--startup)

---

## 🧠 Project Overview

**AI Movie Recap Studio** orchestrates the complete video recap lifecycle:

1. **Video Ingestion**: Downloads source videos via URL (`yt-dlp`) or direct local file upload.
2. **Audio Extraction & Speech-to-Text**: Extracts high-fidelity audio streams and generates time-aligned transcripts using Whisper / Groq ASR.
3. **Script Generation & Translation**: Summarizes narrative arcs into structured recap scripts.
4. **Narration Synthesis**: Generates studio-quality voiceover audio via **VoxCPM2** (resident GPU zero-shot voice cloning) or **Microsoft Edge TTS**.
5. **Dynamic Timeline Alignment**: Measures exact synthetic audio durations and dynamically retimes/reconstructs video cuts to ensure 1:1 synchronization.
6. **Audio Mixing & Ducking**: Blends background scores, ambient sound effects, and voiceover tracks.
7. **Subtitle Rendering & Video Encoding**: Emits synchronized `.srt` subtitle files and produces optimized MP4 outputs utilizing hardware NVENC or software codecs.

---

## 📐 Current Architecture & Workflow

```text
                       SOURCE VIDEO (URL or File Upload)
                                      │
                                      ▼
                           [ Video Downloader / Ingestion ]
                                      │
                                      ▼
                          [ FFmpeg Audio Extraction ]
                                      │
                                      ▼
                        [ Whisper / Groq Speech-to-Text ]
                                      │
                                      ▼
                        [ AI Recap Script Generation ]
                                      │
                                      ▼
                     [ TTS Engine (VoxCPM2 / Edge TTS) ]
                                      │
                                      ▼
                     [ Real Audio Duration Measurement ]
                                      │
                                      ▼
                  [ TTS-Driven Dynamic Timeline Reconstruction ]
                                      │
                                      ▼
                    [ Audio Ducking & Multi-Track Mixing ]
                                      │
                                      ▼
                     [ External SRT Subtitle Generation ]
                                      │
                                      ▼
                    [ Final FFmpeg Encoding (NVENC / CPU) ]
                                      │
                                      ▼
                          COMPLETED RECAP VIDEO
```

---

## ⚡ Kaggle GPU Worker Architecture

The application is architected around a unified Node.js / Express backend with an embedded Python execution engine designed to run seamlessly in GPU-accelerated environments (such as Kaggle Tesla T4 / P100 / A100 instances):

- **Single Process Startup**: The entire application boots from one entry point (`server.ts`).
- **Zero Manual Notebook Setup**: Eliminates the need for manual cell-by-cell package installation or model downloading scripts in Kaggle notebooks.
- **Worker Bridge**: Manages worker registration, status synchronization, telemetry, and bidirectional job execution.
- **Persistent State Tracking**: Records verified session state to `.worker_init_manifest.json` to prevent unnecessary re-initialization.

---

## 🚀 Worker Setup & Initialization Flow

When the user first opens the application, access to the Dashboard is gated until the worker environment is fully verified.

### Setup Progression

```text
Worker Setup
    │
    ▼
[ Initialize Worker ] Clicked
    │
    ▼
Check Python / CUDA / GPU
    │
    ▼
Install Missing Dependencies (via manifest)
    │
    ▼
Check FFmpeg & NVENC Hardware Encoders
    │
    ▼
Verify & Download Required Models
    │
    ▼
Load VoxCPM2 into Resident GPU Memory
    │
    ▼
Run Real GPU Inference Test
    │
    ▼
Validate Worker Pipeline
    │
    ▼
Worker Ready ✓
    │
    ▼
[ Open Movie Recap Studio → ]
    │
    ▼
Dashboard
```

### Detailed Initialization Steps

| Step | Operation | Description |
|---|---|---|
| **1** | **Detect Python Environment** | Verifies `python3` executable and `pip` package manager. |
| **2** | **Detect CUDA & GPU** | Detects PyTorch CUDA bindings, GPU device name (e.g. Tesla T4), and available VRAM. |
| **3** | **Check & Install Dependencies** | Validates packages against `worker/kaggle/dependencies.json` and installs any missing packages via `pip`. |
| **4** | **Check FFmpeg & NVENC** | Validates `ffmpeg`, `ffprobe`, and checks for `h264_nvenc` hardware acceleration. |
| **5** | **Check Repository VoxCPM2** | Verifies the repository's native VoxCPM2 engine implementation in `worker/tts/voxcpm2_engine.py`. |
| **6** | **Download & Verify Models** | Verifies model directory structure and caches required checkpoint configuration. |
| **7** | **Load VoxCPM2 into GPU Memory** | Initializes and loads VoxCPM2 weights directly into GPU memory for low-latency synthesis. |
| **8** | **Validate Whisper & Edge TTS** | Tests transcription bindings and Microsoft Edge TTS synthesizer availability. |
| **9** | **Validate Video Pipeline** | Verifies core extraction, timeline reconstruction, and muxing modules. |
| **10** | **Run Real GPU Inference Test** | Executes an actual zero-shot audio synthesis pass and verifies generated waveform duration. |
| **11** | **Register Worker & Telemetry** | Registers capabilities with `workerBridge` and starts real-time health heartbeats. |
| **12** | **Worker Ready** | Marks status as `ready`, persists `.worker_init_manifest.json`, and unlocks the Dashboard. |

---

## 🛠 Core Engine Components

### CUDA / GPU Detection
The engine checks `torch.cuda.is_available()`, device name, and total VRAM (in MB). If a discrete GPU is not detected, it gracefully falls back to CPU compatibility mode while logging the exact execution mode.

### Automated Package & Dependency Management
- Reads `worker/kaggle/dependencies.json`.
- Dynamically tests Python imports for each dependency.
- Installs only missing packages automatically using `python3 -m pip install`.
- **Note**: The native VoxCPM2 system is bundled inside `worker/tts/` and is never fetched from external unverified package indexes.

### Model Management & Cache Verification
- Verifies model files under `models/voxcpm2/`.
- Validates model architecture configuration and weight integrity.

### VoxCPM2 Resident Zero-Shot Voice Cloning
- Implemented in `worker/tts/voxcpm2_engine.py`.
- Pre-loads model weights directly into resident VRAM during worker initialization.
- Supports zero-shot voice cloning using reference audio prompts.

### Whisper & Groq ASR Transcription
- High-speed audio transcription with word- and sentence-level timestamp alignments.
- Extracts speech segments to feed directly into the translation and summarization pipeline.

### Microsoft Edge Neural TTS
- Integrated high-fidelity neural text-to-speech fallback using `edge-tts`.
- Provides multi-language, multi-voice narration without requiring local GPU VRAM.

### TTS-Driven Dynamic Timeline Reconstruction
- **Duration-First Timing**: Accurately measures the exact output duration of each synthesized audio clip.
- **Dynamic Segment Retiming**: Slices and retimes corresponding source video clips to match the voiceover pace seamlessly without audio-video drift.

### FFmpeg Video Processing & Audio Mixing
- Executes demuxing, video retiming filters (`setpts`), and audio ducking curves (`sidechaincompress` / `volume` adjustments).
- Utilizes `h264_nvenc` for GPU-accelerated encoding when available, defaulting to `libx264` on CPU environments.

### External SRT Subtitle Generation
- Automatically builds standardized `.srt` subtitle files synchronized with the adjusted timeline timestamps.
- Available for separate download or direct preview alongside rendered videos.

---

## 📡 Queue & SSE Real-Time Progress System

- **Job Queue Engine**: Server-authoritative job queue supporting `queued`, `processing`, `completed`, and `failed` state transitions.
- **Server-Sent Events (SSE)**: Streams live progress updates, current active step, percentage completion, and real-time execution logs directly to the client UI.
- **Live Terminal View**: Collapsible in-browser terminal drawer displaying live log streams from the worker.

---

## 🖥 Dashboard Workflow

Once initialized, the Studio Dashboard provides a streamlined interface:

1. **Input Stage**: Paste a YouTube/web video URL or upload a local video file.
2. **Configuration**: Select the target narration language, voice engine (**VoxCPM2** or **Edge TTS**), voice persona, and recap pacing.
3. **Pipeline Execution**: Click **Generate Movie Recap** to dispatch the job to the worker queue.
4. **Live Monitoring**: Track progress through step-by-step indicators and real-time logs.
5. **Review & Export**: Preview the rendered video with custom subtitles in the integrated player, with one-click export for video (`.mp4`) and subtitle (`.srt`) assets.

---

## ⚙️ Settings & Configuration

The Settings panel allows configuring:
- **API Keys**: Gemini API Key (for recap structuring and translation) and Groq API Key (for high-speed Whisper ASR).
- **Worker Configuration**: Worker URL endpoint and connection parameters.
- **Video & Audio Preferences**: Target video resolution, codec preference (NVENC vs. libx264), background music volume, and narration volume balance.

---

## 📦 Kaggle Deployment & Startup

To run the application in a Kaggle GPU Notebook:

1. **Open a Kaggle Notebook** with GPU accelerator enabled (e.g. **GPU T4 x2** or **GPU P100**).
2. **Start the Application**:
   ```bash
   npm run start
   ```
   *(or `npm run dev` for development mode)*
3. **Open the Web Interface**:
   - Access the interface via the mapped port/proxy.
   - Click **[ Initialize Worker ]** on the setup screen.
   - The worker automatically handles dependency checks, model downloads, GPU tensor validation, and inference tests.
   - Click **[ Open Movie Recap Studio → ]** once initialization completes.
