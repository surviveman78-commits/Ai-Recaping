from typing import List, Dict, Any, Optional
import math

from worker.core.timeline.models import TimelineSegment, TimelineOperation

class SourceMapper:
    """
    Translates authoritative measured TTS duration records into continuous TimelineSegments.
    
    CORE PRINCIPLE:
    The ACTUAL generated TTS duration is the source of truth for the final timeline.
    finalSegmentDuration = actualTtsDuration (NOT sourceDuration)
    
    CRITICAL BOUNDARY PROTECTION:
    When extending a segment, never blindly consume video belonging to the next recap segment.
    """

    def __init__(self, duration_tolerance: float = 0.08, total_source_duration: Optional[float] = None):
        self.duration_tolerance = duration_tolerance
        self.total_source_duration = total_source_duration

    def map_timeline_segments(
        self,
        raw_tts_records: List[Dict[str, Any]],
        total_source_duration: Optional[float] = None,
    ) -> List[TimelineSegment]:
        """
        Processes TTS chunk records into fully resolved, deterministic TimelineSegments.
        
        Accepts:
        - Flat list of TTS chunk records (with ttsChunkId, recapSegmentId, ttsDuration, sourceStart, sourceEnd, etc.)
        - Or list of recap segment records containing ttsChunks array
        """
        source_duration_limit = total_source_duration or self.total_source_duration or 100000.0

        # Step 1: Normalize into flattened list of individual TTS chunks with their recap associations
        flattened_chunks: List[Dict[str, Any]] = []

        for record in raw_tts_records:
            if "ttsChunks" in record and isinstance(record["ttsChunks"], list) and len(record["ttsChunks"]) > 0:
                # Grouped record from tts/segments.json
                recap_id = record.get("recapSegmentId") or record.get("id") or "seg_0001"
                recap_src_start = float(record.get("sourceStart", 0.0))
                recap_src_end = float(record.get("sourceEnd", recap_src_start + 5.0))
                recap_src_dur = float(record.get("sourceDuration", max(0.1, recap_src_end - recap_src_start)))
                recap_target_text = record.get("targetText") or record.get("scriptText") or ""
                recap_source_text = record.get("sourceText") or ""

                chunks_in_recap = record["ttsChunks"]
                num_chunks = len(chunks_in_recap)

                for c_idx, c_item in enumerate(chunks_in_recap):
                    # Subdivide source interval proportionally across chunks of this recap segment
                    chunk_slice_dur = recap_src_dur / float(num_chunks)
                    chunk_src_start = recap_src_start + (c_idx * chunk_slice_dur)
                    chunk_src_end = recap_src_start + ((c_idx + 1) * chunk_slice_dur)

                    c_dur = float(c_item.get("actualDuration") or c_item.get("ttsDuration") or 0.0)
                    c_id = c_item.get("ttsChunkId") or f"tts_{len(flattened_chunks)+1:04d}"
                    c_text = c_item.get("text") or recap_target_text
                    c_path = c_item.get("audioPath") or c_item.get("ttsAudioPath") or ""

                    flattened_chunks.append({
                        "ttsChunkId": c_id,
                        "recapSegmentId": str(recap_id),
                        "chunkIndex": c_idx,
                        "chunkCount": num_chunks,
                        "sourceStart": round(chunk_src_start, 3),
                        "sourceEnd": round(chunk_src_end, 3),
                        "sourceDuration": round(chunk_src_end - chunk_src_start, 3),
                        "recapSourceEnd": recap_src_end,
                        "ttsDuration": round(c_dur, 3),
                        "targetText": c_text,
                        "sourceText": recap_source_text,
                        "ttsAudioPath": c_path,
                    })
            else:
                # Already a flat TTS record (e.g. from chunks.json or flat segments.json)
                c_id = record.get("ttsChunkId") or record.get("chunkId") or f"tts_{len(flattened_chunks)+1:04d}"
                recap_id = record.get("recapSegmentId") or record.get("segmentId") or "seg_0001"
                src_start = float(record.get("sourceStart", 0.0))
                src_end = float(record.get("sourceEnd", src_start + 5.0))
                src_dur = float(record.get("sourceDuration", max(0.1, src_end - src_start)))
                tts_dur = float(record.get("ttsDuration") or record.get("actualDuration") or 0.0)
                text = record.get("targetText") or record.get("chunkText") or record.get("text") or ""
                path = record.get("ttsAudioPath") or record.get("audioPath") or ""
                chunk_idx = int(record.get("chunkIndex", 0))
                chunk_count = int(record.get("chunkCountForRecapSegment", record.get("chunkCount", 1)))

                flattened_chunks.append({
                    "ttsChunkId": c_id,
                    "recapSegmentId": str(recap_id),
                    "chunkIndex": chunk_idx,
                    "chunkCount": chunk_count,
                    "sourceStart": round(src_start, 3),
                    "sourceEnd": round(src_end, 3),
                    "sourceDuration": round(src_dur, 3),
                    "recapSourceEnd": src_end,
                    "ttsDuration": round(tts_dur, 3),
                    "targetText": text,
                    "sourceText": record.get("sourceText", ""),
                    "ttsAudioPath": path,
                })

        if not flattened_chunks:
            return []

        # Step 2: Establish the continuous timeline clock and source mapping for each chunk
        timeline_segments: List[TimelineSegment] = []
        current_final_time = 0.0
        total_chunks = len(flattened_chunks)

        for i, chunk in enumerate(flattened_chunks):
            src_start = chunk["sourceStart"]
            src_end = chunk["sourceEnd"]
            src_duration = chunk["sourceDuration"]
            tts_dur = chunk["ttsDuration"]

            # Safety fallback for zero or negative tts duration: minimum audible window
            if tts_dur <= 0.05:
                tts_dur = max(1.0, src_duration)

            # Determine next boundary to avoid stealing content from subsequent segments
            # If there is a next chunk, its sourceStart is the strict boundary!
            if i + 1 < total_chunks:
                next_chunk_src_start = flattened_chunks[i + 1]["sourceStart"]
                next_boundary = min(source_duration_limit, next_chunk_src_start)
            else:
                next_boundary = source_duration_limit

            # Determine Operation and Final Window
            operation: TimelineOperation

            duration_diff = tts_dur - src_duration

            if abs(duration_diff) <= self.duration_tolerance:
                # CASE A: sourceDuration ≈ ttsDuration
                operation = TimelineOperation.DIRECT
            elif tts_dur < src_duration:
                # CASE B: ttsDuration < sourceDuration
                # Trim source interval to match ttsDuration, keeping beginning
                operation = TimelineOperation.TRIM
            else:
                # CASE C: ttsDuration > sourceDuration
                # Needs extension: Priority: 1. extend_forward -> 2. loop -> 3. freeze_last_frame
                extra_needed = tts_dur - src_duration

                # Check available forward headroom before next boundary
                available_forward = max(0.0, next_boundary - src_end)

                if available_forward >= extra_needed:
                    # We have sufficient unallocated source video before next segment
                    operation = TimelineOperation.EXTEND_FORWARD
                else:
                    # Extending forward would steal video from the next recap segment!
                    # Fallback to controlled loop
                    if src_duration >= 0.2:
                        operation = TimelineOperation.LOOP
                    else:
                        operation = TimelineOperation.FREEZE_LAST_FRAME

            # Calculate continuous timeline timestamps
            # CORE RULE: finalSegmentDuration = actualTtsDuration
            final_start = round(current_final_time, 3)
            final_end = round(final_start + tts_dur, 3)
            final_duration = round(final_end - final_start, 3)

            seg = TimelineSegment(
                timeline_index=i,
                tts_chunk_id=chunk["ttsChunkId"],
                recap_segment_id=chunk["recapSegmentId"],
                source_start=round(src_start, 3),
                source_end=round(src_end, 3),
                source_duration=round(src_duration, 3),
                tts_duration=round(tts_dur, 3),
                final_start=final_start,
                final_end=final_end,
                final_duration=final_duration,
                operation=operation,
                video_path=f"timeline/segment_{i + 1:04d}.mp4",
                target_text=chunk["targetText"],
                chunk_index=chunk["chunkIndex"],
                chunk_count=chunk["chunkCount"],
                tts_audio_path=chunk["ttsAudioPath"],
                metadata={
                    "nextBoundary": round(next_boundary, 3),
                    "sourceText": chunk.get("sourceText", ""),
                }
            )

            timeline_segments.append(seg)
            # Advance continuous clock monotonically with ZERO gaps
            current_final_time = final_end

        return timeline_segments
