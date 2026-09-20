import os
import json
import time
from typing import List, Dict, Any, Optional, Callable

from worker.core.timeline.models import TimelineSegment, TimelineOperation
from worker.core.timeline.source_mapper import SourceMapper
from worker.core.timeline.ffmpeg_ops import FFmpegOps
from worker.core.timeline.segment_builder import SegmentBuilder, SegmentBuildError
from worker.core.timeline.srt_generator import SRTGenerator
from worker.core.timeline.validator import TimelineValidator, TimelineValidationError

class TimelineEngineError(Exception):
    def __init__(self, message: str, code: str = "TIMELINE_ENGINE_ERROR", details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}

class TimelineEngine:
    """
    Master Timeline Reconstruction Engine (Stage 6).
    
    CORE PRINCIPLE:
    The ACTUAL generated TTS duration is the source of truth for the final timeline.
    Never force TTS audio to match the original source-video segment duration.
    finalSegmentDuration = actualTtsDuration
    
    OUTPUTS:
    - workspace/jobs/<job-id>/timeline/segment_0001.mp4, ...
    - workspace/jobs/<job-id>/timeline/timeline.json (authoritative)
    - workspace/jobs/<job-id>/timeline/manifest.json
    - workspace/jobs/<job-id>/subtitles/recap.srt (standalone, unburned)
    - workspace/jobs/<job-id>/subtitles/manifest.json
    """

    def __init__(
        self,
        duration_tolerance: float = 0.08,
        ffmpeg_ops: Optional[FFmpegOps] = None,
    ):
        self.duration_tolerance = duration_tolerance
        self.ffmpeg = ffmpeg_ops or FFmpegOps()
        self.source_mapper = SourceMapper(duration_tolerance=duration_tolerance)
        self.segment_builder = SegmentBuilder(ffmpeg_ops=self.ffmpeg, duration_tolerance=duration_tolerance)
        self.validator = TimelineValidator(duration_tolerance=duration_tolerance, ffmpeg_ops=self.ffmpeg)

    def load_tts_input(self, tts_dir: str) -> List[Dict[str, Any]]:
        """Loads authoritative tts/segments.json (or tts/chunks.json fallback)."""
        segments_path = os.path.join(tts_dir, "segments.json")
        chunks_path = os.path.join(tts_dir, "chunks.json")

        if os.path.exists(segments_path):
            with open(segments_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data

        if os.path.exists(chunks_path):
            with open(chunks_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data

        raise TimelineEngineError(
            f"No valid TTS records found in {tts_dir}. Expected tts/segments.json or tts/chunks.json",
            code="MISSING_TTS_INPUT",
        )

    def process_timeline(
        self,
        source_video_path: str,
        tts_dir: str,
        timeline_dir: str,
        subtitles_dir: str,
        target_language: str = "English",
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        is_cancelled: Optional[Callable[[], bool]] = None,
        render_video_files: bool = True,
    ) -> Dict[str, Any]:
        """
        Executes complete Stage 6 reconstruction.
        """
        start_time = time.time()
        print(f"[TimelineEngine] Beginning Stage 6 Timeline Reconstruction...")

        # 1. Load authoritative TTS records
        raw_tts_records = self.load_tts_input(tts_dir)

        # 2. Probe source video duration
        source_duration = 100000.0
        if os.path.exists(source_video_path):
            try:
                source_duration = self.ffmpeg.get_video_duration(source_video_path)
            except Exception as pe:
                print(f"[TimelineEngine] Warning: Failed to probe source video duration: {pe}")

        # 3. Source Mapping: establish continuous timeline clock and operations
        planned_segments = self.source_mapper.map_timeline_segments(
            raw_tts_records=raw_tts_records,
            total_source_duration=source_duration,
        )

        if not planned_segments:
            raise TimelineEngineError(
                "SourceMapper produced zero timeline segments from TTS input.",
                code="ZERO_TIMELINE_SEGMENTS",
            )

        total_segments = len(planned_segments)
        total_duration = planned_segments[-1].final_end
        print(f"[TimelineEngine] Mapped {total_segments} segments spanning {total_duration:.2f}s total duration.")

        # 4. Render Intermediate Video Segments (if render_video_files is True)
        rendered_segments: List[TimelineSegment]
        if render_video_files:
            rendered_segments = self.segment_builder.build_segments(
                source_video_path=source_video_path,
                timeline_segments=planned_segments,
                timeline_dir=timeline_dir,
                progress_callback=progress_callback,
                is_cancelled=is_cancelled,
            )
        else:
            rendered_segments = planned_segments

        # 5. Write authoritative timeline.json and manifest.json
        timeline_json_path = os.path.join(timeline_dir, "timeline.json")
        timeline_manifest_path = os.path.join(timeline_dir, "manifest.json")

        segments_dict_list = [s.to_dict() for s in rendered_segments]

        timeline_data = {
            "version": 1,
            "totalDuration": round(total_duration, 3),
            "segmentCount": total_segments,
            "segments": segments_dict_list,
            "sourceVideo": os.path.basename(source_video_path),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        os.makedirs(timeline_dir, exist_ok=True)
        with open(timeline_json_path, "w", encoding="utf-8") as f:
            json.dump(timeline_data, f, indent=2, ensure_ascii=False)

        manifest_data = {
            "version": 1,
            "totalDuration": round(total_duration, 3),
            "segmentCount": total_segments,
            "status": "completed",
            "artifacts": {
                "timelineJson": timeline_json_path,
                "intermediateVideos": [s.video_path for s in rendered_segments],
            }
        }
        with open(timeline_manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, indent=2, ensure_ascii=False)

        # 6. Generate External SRT Subtitles (unburned, standalone)
        srt_generator = SRTGenerator(target_language=target_language)
        srt_output_path = os.path.join(subtitles_dir, "recap.srt")
        srt_manifest_path = os.path.join(subtitles_dir, "manifest.json")

        srt_result = srt_generator.generate_srt_file(
            timeline_segments=rendered_segments,
            output_srt_path=srt_output_path,
            output_manifest_path=srt_manifest_path,
        )

        print(f"[TimelineEngine] Generated {srt_result['cueCount']} subtitle cues in {srt_output_path}")

        # 7. Comprehensive Timeline Validation
        validation_report = self.validator.validate(
            timeline_segments=rendered_segments,
            expected_tts_chunks_count=total_segments,
            timeline_dir=timeline_dir,
            srt_file_path=srt_output_path,
            srt_manifest_path=srt_manifest_path,
            check_video_files=render_video_files,
        )

        elapsed = time.time() - start_time
        print(f"[TimelineEngine] Stage 6 Timeline Reconstruction Completed Successfully in {elapsed:.2f}s!")

        return {
            "status": "timeline_reconstructed",
            "totalDuration": round(total_duration, 3),
            "segmentCount": total_segments,
            "segments": segments_dict_list,
            "timelineJsonPath": timeline_json_path,
            "timelineManifestPath": timeline_manifest_path,
            "srtPath": srt_output_path,
            "srtManifestPath": srt_manifest_path,
            "srtCueCount": srt_result["cueCount"],
            "validation": validation_report,
            "elapsedSeconds": round(elapsed, 2),
        }
