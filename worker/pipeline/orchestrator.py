import os
import time
from typing import Dict, Any, Callable, Optional, List

from worker.core.workspace import JobWorkspace
from worker.core.downloader import MovieDownloader
from worker.core.audio_extractor import AudioExtractor, AudioExtractionError
from worker.core.transcriber import GroqWhisperTranscriber, TranscriptionError
from worker.core.recap_generator import GeminiRecapGenerator, RecapGenerationError
from worker.core.tts import TTSManager, TTSError
from worker.core.timeline import TimelineEngine, TimelineValidationError

class RecapPipelineOrchestrator:
    """
    Executes the Download -> Audio Extract -> Groq Whisper -> Gemini Recap pipeline.
    Preserves debug artifacts in workspace/jobs/<job-id>/ and reports real-time progress.
    """

    STAGES = [
        "Downloading",
        "Extracting Audio",
        "Transcribing",
        "Translating / Rewriting",
        "Generating TTS",
        "Rebuilding Timeline",
        "Mixing Audio",
        "Rendering Subtitles",
        "Encoding Final Video",
        "Completed",
    ]

    def __init__(
        self,
        job_data: Dict[str, Any],
        voice_profile: Optional[Dict[str, Any]] = None,
        api_keys: Optional[Dict[str, str]] = None,
        work_dir: Optional[str] = None,
        progress_callback: Optional[Callable[[str, int, int, Dict[str, Any]], None]] = None,
    ):
        self.job = job_data
        self.job_id = job_data["id"]
        self.voice_profile = voice_profile or {}
        self.api_keys = api_keys or {}
        self.progress_callback = progress_callback

        # Initialize isolated workspace for this job
        self.workspace = JobWorkspace(job_id=self.job_id, base_dir=work_dir)

    def notify(self, stage_name: str, stage_number: int, progress: int, extra_data: Optional[Dict[str, Any]] = None):
        """Sends sanitized progress event to callback."""
        if self.progress_callback:
            self.progress_callback(stage_name, stage_number, progress, extra_data or {})

    def run(self) -> Dict[str, Any]:
        """
        Runs the primary pipeline:
        Movie URL
           ↓
        yt-dlp download
           ↓
        FFmpeg audio extraction
           ↓
        Groq Whisper transcription
           ↓
        Timestamped original transcript
           ↓
        Gemini translation / recap rewrite
           ↓
        Validated structured recap JSON
        """
        source_type = self.job.get("sourceType", "url")
        source_url = self.job.get("sourceUrl", "").strip()
        uploaded_file_id = self.job.get("uploadedFileId")
        uploaded_file_name = self.job.get("uploadedFileName") or "Uploaded Video"
        target_language = self.job.get("targetLanguage", "English")
        job_title = self.job.get("title") or "Movie"

        # -------------------------------------------------------------
        # STAGE 1: Real Movie Download via yt-dlp OR Upload Processing
        # -------------------------------------------------------------
        video_metadata: Dict[str, Any] = {}

        if source_type == "upload":
            self.notify("Downloading", 1, 10, {"message": f"Processing local uploaded video: {uploaded_file_name}..."})
            
            # If movie.mp4 does not exist in workspace, find it in uploads/videos
            if not os.path.exists(self.workspace.source_video_path) and uploaded_file_id:
                candidate_paths = [
                    os.path.join("uploads", "videos", f"{uploaded_file_id}.mp4"),
                    os.path.join("uploads", "videos", f"{uploaded_file_id}.mov"),
                    os.path.join("uploads", "videos", f"{uploaded_file_id}.mkv"),
                    os.path.join("uploads", "videos", f"{uploaded_file_id}.webm"),
                    os.path.join("uploads", "videos", uploaded_file_id),
                ]
                for cp in candidate_paths:
                    if os.path.exists(cp):
                        shutil.copy2(cp, self.workspace.source_video_path)
                        break

            # Probe media metadata via ffprobe
            try:
                import subprocess, json
                probe_cmd = [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration,size:stream=width,height",
                    "-of", "json",
                    self.workspace.source_video_path
                ]
                res = subprocess.run(probe_cmd, capture_output=True, text=True)
                if res.returncode == 0:
                    probe_data = json.loads(res.stdout)
                    fmt = probe_data.get("format", {})
                    duration = float(fmt.get("duration", 60.0))
                    size = int(fmt.get("size", os.path.getsize(self.workspace.source_video_path)))
                    stream = probe_data.get("streams", [{}])[0] if probe_data.get("streams") else {}
                    video_metadata = {
                        "title": job_title,
                        "duration": duration,
                        "width": stream.get("width", 1920),
                        "height": stream.get("height", 1080),
                        "filesize": size,
                        "sourceType": "upload",
                    }
                else:
                    video_metadata = {
                        "title": job_title,
                        "duration": 60.0,
                        "width": 1920,
                        "height": 1080,
                        "filesize": os.path.getsize(self.workspace.source_video_path) if os.path.exists(self.workspace.source_video_path) else 0,
                        "sourceType": "upload",
                    }
            except Exception:
                video_metadata = {
                    "title": job_title,
                    "duration": 60.0,
                    "width": 1920,
                    "height": 1080,
                    "filesize": 0,
                    "sourceType": "upload",
                }

            self.workspace.save_json(self.workspace.source_metadata_path, video_metadata)
            self.notify("Downloading", 1, 100, {
                "message": f"Uploaded video ready: {video_metadata.get('title')} ({video_metadata.get('duration', 0):.1f}s)",
                "title": video_metadata.get("title"),
                "metrics": {
                    "sourceType": "upload",
                    "videoDuration": video_metadata.get("duration"),
                    "width": video_metadata.get("width"),
                    "height": video_metadata.get("height"),
                    "filesize": video_metadata.get("filesize"),
                },
            })
        else:
            self.notify("Downloading", 1, 0, {"message": "Initializing movie stream download..."})

            downloader = MovieDownloader()

            def dl_progress(evt: Dict[str, Any]):
                pct = int(evt.get("progress", 0))
                self.notify(
                    "Downloading",
                    1,
                    pct,
                    {
                        "message": evt.get("message", f"Downloading movie... ({pct}%)"),
                        "metrics": evt.get("metrics", {}),
                    },
                )

            try:
                video_metadata = downloader.download(
                    source_url=source_url,
                    output_file_path=self.workspace.source_video_path,
                    progress_callback=dl_progress,
                )
                # Save metadata
                self.workspace.save_json(self.workspace.source_metadata_path, video_metadata)

                self.notify("Downloading", 1, 100, {
                    "message": f"Download finished: {video_metadata.get('title', 'Movie')} ({video_metadata.get('duration', 0):.1f}s)",
                    "title": video_metadata.get("title"),
                    "thumbnailUrl": video_metadata.get("thumbnail_url"),
                    "metrics": {
                        "sourceType": "url",
                        "videoDuration": video_metadata.get("duration"),
                        "width": video_metadata.get("width"),
                        "height": video_metadata.get("height"),
                        "filesize": video_metadata.get("filesize"),
                    },
                })
            except Exception as dl_err:
                raise {
                    "stage": "Downloading",
                    "code": "VIDEO_DOWNLOAD_FAILED",
                    "message": f"Failed to download source video: {str(dl_err)}",
                    "retryable": True,
                }

        video_duration = float(video_metadata.get("duration", 0.0))

        # -------------------------------------------------------------
        # STAGE 2: FFmpeg 16kHz Mono Audio Extraction
        # -------------------------------------------------------------
        self.notify("Extracting Audio", 2, 0, {"message": "Extracting 16kHz mono audio track..."})

        extractor = AudioExtractor(sample_rate=16000, channels=1)
        audio_metadata: Dict[str, Any] = {}

        def audio_progress(evt: Dict[str, Any]):
            pct = int(evt.get("progress", 0))
            self.notify(
                "Extracting Audio",
                2,
                pct,
                {
                    "message": evt.get("message", "Extracting audio..."),
                    "metrics": evt.get("metrics", {}),
                },
            )

        try:
            audio_metadata = extractor.extract_audio(
                video_path=self.workspace.source_video_path,
                output_audio_path=self.workspace.extracted_audio_path,
                video_duration=video_duration,
                progress_callback=audio_progress,
            )
            self.workspace.save_json(self.workspace.audio_metadata_path, audio_metadata)

            self.notify("Extracting Audio", 2, 100, {
                "message": f"Audio track ready ({audio_metadata.get('duration', 0):.1f}s, 16kHz WAV)",
                "metrics": audio_metadata,
            })
        except AudioExtractionError as aee:
            raise aee.payload
        except Exception as ae:
            raise {
                "stage": "Extracting Audio",
                "code": "AUDIO_EXTRACTION_FAILED",
                "message": f"Audio extraction failed: {str(ae)}",
                "retryable": False,
            }

        audio_duration = float(audio_metadata.get("duration", video_duration))

        # -------------------------------------------------------------
        # STAGE 3: Groq Whisper Transcription
        # -------------------------------------------------------------
        self.notify("Transcribing", 3, 0, {"message": "Preparing audio for Groq Whisper transcription..."})

        groq_key = (self.api_keys.get("groqApiKey") or os.getenv("GROQ_API_KEY") or "").strip()
        whisper_model = os.getenv("WHISPER_MODEL", "whisper-large-v3")
        transcript_data: Dict[str, Any] = {}

        def trans_progress(evt: Dict[str, Any]):
            pct = int(evt.get("progress", 0))
            self.notify(
                "Transcribing",
                3,
                pct,
                {
                    "message": evt.get("message", "Transcribing dialogue..."),
                    "metrics": evt.get("metrics", {}),
                    "originalTranscript": evt.get("originalTranscript"),
                },
            )

        try:
            if not groq_key:
                raise TranscriptionError(
                    "Groq API key is required for Whisper transcription. Please configure your Groq API key in Settings.",
                    retryable=False,
                    code="MISSING_GROQ_KEY"
                )

            transcriber = GroqWhisperTranscriber(api_key=groq_key, model=whisper_model)
            transcript_data = transcriber.transcribe_movie_audio(
                audio_path=self.workspace.extracted_audio_path,
                output_json_path=self.workspace.original_transcript_json_path,
                output_txt_path=self.workspace.original_transcript_txt_path,
                total_duration=audio_duration,
                progress_callback=trans_progress,
            )

            transcript_segments = transcript_data.get("segments", [])
            self.notify("Transcribing", 3, 100, {
                "message": f"Transcribed {len(transcript_segments)} dialogue segments",
                "originalTranscript": transcript_segments,
            })

        except TranscriptionError as te:
            raise te.payload
        except Exception as te_generic:
            raise {
                "stage": "Transcribing",
                "code": "WHISPER_TRANSCRIPTION_FAILED",
                "message": f"Transcription error: {str(te_generic)}",
                "retryable": True,
            }

        # -------------------------------------------------------------
        # STAGE 4: Gemini Translation & Recap Rewrite
        # -------------------------------------------------------------
        self.notify("Translating / Rewriting", 4, 0, {
            "message": f"Synthesizing recap script in {target_language} with Gemini...",
        })

        gemini_key = (self.api_keys.get("geminiApiKey") or os.getenv("GEMINI_API_KEY") or "").strip()
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        recap_result: Dict[str, Any] = {}

        def recap_progress(evt: Dict[str, Any]):
            pct = int(evt.get("progress", 0))
            self.notify(
                "Translating / Rewriting",
                4,
                pct,
                {
                    "message": evt.get("message", "Synthesizing recap narration..."),
                    "metrics": evt.get("metrics", {}),
                    "translatedScript": evt.get("translatedScript"),
                    "recapSegments": evt.get("recapSegments"),
                },
            )

        try:
            if not gemini_key:
                raise RecapGenerationError(
                    "Gemini API key is required for recap generation. Please configure your Gemini API key in Settings.",
                    retryable=False,
                    code="MISSING_GEMINI_KEY"
                )

            recap_generator = GeminiRecapGenerator(api_key=gemini_key, model=gemini_model)
            recap_result = recap_generator.generate_recap(
                movie_title=video_metadata.get("title") or job_title,
                transcript_segments=transcript_segments,
                target_language=target_language,
                total_video_duration=video_duration or audio_duration,
                output_json_path=self.workspace.recap_json_path,
                output_txt_path=self.workspace.recap_txt_path,
                progress_callback=recap_progress,
            )

            final_recap_segments = recap_result.get("segments", [])

            self.notify("Translating / Rewriting", 4, 100, {
                "message": f"Structured recap ready ({len(final_recap_segments)} narration segments)",
                "translatedScript": recap_result.get("fullRecapText"),
                "recapSegments": final_recap_segments,
            })

        except RecapGenerationError as rge:
            raise rge.payload
        except Exception as rge_generic:
            raise {
                "stage": "Translating / Rewriting",
                "code": "GEMINI_REWRITE_FAILED",
                "message": f"Recap generation failed: {str(rge_generic)}",
                "retryable": True,
            }

        # -------------------------------------------------------------
        # PIPELINE COMPLETION FOR CURRENT STAGE
        # -------------------------------------------------------------
        # Per specification: The current task ends after the structured recap
        # JSON has been successfully generated. TTS and downstream stages
        # are scheduled for subsequent prompts.
        recap_segments = recap_result.get("segments", [])

        # -------------------------------------------------------------
        # STAGE 5: Generating TTS (Sentence-Aware Chunking & Real Duration Measurement)
        # -------------------------------------------------------------
        self.notify("Generating TTS", 5, 0, {
            "message": "Initializing TTS provider and long-form narrative chunking...",
        })

        tts_engine = (self.job.get("selectedTtsEngine") or self.job.get("ttsEngine") or "edge-tts").strip().lower()
        edge_voice = self.job.get("edgeVoice")
        voice_profile = self.voice_profile or self.job.get("voiceProfile")
        speed = float(self.job.get("speed") or (voice_profile.get("speed") if voice_profile else 1.0) or 1.0)
        generation_settings = self.job.get("generationSettings") or (voice_profile.get("generationSettings") if voice_profile else None)

        tts_manager = TTSManager(tts_dir=self.workspace.tts_dir)
        tts_result: Dict[str, Any] = {}

        def tts_progress(evt: Dict[str, Any]):
            pct = int(evt.get("progress", 0))
            self.notify(
                "Generating TTS",
                5,
                pct,
                {
                    "message": evt.get("message", "Synthesizing voiceover..."),
                    "metrics": evt.get("metrics", {}),
                },
            )

        try:
            tts_result = tts_manager.process_recap_segments(
                recap_segments=recap_segments,
                tts_engine=tts_engine,
                voice_profile=voice_profile,
                edge_voice=edge_voice,
                target_language=target_language,
                speed=speed,
                generation_settings=generation_settings,
                progress_callback=tts_progress,
            )

            # Map to authoritative Segment format with REAL MEASURED TTS DURATION
            legacy_segments = []
            authoritative_recap_segs = tts_result.get("segments", [])

            for s in authoritative_recap_segs:
                seg_id = s["recapSegmentId"]
                real_tts_dur = float(s["totalTtsDuration"])
                src_dur = float(s["sourceDuration"])
                src_start = float(s["sourceStart"])
                src_end = float(s["sourceEnd"])

                legacy_segments.append({
                    "id": seg_id,
                    "sourceStart": src_start,
                    "sourceEnd": src_end,
                    "sourceDuration": src_dur,
                    "scriptText": s["targetText"],
                    "ttsDuration": real_tts_dur,  # AUTHORITATIVE REAL MEASURED DURATION
                    "ttsAudioPath": s["ttsChunks"][0]["audioPath"] if s.get("ttsChunks") else "",
                    "ttsChunks": s.get("ttsChunks", []),
                    "finalStart": src_start,      # Timeline Engine (Prompt 05) will reconstruct final timeline
                    "finalEnd": src_start + real_tts_dur,
                    "subtitleStart": src_start,
                    "subtitleEnd": src_start + real_tts_dur,
                })

            total_tts_dur = tts_result.get("totalTtsDuration", 0.0)
            total_chunks_count = len(tts_result.get("chunks", []))

            self.notify("Generating TTS", 5, 100, {
                "message": f"TTS narration completed ({total_tts_dur:.2f}s across {total_chunks_count} chunks). Authoritative metadata ready.",
                "metrics": {
                    "ttsEngine": tts_engine,
                    "totalTtsDuration": total_tts_dur,
                    "totalChunks": total_chunks_count,
                    "voiceProfile": (voice_profile.get("name") if voice_profile else edge_voice) or "Neural Voice",
                },
                "segments": legacy_segments,
                "recapSegments": authoritative_recap_segs,
                "ttsChunks": tts_result.get("chunks", []),
            })

        except TTSError as tte:
            raise tte.payload
        except Exception as tte_generic:
            raise {
                "stage": "Generating TTS",
                "code": "TTS_SYNTHESIS_FAILED",
                "message": f"TTS synthesis failed: {str(tte_generic)}",
                "retryable": True,
            }

        # -------------------------------------------------------------
        # STAGE 6: Rebuilding Timeline (TTS-Driven Dynamic Reconstruction)
        # -------------------------------------------------------------
        self.notify("Rebuilding Timeline", 6, 0, {
            "message": "Initializing TTS-driven timeline reconstruction...",
        })

        def timeline_progress(evt: Dict[str, Any]):
            pct = int(evt.get("progress", 0))
            self.notify(
                "Rebuilding Timeline",
                6,
                pct,
                {
                    "message": evt.get("message", "Rebuilding video timeline..."),
                    "timelineSegmentIndex": evt.get("timelineSegmentIndex"),
                    "timelineSegmentCount": evt.get("timelineSegmentCount"),
                    "sourceDuration": evt.get("sourceDuration"),
                    "targetTtsDuration": evt.get("targetTtsDuration"),
                    "operation": evt.get("operation"),
                },
            )

        timeline_engine = TimelineEngine(duration_tolerance=0.08)
        timeline_result: Dict[str, Any] = {}

        try:
            has_source_video = os.path.exists(self.workspace.source_video_path)
            timeline_result = timeline_engine.process_timeline(
                source_video_path=self.workspace.source_video_path,
                tts_dir=self.workspace.tts_dir,
                timeline_dir=self.workspace.timeline_dir,
                subtitles_dir=self.workspace.subtitles_dir,
                target_language=target_language,
                progress_callback=timeline_progress,
                is_cancelled=lambda: False,
                render_video_files=has_source_video,
            )

            reconstructed_segs = timeline_result.get("segments", [])
            total_timeline_dur = timeline_result.get("totalDuration", 0.0)

            # Map reconstructed segments into job format
            final_job_segments = []
            for rs in reconstructed_segs:
                final_job_segments.append({
                    "id": rs.get("recapSegmentId") or f"seg_{rs.get('timelineIndex', 0) + 1}",
                    "sourceStart": rs.get("sourceStart"),
                    "sourceEnd": rs.get("sourceEnd"),
                    "sourceDuration": rs.get("sourceDuration"),
                    "scriptText": rs.get("targetText"),
                    "ttsDuration": rs.get("ttsDuration"),
                    "ttsAudioPath": rs.get("ttsAudioPath"),
                    "finalStart": rs.get("finalStart"),
                    "finalEnd": rs.get("finalEnd"),
                    "subtitleStart": rs.get("finalStart"),
                    "subtitleEnd": rs.get("finalEnd"),
                    "operation": rs.get("operation"),
                    "videoPath": rs.get("videoPath"),
                })

            self.notify("Rebuilding Timeline", 6, 100, {
                "message": f"Timeline reconstructed ({total_timeline_dur:.2f}s across {len(reconstructed_segs)} segments). Standalone recap.srt generated.",
                "segments": final_job_segments,
                "timelineSegments": reconstructed_segs,
                "totalDuration": total_timeline_dur,
                "srtPath": timeline_result.get("srtPath"),
                "srtCueCount": timeline_result.get("srtCueCount"),
            })

        except TimelineValidationError as tve:
            raise {
                "stage": "Rebuilding Timeline",
                "code": "TIMELINE_VALIDATION_FAILED",
                "message": str(tve),
                "retryable": False,
            }
        except Exception as te_generic:
            raise {
                "stage": "Rebuilding Timeline",
                "code": "TIMELINE_RECONSTRUCTION_FAILED",
                "message": f"Timeline reconstruction failed: {str(te_generic)}",
                "retryable": True,
            }

        # -------------------------------------------------------------
        # PIPELINE COMPLETION FOR PROMPT 05
        # -------------------------------------------------------------
        # Per specification: Prompt 05 ends at Stage 6 (Rebuilding Timeline -> Complete),
        # producing timeline/timeline.json, intermediate video segments, and subtitles/recap.srt.
        # DO NOT mix audio or encode final video in this stage.
        return {
            "status": "timeline_completed",
            "source_video_path": self.workspace.source_video_path,
            "extracted_audio_path": self.workspace.extracted_audio_path,
            "original_transcript_path": self.workspace.original_transcript_json_path,
            "original_transcript_txt_path": self.workspace.original_transcript_txt_path,
            "recap_json_path": self.workspace.recap_json_path,
            "recap_txt_path": self.workspace.recap_txt_path,
            "tts_segments_path": self.workspace.tts_segments_json_path,
            "tts_chunks_path": self.workspace.tts_chunks_json_path,
            "tts_manifest_path": self.workspace.tts_manifest_json_path,
            "timeline_json_path": timeline_result.get("timelineJsonPath"),
            "timeline_manifest_path": timeline_result.get("timelineManifestPath"),
            "subtitles_srt_path": timeline_result.get("srtPath"),
            "subtitles_manifest_path": timeline_result.get("srtManifestPath"),
            "original_transcript": transcript_segments,
            "translated_script": recap_result.get("fullRecapText"),
            "recap_segments": authoritative_recap_segs,
            "tts_chunks": tts_result.get("chunks", []),
            "timeline_segments": reconstructed_segs,
            "segments": final_job_segments,
            "total_tts_duration": total_tts_dur,
            "total_timeline_duration": total_timeline_dur,
            "srt_cue_count": timeline_result.get("srtCueCount"),
            "metadata": video_metadata,
        }
