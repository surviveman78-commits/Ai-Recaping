import os
from typing import List, Dict, Any

class GroqWhisperTranscriber:
    """
    Handles audio transcription with timestamps using Groq Whisper API (whisper-large-v3).
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        if not api_key:
            raise ValueError("Groq API key is required for Whisper transcription")

    def transcribe(self, audio_path: str) -> List[Dict[str, Any]]:
        """
        Transcribes the audio file and returns timestamped chunks:
        [
            {"start": 0.0, "end": 4.5, "text": "..."},
            ...
        ]
        """
        from groq import Groq

        client = Groq(api_key=self.api_key)

        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), file.read()),
                model="whisper-large-v3",
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        segments = []
        if hasattr(transcription, "segments") and transcription.segments:
            for s in transcription.segments:
                segments.append({
                    "start": round(float(s.get("start", 0.0)), 2),
                    "end": round(float(s.get("end", 0.0)), 2),
                    "text": s.get("text", "").strip(),
                })
        else:
            # Fallback to single chunk
            segments.append({
                "start": 0.0,
                "end": 10.0,
                "text": getattr(transcription, "text", "").strip(),
            })

        return segments
