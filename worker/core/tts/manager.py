import os
import json
import time
from typing import Dict, Any, List, Optional, Callable

from worker.core.tts.models import (
    TTSChunk,
    TTSGenerationRequest,
    TTSError,
)
from worker.core.tts.chunker import TTSChunker
from worker.core.tts.edge_tts_provider import EdgeTTSProvider
from worker.core.tts.voxcpm2_provider import VoxCPM2Provider
from worker.core.tts.duration import measure_audio_duration

class TTSManager:
    """
    Coordinates end-to-end TTS generation:
    1. Chunks long recap narratives into 20-27s sentence-aware TTS chunks
    2. Selects appropriate provider (VoxCPM2 vs Edge TTS)
    3. Executes sequential chunk synthesis with memory recycling
    4. Measures ACTUAL audio duration from generated WAV bitstreams
    5. Emits real-time progress callbacks
    6. Produces authoritative tts/segments.json, tts/chunks.json, and tts/manifest.json
    """

    def __init__(self, tts_dir: str):
        self.tts_dir = os.path.abspath(tts_dir)
        os.makedirs(self.tts_dir, exist_ok=True)

        self.edge_provider = EdgeTTSProvider()
        # Allow CPU fallback in test environments or if explicitly flagged
        self.voxcpm_provider = VoxCPM2Provider(allow_cpu=True)
        self.chunker = TTSChunker()

    def get_provider(self, engine_name: str):
        eng = (engine_name or "").strip().lower()
        if "vox" in eng:
            return self.voxcpm_provider
        return self.edge_provider

    def process_recap_segments(
        self,
        recap_segments: List[Dict[str, Any]],
        tts_engine: str = "edge-tts",
        voice_profile: Optional[Dict[str, Any]] = None,
        edge_voice: Optional[str] = None,
        target_language: Optional[str] = "English",
        speed: float = 1.0,
        generation_settings: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for Stage 5: Generating TTS.
        """
        if not recap_segments:
            raise TTSError("No recap segments provided for TTS generation", code="NO_RECAP_SEGMENTS", retryable=False)

        provider = self.get_provider(tts_engine)
        actual_engine_name = provider.provider_name

        # Step 1: Long-form sentence-aware chunking (20-27s preferred, 30s hard max)
        chunks: List[TTSChunk] = self.chunker.chunk_all_recap_segments(recap_segments, speed=speed)
        total_chunks = len(chunks)

        if total_chunks == 0:
            raise TTSError("Chunker produced 0 TTS chunks from recap segments", code="CHUNKER_EMPTY", retryable=False)

        voice_display_name = ""
        if actual_engine_name == "voxcpm2":
            voice_display_name = (voice_profile.get("name") if voice_profile else "Custom Voice") or "VoxCPM2 Voice"
        else:
            voice_display_name = edge_voice or self.edge_provider.resolve_voice_for_language(target_language, edge_voice)

        print(f"[TTSManager] Prepared {total_chunks} TTS chunks using engine '{actual_engine_name}' ({voice_display_name})")

        # Step 2: Sequential generation with retry and duration measurement
        generated_chunks: List[TTSChunk] = []

        for idx, chunk in enumerate(chunks):
            chunk_num = idx + 1
            chunk_filename = f"chunk_{chunk_num:04d}.wav"
            chunk_output_path = os.path.join(self.tts_dir, chunk_filename)
            chunk.tts_audio_path = chunk_output_path
            chunk.tts_engine = actual_engine_name
            chunk.voice_profile_id = voice_profile.get("id") if voice_profile else None

            # Report pre-synthesis progress
            pct_before = int(((idx) / float(total_chunks)) * 100)
            if progress_callback:
                progress_callback({
                    "progress": pct_before,
                    "message": f"Synthesizing voice chunk {chunk_num}/{total_chunks} with {actual_engine_name.upper()}...",
                    "metrics": {
                        "ttsEngine": actual_engine_name,
                        "voiceName": voice_display_name,
                        "currentChunk": chunk_num,
                        "totalChunks": total_chunks,
                        "chunkTextPreview": chunk.text[:60] + "..." if len(chunk.text) > 60 else chunk.text,
                        "estimatedDuration": chunk.estimated_duration,
                    }
                })

            # Retry loop per chunk (up to 3 attempts)
            max_retries = 3
            chunk_success = False
            last_chunk_err = None

            for attempt in range(1, max_retries + 1):
                try:
                    req = TTSGenerationRequest(
                        text=chunk.text,
                        output_path=chunk_output_path,
                        tts_engine=actual_engine_name,
                        voice_profile=voice_profile,
                        edge_voice=edge_voice,
                        language=target_language,
                        speed=speed,
                        generation_settings=generation_settings,
                    )

                    result = provider.generate(req)

                    # Store authoritative measured duration!
                    chunk.tts_duration = result.actual_duration
                    chunk.status = "generated"
                    chunk.metadata = result.metadata
                    chunk_success = True
                    break

                except Exception as ex:
                    last_chunk_err = ex
                    print(f"[TTSManager] Chunk {chunk_num} attempt {attempt} failed: {ex}")
                    time.sleep(1.0 * attempt)

            if not chunk_success:
                chunk.status = "failed"
                raise TTSError(
                    f"Failed to synthesize TTS chunk {chunk_num}/{total_chunks}: {str(last_chunk_err)}",
                    code="TTS_CHUNK_FAILED",
                    retryable=True,
                    details={"chunkIndex": idx, "chunkId": chunk.tts_chunk_id, "text": chunk.text}
                )

            generated_chunks.append(chunk)

            # Report post-chunk progress with real measured duration
            pct_after = int((chunk_num / float(total_chunks)) * 100)
            if progress_callback:
                progress_callback({
                    "progress": pct_after,
                    "message": f"Voice chunk {chunk_num}/{total_chunks} ready ({chunk.tts_duration:.2f}s)",
                    "metrics": {
                        "ttsEngine": actual_engine_name,
                        "voiceName": voice_display_name,
                        "currentChunk": chunk_num,
                        "totalChunks": total_chunks,
                        "lastChunkDuration": chunk.tts_duration,
                    }
                })

        # Step 3: Organize into authoritative tts/segments.json structure
        # Group chunks by recapSegmentId
        segments_map: Dict[str, List[TTSChunk]] = {}
        for c in generated_chunks:
            segments_map.setdefault(c.recap_segment_id, []).append(c)

        authoritative_segments: List[Dict[str, Any]] = []
        total_recapped_duration = 0.0

        for r_seg in recap_segments:
            r_id = str(r_seg.get("id", "0"))
            seg_chunks = segments_map.get(r_id, [])

            chunk_items = []
            seg_total_tts_dur = 0.0

            for sc in seg_chunks:
                dur = sc.tts_duration or 0.0
                seg_total_tts_dur += dur
                chunk_items.append({
                    "ttsChunkId": sc.tts_chunk_id,
                    "audioPath": sc.tts_audio_path,
                    "actualDuration": round(dur, 3),
                    "text": sc.text,
                    "chunkIndex": sc.chunk_index,
                })

            total_recapped_duration += seg_total_tts_dur

            source_start = float(r_seg.get("sourceStart", 0.0))
            source_end = float(r_seg.get("sourceEnd", 0.0))
            source_dur = float(r_seg.get("sourceDuration", max(0.0, source_end - source_start)))

            authoritative_segments.append({
                "recapSegmentId": f"seg_{int(r_id):04d}" if r_id.isdigit() else r_id,
                "sourceStart": round(source_start, 3),
                "sourceEnd": round(source_end, 3),
                "sourceDuration": round(source_dur, 3),
                "sourceText": r_seg.get("sourceText", ""),
                "targetText": r_seg.get("targetText") or r_seg.get("scriptText", ""),
                "ttsChunks": chunk_items,
                "totalTtsDuration": round(seg_total_tts_dur, 3),
            })

        # Step 4: Write artifacts to disk
        segments_json_path = os.path.join(self.tts_dir, "segments.json")
        chunks_json_path = os.path.join(self.tts_dir, "chunks.json")
        manifest_json_path = os.path.join(self.tts_dir, "manifest.json")

        with open(segments_json_path, "w", encoding="utf-8") as f:
            json.dump(authoritative_segments, f, indent=2, ensure_ascii=False)

        chunks_data = [c.to_dict() for c in generated_chunks]
        with open(chunks_json_path, "w", encoding="utf-8") as f:
            json.dump(chunks_data, f, indent=2, ensure_ascii=False)

        manifest_data = {
            "ttsEngine": actual_engine_name,
            "voice": voice_display_name,
            "targetLanguage": target_language,
            "speed": speed,
            "totalChunks": total_chunks,
            "totalTtsDuration": round(total_recapped_duration, 3),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "artifacts": {
                "segmentsJson": segments_json_path,
                "chunksJson": chunks_json_path,
            }
        }
        with open(manifest_json_path, "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, indent=2, ensure_ascii=False)

        print(f"[TTSManager] Successfully saved authoritative TTS metadata to {segments_json_path}")

        return {
            "segments": authoritative_segments,
            "chunks": chunks_data,
            "manifest": manifest_data,
            "totalTtsDuration": round(total_recapped_duration, 3),
            "segmentsJsonPath": segments_json_path,
            "chunksJsonPath": chunks_json_path,
            "manifestJsonPath": manifest_json_path,
        }
