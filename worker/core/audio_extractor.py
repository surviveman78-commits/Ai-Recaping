import os
import re
import json
import subprocess
from typing import Dict, Any, Callable, Optional

class AudioExtractionError(Exception):
    """Structured error thrown when audio extraction fails."""
    def __init__(self, message: str, details: Optional[str] = None):
        super().__init__(message)
        self.payload = {
            "code": "AUDIO_EXTRACTION_FAILED",
            "stage": "extracting_audio",
            "message": sanitize_error_message(message),
            "retryable": False,
            "details": sanitize_error_message(details) if details else None,
        }

def sanitize_error_message(msg: str) -> str:
    """Strips any API keys, tokens, or sensitive credentials from error text."""
    if not msg:
        return ""
    # Redact common key patterns
    redacted = re.sub(r'(gsk_[A-Za-z0-9_-]{20,})', '[REDACTED_GROQ_KEY]', msg)
    redacted = re.sub(r'(AIza[0-9A-Za-z-_]{35})', '[REDACTED_GEMINI_KEY]', redacted)
    redacted = re.sub(r'(Bearer\s+[A-Za-z0-9_-]+)', 'Bearer [REDACTED_TOKEN]', redacted)
    return redacted

class AudioExtractor:
    """
    Extracts high-fidelity audio from video files using FFmpeg.
    Converts directly to 16kHz, 16-bit, Mono PCM WAV for optimal Whisper transcription.
    Never loads full audio into memory.
    """

    def __init__(self, sample_rate: int = 16000, channels: int = 1):
        self.sample_rate = sample_rate
        self.channels = channels

    def extract_audio(
        self,
        video_path: str,
        output_audio_path: str,
        video_duration: Optional[float] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Extracts 16kHz mono PCM WAV from video_path.
        Returns audio metadata dictionary.
        """
        if not os.path.exists(video_path):
            raise AudioExtractionError(f"Input video file not found: {video_path}")

        os.makedirs(os.path.dirname(output_audio_path), exist_ok=True)

        if progress_callback:
            progress_callback({
                "stage": "extracting_audio",
                "progress": 5.0,
                "message": "Initializing FFmpeg 16kHz mono audio extraction...",
            })

        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(self.sample_rate),
            "-ac", str(self.channels),
            "-progress", "pipe:1",
            output_audio_path,
        ]

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                bufsize=1,
            )

            out_time_ms_regex = re.compile(r"out_time_ms=(\d+)")

            for line in proc.stdout:
                line_str = line.strip()
                match = out_time_ms_regex.match(line_str)
                if match and video_duration and video_duration > 0:
                    current_ms = int(match.group(1))
                    current_sec = current_ms / 1000000.0
                    progress_pct = min(98.0, max(5.0, (current_sec / video_duration) * 100.0))

                    if progress_callback:
                        progress_callback({
                            "stage": "extracting_audio",
                            "progress": round(progress_pct, 1),
                            "message": f"Extracting 16kHz audio track... ({progress_pct:.0f}%)",
                            "metrics": {
                                "extractedSeconds": round(current_sec, 1),
                                "totalSeconds": round(video_duration, 1),
                            },
                        })

            stdout_unused, stderr_text = proc.communicate()
            if proc.returncode != 0:
                raise AudioExtractionError(
                    f"FFmpeg process exited with return code {proc.returncode}",
                    details=stderr_text[-500:] if stderr_text else "No stderr details",
                )

        except AudioExtractionError:
            raise
        except Exception as e:
            raise AudioExtractionError(f"Audio extraction process failed: {str(e)}")

        if not os.path.exists(output_audio_path) or os.path.getsize(output_audio_path) == 0:
            raise AudioExtractionError(f"Extracted audio file is missing or empty at {output_audio_path}")

        # Probe extracted audio metadata
        audio_duration = self._probe_audio_duration(output_audio_path, fallback=video_duration or 0.0)

        if progress_callback:
            progress_callback({
                "stage": "extracting_audio",
                "progress": 100.0,
                "message": f"Audio extracted successfully ({audio_duration:.1f}s, 16kHz PCM WAV)",
                "metrics": {
                    "audioDuration": audio_duration,
                    "sampleRate": self.sample_rate,
                    "channels": self.channels,
                },
            })

        metadata = {
            "audio_path": output_audio_path,
            "duration": round(audio_duration, 2),
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "filesize": os.path.getsize(output_audio_path),
        }
        return metadata

    def _probe_audio_duration(self, audio_path: str, fallback: float) -> float:
        """Determines exact audio duration using ffprobe."""
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            audio_path,
        ]
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            info = json.loads(res.stdout)
            return float(info.get("format", {}).get("duration", fallback))
        except Exception:
            return fallback
