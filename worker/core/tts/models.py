import os
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List

@dataclass
class TTSChunk:
    """
    Represents an individual TTS generation chunk created from a recap segment.
    Notice the strict separation:
      Recap Segments = narrative video cuts (source-video timing)
      TTS Chunks = short, safe TTS audio generation units (preferred 20-27s, max ~30s)
    """
    tts_chunk_id: str                          # e.g. "tts_0001"
    recap_segment_id: str                      # e.g. "seg_0001"
    chunk_index: int                           # 0-indexed chunk within this recap segment
    chunk_count_for_recap_segment: int         # Total chunks needed for this recap segment
    text: str                                  # The chunk's text to synthesize
    estimated_duration: float                  # Estimated duration (used only for chunking decisions)
    source_start: float                        # Start time in source video
    source_end: float                          # End time in source video
    source_duration: float                     # Duration in source video (source_end - source_start)
    source_text: str                           # Original source dialogue / context
    target_text: str                           # Full target narration for the recap segment
    tts_audio_path: Optional[str] = None       # Relative or absolute path to generated WAV chunk
    tts_duration: Optional[float] = None       # ACTUAL MEASURED DURATION in seconds (never estimated!)
    tts_engine: str = "edge-tts"
    voice_profile_id: Optional[str] = None
    status: str = "pending"                    # "pending" | "generated" | "failed"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ttsChunkId": self.tts_chunk_id,
            "recapSegmentId": self.recap_segment_id,
            "chunkIndex": self.chunk_index,
            "chunkCountForRecapSegment": self.chunk_count_for_recap_segment,
            "sourceStart": round(float(self.source_start), 3),
            "sourceEnd": round(float(self.source_end), 3),
            "sourceDuration": round(float(self.source_duration), 3),
            "sourceText": self.source_text,
            "targetText": self.target_text,
            "chunkText": self.text,
            "ttsAudioPath": self.tts_audio_path or "",
            "ttsDuration": round(float(self.tts_duration), 3) if self.tts_duration is not None else None,
            "ttsEngine": self.tts_engine,
            "voiceProfileId": self.voice_profile_id,
            "status": self.status,
            "metadata": self.metadata,
        }

@dataclass
class TTSGenerationRequest:
    """Request payload sent to a TTS provider."""
    text: str
    output_path: str
    tts_engine: str
    voice_profile: Optional[Dict[str, Any]] = None
    edge_voice: Optional[str] = None
    language: Optional[str] = None
    speed: float = 1.0
    pitch: Optional[str] = None
    volume: Optional[str] = None
    generation_settings: Optional[Dict[str, Any]] = None

@dataclass
class TTSGenerationResult:
    """Outcome of a successful TTS synthesis."""
    audio_path: str
    actual_duration: float
    sample_rate: int
    channels: int
    engine: str
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class TTSEngineCapabilities:
    """Capabilities and constraints of a TTS engine."""
    engine_name: str
    supports_zero_shot: bool
    preferred_chunk_seconds_min: float = 20.0
    preferred_chunk_seconds_max: float = 27.0
    hard_max_chunk_seconds: float = 30.0
    default_sample_rate: int = 24000
    requires_reference_audio: bool = False
    supports_pitch: bool = True
    supports_rate: bool = True

class TTSError(Exception):
    """Structured error payload for TTS stages."""
    def __init__(self, message: str, code: str = "TTS_ERROR", retryable: bool = True, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.payload = {
            "stage": "Generating TTS",
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
        }
