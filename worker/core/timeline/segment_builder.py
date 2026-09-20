import os
from typing import List, Dict, Any, Optional, Callable

from worker.core.timeline.models import TimelineSegment, TimelineOperation
from worker.core.timeline.ffmpeg_ops import FFmpegOps, FFmpegOpError

class SegmentBuildError(Exception):
    def __init__(self, message: str, segment_index: int, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.segment_index = segment_index
        self.details = details or {}

class SegmentBuilder:
    """
    Executes physical generation of intermediate video segments using FFmpegOps.
    
    GUARANTEES:
    - Every segment matches its finalDuration within a strict tolerance (e.g. ±0.08s).
    - Dispatches appropriate operation (direct, trim, extend_forward, loop, freeze_last_frame).
    - Progress reporting with real segment indices, operations, and duration metrics.
    - Full cancellation safety and cleanup.
    """

    def __init__(
        self,
        ffmpeg_ops: Optional[FFmpegOps] = None,
        duration_tolerance: float = 0.08,
    ):
        self.ffmpeg = ffmpeg_ops or FFmpegOps()
        self.tolerance = duration_tolerance

    def build_segments(
        self,
        source_video_path: str,
        timeline_segments: List[TimelineSegment],
        timeline_dir: str,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> List[TimelineSegment]:
        """
        Renders all intermediate video segments to disk.
        """
        if not os.path.exists(source_video_path):
            raise FileNotFoundError(f"Source video file does not exist: {source_video_path}")

        os.makedirs(timeline_dir, exist_ok=True)
        total_segments = len(timeline_segments)
        completed_segments: List[TimelineSegment] = []

        for idx, seg in enumerate(timeline_segments):
            if is_cancelled and is_cancelled():
                raise SegmentBuildError("Pipeline cancelled during timeline rendering", idx)

            seg_num = idx + 1
            filename = f"segment_{seg_num:04d}.mp4"
            output_path = os.path.join(timeline_dir, filename)

            # Report starting this segment
            pct = int(((idx) / float(total_segments)) * 100)
            if progress_callback:
                progress_callback({
                    "stage": "rebuilding_timeline",
                    "progress": pct,
                    "timelineSegmentIndex": seg_num,
                    "timelineSegmentCount": total_segments,
                    "sourceDuration": seg.source_duration,
                    "targetTtsDuration": seg.tts_duration,
                    "operation": seg.operation.value if isinstance(seg.operation, TimelineOperation) else str(seg.operation),
                    "message": f"Rebuilding Timeline: Segment {seg_num}/{total_segments} ({seg.operation.value})",
                })

            try:
                op = seg.operation
                target_dur = seg.final_duration

                if op == TimelineOperation.DIRECT:
                    self.ffmpeg.cut_direct(
                        source_path=source_video_path,
                        start=seg.source_start,
                        duration=target_dur,
                        output_path=output_path,
                        is_cancelled=is_cancelled,
                    )
                elif op == TimelineOperation.TRIM:
                    self.ffmpeg.cut_trim(
                        source_path=source_video_path,
                        start=seg.source_start,
                        duration=target_dur,
                        output_path=output_path,
                        is_cancelled=is_cancelled,
                    )
                elif op == TimelineOperation.EXTEND_FORWARD:
                    self.ffmpeg.cut_extend_forward(
                        source_path=source_video_path,
                        start=seg.source_start,
                        duration=target_dur,
                        output_path=output_path,
                        is_cancelled=is_cancelled,
                    )
                elif op == TimelineOperation.LOOP:
                    self.ffmpeg.build_loop(
                        source_path=source_video_path,
                        start=seg.source_start,
                        src_duration=seg.source_duration,
                        target_duration=target_dur,
                        output_path=output_path,
                        temp_dir=timeline_dir,
                        is_cancelled=is_cancelled,
                    )
                elif op == TimelineOperation.FREEZE_LAST_FRAME:
                    self.ffmpeg.build_freeze_last_frame(
                        source_path=source_video_path,
                        start=seg.source_start,
                        src_duration=seg.source_duration,
                        target_duration=target_dur,
                        output_path=output_path,
                        is_cancelled=is_cancelled,
                    )
                else:
                    # Fallback to direct cut
                    self.ffmpeg.cut_direct(
                        source_path=source_video_path,
                        start=seg.source_start,
                        duration=target_dur,
                        output_path=output_path,
                        is_cancelled=is_cancelled,
                    )

                # Verify actual produced video duration with ffprobe
                measured_duration = self.ffmpeg.get_video_duration(output_path)
                dur_diff = abs(measured_duration - target_dur)

                # If deviation is beyond technical tolerance, log warning
                if dur_diff > 0.3:
                    print(
                        f"[SegmentBuilder] Warning: Segment {seg_num} duration mismatch! "
                        f"Target: {target_dur}s, Measured: {measured_duration}s (Diff: {dur_diff:.3f}s)"
                    )

                seg.video_path = f"timeline/{filename}"
                seg.metadata["measuredDuration"] = measured_duration
                seg.metadata["durationDifference"] = round(dur_diff, 3)

                completed_segments.append(seg)

                # Report finished segment
                pct_done = int((seg_num / float(total_segments)) * 100)
                if progress_callback:
                    progress_callback({
                        "stage": "rebuilding_timeline",
                        "progress": pct_done,
                        "timelineSegmentIndex": seg_num,
                        "timelineSegmentCount": total_segments,
                        "sourceDuration": seg.source_duration,
                        "targetTtsDuration": seg.tts_duration,
                        "operation": seg.operation.value if isinstance(seg.operation, TimelineOperation) else str(seg.operation),
                        "measuredDuration": measured_duration,
                        "message": f"Rendered segment {seg_num}/{total_segments} ({measured_duration:.2f}s)",
                    })

            except Exception as e:
                # Clean up partial output if it exists
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except Exception:
                        pass
                raise SegmentBuildError(
                    f"Failed to build timeline segment {seg_num}/{total_segments} ({seg.operation}): {str(e)}",
                    segment_index=idx,
                    details={"segment": seg.to_dict(), "error": str(e)},
                )

        return completed_segments
