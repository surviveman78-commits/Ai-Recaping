from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
import math

class TimelineOperation(str, Enum):
    DIRECT = "direct"
    TRIM = "trim"
    EXTEND_FORWARD = "extend_forward"
    LOOP = "loop"
    FREEZE_LAST_FRAME = "freeze_last_frame"

@dataclass
class TimelineSegment:
    """
    Represents a single continuous video segment on the reconstructed narration timeline.
    
    CORE RULE:
    The ACTUAL generated TTS duration is the source of truth for finalDuration.
    finalSegmentDuration = actualTtsDuration (NOT sourceDuration)
    """
    timeline_index: int
    tts_chunk_id: str
    recap_segment_id: str
    source_start: float
    source_end: float
    source_duration: float
    tts_duration: float
    final_start: float
    final_end: float
    final_duration: float
    operation: TimelineOperation
    video_path: Optional[str] = None
    target_text: str = ""
    chunk_index: int = 0
    chunk_count: int = 1
    tts_audio_path: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timelineIndex": self.timeline_index,
            "ttsChunkId": self.tts_chunk_id,
            "recapSegmentId": self.recap_segment_id,
            "sourceStart": round(float(self.source_start), 3),
            "sourceEnd": round(float(self.source_end), 3),
            "sourceDuration": round(float(self.source_duration), 3),
            "ttsDuration": round(float(self.tts_duration), 3),
            "finalStart": round(float(self.final_start), 3),
            "finalEnd": round(float(self.final_end), 3),
            "finalDuration": round(float(self.final_duration), 3),
            "operation": self.operation.value if isinstance(self.operation, TimelineOperation) else str(self.operation),
            "videoPath": self.video_path or "",
            "targetText": self.target_text,
            "chunkIndex": self.chunk_index,
            "chunkCount": self.chunk_count,
            "ttsAudioPath": self.tts_audio_path or "",
            "metadata": self.metadata,
        }

@dataclass
class SRTCue:
    """
    Represents a SubRip (.srt) subtitle cue aligned with the final timeline clock.
    """
    sequence_number: int
    start_time: float      # Seconds from timeline 0.0
    end_time: float        # Seconds from timeline 0.0
    text: str
    timeline_index: int
    timing_method: str = "proportional_sentence_split"  # "exact" | "proportional_sentence_split"

    @staticmethod
    def format_timestamp(seconds: float) -> str:
        """Formats floating seconds to SubRip timestamp HH:MM:SS,mmm"""
        clamped = max(0.0, float(seconds))
        total_ms = int(round(clamped * 1000.0))
        hours = total_ms // 3600000
        total_ms %= 3600000
        minutes = total_ms // 60000
        total_ms %= 60000
        secs = total_ms // 1000
        ms = total_ms % 1000
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"

    def to_srt_block(self) -> str:
        start_str = self.format_timestamp(self.start_time)
        end_str = self.format_timestamp(self.end_time)
        clean_text = self.text.strip()
        return f"{self.sequence_number}\n{start_str} --> {end_str}\n{clean_text}\n"
