import os
import json
import wave
import subprocess
from typing import Optional

from worker.core.tts.models import TTSError

def measure_audio_duration(audio_path: str) -> float:
    """
    Measures the authoritative, EXACT duration of an audio file in seconds.
    
    CRITICAL RULE:
    Estimated duration is NEVER used as the final duration.
    This method inspects the generated audio bitstream using multiple reliable
    subsystems (soundfile, standard wave module, ffprobe, or pydub).
    """
    if not os.path.isfile(audio_path):
        raise TTSError(
            f"Audio file does not exist at path: {audio_path}",
            code="TTS_AUDIO_NOT_FOUND",
            retryable=False
        )

    file_size = os.path.getsize(audio_path)
    if file_size < 44:
        raise TTSError(
            f"Audio file {audio_path} is truncated or empty ({file_size} bytes)",
            code="TTS_AUDIO_INVALID",
            retryable=True
        )

    # Strategy 1: soundfile (fast C library, sub-millisecond precision)
    try:
        import soundfile as sf
        with sf.SoundFile(audio_path) as f:
            if f.samplerate > 0 and len(f) > 0:
                duration = len(f) / float(f.samplerate)
                if duration > 0.001:
                    return round(duration, 3)
    except Exception:
        pass

    # Strategy 2: Standard Python wave module (lossless PCM WAV, zero external dependency)
    try:
        with wave.open(audio_path, 'rb') as wav_file:
            frames = wav_file.getnframes()
            rate = wav_file.getframerate()
            if rate > 0 and frames > 0:
                duration = frames / float(rate)
                if duration > 0.001:
                    return round(duration, 3)
    except Exception:
        pass

    # Strategy 3: ffprobe (authoritative media container parser)
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration:stream=duration",
            "-of", "json",
            audio_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip():
            info = json.loads(res.stdout)
            format_info = info.get("format", {})
            duration_str = format_info.get("duration")
            if duration_str:
                dur = float(duration_str)
                if dur > 0.001:
                    return round(dur, 3)
            # Check stream duration if format duration missing
            streams = info.get("streams", [])
            if streams and "duration" in streams[0]:
                dur = float(streams[0]["duration"])
                if dur > 0.001:
                    return round(dur, 3)
    except Exception:
        pass

    # Strategy 4: pydub
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(audio_path)
        dur = len(seg) / 1000.0
        if dur > 0.001:
            return round(dur, 3)
    except Exception:
        pass

    raise TTSError(
        f"Unable to determine duration of audio file {audio_path}",
        code="TTS_DURATION_FAILED",
        retryable=True
    )
