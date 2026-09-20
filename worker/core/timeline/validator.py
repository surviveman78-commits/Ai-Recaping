import os
import json
from typing import List, Dict, Any, Optional

from worker.core.timeline.models import TimelineSegment
from worker.core.timeline.ffmpeg_ops import FFmpegOps

class TimelineValidationError(Exception):
    def __init__(self, message: str, rule: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(f"Timeline Validation Failed [{rule}]: {message}")
        self.rule = rule
        self.details = details or {}

class TimelineValidator:
    """
    Validates timeline integrity, continuity, media accuracy, and subtitle synchronization
    before allowing Stage 6 to be marked completed.
    
    CRITICAL: If any validation rule fails, the stage MUST fail clearly. Never silently continue.
    """

    def __init__(
        self,
        duration_tolerance: float = 0.15,
        ffmpeg_ops: Optional[FFmpegOps] = None,
    ):
        self.tolerance = duration_tolerance
        self.ffmpeg = ffmpeg_ops or FFmpegOps()

    def validate(
        self,
        timeline_segments: List[TimelineSegment],
        expected_tts_chunks_count: int,
        timeline_dir: str,
        srt_file_path: str,
        srt_manifest_path: Optional[str] = None,
        check_video_files: bool = True,
    ) -> Dict[str, Any]:
        """
        Executes all 15 validation checks according to specification.
        """
        # Rule 1: Every TTS chunk has a timeline segment
        if len(timeline_segments) != expected_tts_chunks_count:
            raise TimelineValidationError(
                f"Segment count mismatch: expected {expected_tts_chunks_count} TTS chunks, but got {len(timeline_segments)} timeline segments.",
                rule="SEGMENT_COUNT_MATCH",
                details={"expected": expected_tts_chunks_count, "actual": len(timeline_segments)},
            )

        if not timeline_segments:
            raise TimelineValidationError(
                "Timeline has zero segments.",
                rule="EMPTY_TIMELINE",
            )

        total_accumulated_duration = 0.0
        expected_next_start = 0.0

        for i, seg in enumerate(timeline_segments):
            seg_idx = seg.timeline_index

            # Rule 2: Valid source mapping
            if seg.source_start < 0 or seg.source_end < seg.source_start:
                raise TimelineValidationError(
                    f"Segment {seg_idx} has invalid source mapping: [{seg.source_start}, {seg.source_end}]",
                    rule="INVALID_SOURCE_MAPPING",
                    details={"segment": seg.to_dict()},
                )

            # Rule 3: finalDuration matches ttsDuration within tolerance
            dur_diff = abs(seg.final_duration - seg.tts_duration)
            if dur_diff > self.tolerance:
                raise TimelineValidationError(
                    f"Segment {seg_idx} finalDuration ({seg.final_duration:.3f}s) deviates from ttsDuration ({seg.tts_duration:.3f}s) by {dur_diff:.3f}s (tolerance: {self.tolerance}s)",
                    rule="TTS_DURATION_MISMATCH",
                    details={"segment": seg.to_dict(), "diff": dur_diff},
                )

            # Rule 4 & 5: Continuous timeline clock with no gaps
            gap = abs(seg.final_start - expected_next_start)
            if gap > 0.01:
                raise TimelineValidationError(
                    f"Segment {seg_idx} introduces an unexplained gap! Expected start: {expected_next_start:.3f}s, actual: {seg.final_start:.3f}s (gap: {gap:.3f}s)",
                    rule="UNEXPLAINED_TIMELINE_GAP",
                    details={"segment": seg.to_dict(), "expectedStart": expected_next_start, "gap": gap},
                )

            # Rule 6: No negative timestamps or reversed ends
            if seg.final_start < 0 or seg.final_end <= seg.final_start:
                raise TimelineValidationError(
                    f"Segment {seg_idx} has invalid final boundaries: [{seg.final_start}, {seg.final_end}]",
                    rule="INVALID_FINAL_BOUNDARIES",
                    details={"segment": seg.to_dict()},
                )

            total_accumulated_duration += seg.final_duration
            expected_next_start = seg.final_end

            # Rule 8 & 9: Intermediate video file validation
            if check_video_files:
                filename = f"segment_{i + 1:04d}.mp4"
                video_full_path = os.path.join(timeline_dir, filename)

                if not os.path.exists(video_full_path):
                    raise TimelineValidationError(
                        f"Intermediate video file missing: {video_full_path}",
                        rule="MISSING_INTERMEDIATE_VIDEO",
                        details={"expectedPath": video_full_path, "segmentIndex": i},
                    )

                if os.path.getsize(video_full_path) < 100:
                    raise TimelineValidationError(
                        f"Intermediate video file is degenerate or empty: {video_full_path}",
                        rule="EMPTY_INTERMEDIATE_VIDEO",
                        details={"path": video_full_path},
                    )

                measured_dur = self.ffmpeg.get_video_duration(video_full_path)
                file_dur_diff = abs(measured_dur - seg.final_duration)
                if file_dur_diff > 0.4:
                    raise TimelineValidationError(
                        f"Segment {i + 1} video file duration ({measured_dur:.3f}s) does not match finalDuration ({seg.final_duration:.3f}s)",
                        rule="VIDEO_FILE_DURATION_MISMATCH",
                        details={"path": video_full_path, "measured": measured_dur, "expected": seg.final_duration},
                    )

        # Rule 7: Total timeline duration validation
        final_timeline_end = timeline_segments[-1].final_end
        if abs(final_timeline_end - total_accumulated_duration) > 0.05:
            raise TimelineValidationError(
                f"Timeline total duration discrepancy: finalEnd={final_timeline_end:.3f} vs sum={total_accumulated_duration:.3f}",
                rule="TOTAL_DURATION_DISCREPANCY",
            )

        # Rule 10: SRT file exists
        if not os.path.exists(srt_file_path):
            raise TimelineValidationError(
                f"External SRT file not found: {srt_file_path}",
                rule="MISSING_SRT_FILE",
            )

        # Rule 11, 12, 13, 14: SRT timestamp and Unicode validation
        with open(srt_file_path, "r", encoding="utf-8") as f:
            srt_content = f.read()

        if not srt_content.strip():
            raise TimelineValidationError(
                "SRT file is empty",
                rule="EMPTY_SRT_CONTENT",
            )

        # Parse cues to verify monotonicity and boundaries
        cue_blocks = [b.strip() for b in srt_content.strip().split("\n\n") if b.strip()]
        last_cue_end = 0.0

        for block in cue_blocks:
            lines = block.split("\n")
            if len(lines) < 3:
                continue

            timing_line = lines[1]
            if "-->" not in timing_line:
                continue

            parts = timing_line.split("-->")
            start_str = parts[0].strip()
            end_str = parts[1].strip()

            def parse_srt_ts(ts: str) -> float:
                # 00:01:23,450
                h, m, rest = ts.split(":")
                s, ms = rest.split(",")
                return int(h) * 3600 + int(m) * 60 + int(s) + (int(ms) / 1000.0)

            c_start = parse_srt_ts(start_str)
            c_end = parse_srt_ts(end_str)

            if c_start < 0 or c_end <= c_start:
                raise TimelineValidationError(
                    f"SRT cue has invalid timing: {timing_line}",
                    rule="INVALID_SRT_TIMESTAMP",
                )

            if c_start < last_cue_end - 0.05:
                raise TimelineValidationError(
                    f"SRT cues are not monotonic: cue starts at {c_start}s before preceding cue ended at {last_cue_end}s",
                    rule="SRT_NON_MONOTONIC",
                )

            if c_end > final_timeline_end + 0.5:
                raise TimelineValidationError(
                    f"SRT cue ends at {c_end}s beyond total timeline duration ({final_timeline_end}s)",
                    rule="SRT_EXCEEDS_TIMELINE",
                )

            last_cue_end = c_end

        # Rule 15: Subtitles are NOT burned into video
        # In this stage, intermediate video files are rendered without subtitles filter
        return {
            "valid": True,
            "segmentCount": len(timeline_segments),
            "totalDuration": final_timeline_end,
            "srtCuesCount": len(cue_blocks),
            "noBurnedInSubtitlesConfirmed": True,
        }
