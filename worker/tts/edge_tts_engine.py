import os
import asyncio
from typing import Tuple

class EdgeTtsEngine:
    """
    Microsoft Edge TTS engine. Generates audio for a script sentence and measures exact duration.
    """

    def __init__(self, voice: str = "en-US-ChristopherNeural"):
        self.voice = voice

    async def _generate_async(self, text: str, output_path: str, rate: str = "+0%") -> None:
        import edge_tts
        communicate = edge_tts.Communicate(text, self.voice, rate=rate)
        await communicate.save(output_path)

    def generate_speech(self, text: str, output_path: str, rate: str = "+0%") -> float:
        """
        Generates TTS audio file and returns the EXACT measured duration in seconds.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        asyncio.run(self._generate_async(text, output_path, rate=rate))

        # Measure actual duration
        duration = self.measure_duration(output_path)
        return duration

    @staticmethod
    def measure_duration(audio_path: str) -> float:
        """
        Measures exact duration in seconds using soundfile, pydub, or ffprobe.
        """
        try:
            import soundfile as sf
            f = sf.SoundFile(audio_path)
            return round(len(f) / float(f.samplerate), 2)
        except Exception:
            pass

        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(audio_path)
            return round(len(audio) / 1000.0, 2)
        except Exception:
            pass

        # Fallback to ffprobe
        import subprocess
        import json
        cmd = [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "json", audio_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        info = json.loads(result.stdout)
        return round(float(info["format"]["duration"]), 2)
