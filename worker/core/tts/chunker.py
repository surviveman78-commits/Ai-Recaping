import re
from typing import List, Dict, Any, Optional

from worker.core.tts.models import TTSChunk

class TTSChunker:
    """
    Sentence-aware long-form text chunker for VoxCPM2 and Edge-TTS.
    
    Adheres strictly to core rules:
    - Preferred chunk duration: 20-27 seconds
    - Soft max: ~27 seconds
    - Hard max: 30 seconds
    - Preserves sentence boundaries (. ! ? 。 ！？)
    - Clause-aware splitting for long sentences (conjunctions, semicolons, commas)
    - Avoids tiny orphan fragments (< 4s) when mergeable
    - Maintains exact mapping: recapSegmentId -> ttsChunkId
    """

    def __init__(
        self,
        preferred_min_seconds: float = 20.0,
        preferred_max_seconds: float = 27.0,
        hard_max_seconds: float = 30.0,
        words_per_second: float = 2.6,
        chars_per_second_cjk: float = 3.8,
    ):
        self.preferred_min = preferred_min_seconds
        self.preferred_max = preferred_max_seconds
        self.hard_max = hard_max_seconds
        self.wps = words_per_second
        self.cps_cjk = chars_per_second_cjk

    def estimate_text_duration(self, text: str, speed: float = 1.0) -> float:
        """
        Estimates speaking duration for planning purposes ONLY.
        (Authoritative final duration is measured directly from audio).
        """
        effective_speed = max(0.5, min(2.0, speed))
        clean_text = text.strip()
        if not clean_text:
            return 0.0

        # Check if predominantly CJK (Chinese, Japanese, Korean)
        cjk_chars = len(re.findall(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]', clean_text))
        total_chars = len(clean_text)

        if cjk_chars > total_chars * 0.3:
            est = float(total_chars) / (self.cps_cjk * effective_speed)
        else:
            words = len(clean_text.split())
            est = float(words) / (self.wps * effective_speed)

        # Baseline minimum duration for any audible utterance
        return max(1.2, round(est, 2))

    def split_into_sentences(self, text: str) -> List[str]:
        """Splits text into complete grammatical sentences."""
        # Replace newlines with spaces for clean parsing
        clean = re.sub(r'\s+', ' ', text).strip()
        if not clean:
            return []

        # Split on sentence boundaries, keeping punctuation
        # Handles English (. ! ?), ellipsis (...), and CJK (。 ！？)
        pattern = r'([^.!?。！？\n]+(?:[.!?。！？]+|$))'
        matches = [s.strip() for s in re.findall(pattern, clean) if s.strip()]
        return matches if matches else [clean]

    def split_long_sentence_into_clauses(self, sentence: str, speed: float = 1.0) -> List[str]:
        """
        Splits an unusually long sentence (> 28s) at natural clause boundaries:
        1. Semicolons, colons, em-dashes
        2. Strong coordinating and subordinating conjunctions with commas
        3. Simple commas
        """
        # First check if sentence actually needs splitting
        if self.estimate_text_duration(sentence, speed) <= self.hard_max:
            return [sentence]

        # Try splitting by semicolon, colon, em-dash
        major_parts = re.split(r'([;:—–]\s*)', sentence)
        if len(major_parts) > 1:
            reconstructed = []
            cur = ""
            for p in major_parts:
                cur += p
                if re.search(r'[;:—–]\s*$', cur):
                    reconstructed.append(cur.strip())
                    cur = ""
            if cur.strip():
                reconstructed.append(cur.strip())
            
            # If parts are good, return them
            all_under_hard = all(self.estimate_text_duration(p, speed) <= self.hard_max for p in reconstructed)
            if all_under_hard and len(reconstructed) > 1:
                return reconstructed

        # Try splitting by clause conjunctions with commas (e.g. ", but ", ", because ", ", and ")
        clause_pattern = r'(,\s*(?:and|but|because|while|although|however|meanwhile|since|where|so)\s+)'
        clause_parts = re.split(clause_pattern, sentence, flags=re.IGNORECASE)
        if len(clause_parts) > 1:
            clauses = []
            curr = clause_parts[0].strip()
            for i in range(1, len(clause_parts), 2):
                conjunction = clause_parts[i]
                next_part = clause_parts[i+1] if (i+1) < len(clause_parts) else ""
                combined = f"{curr} {conjunction}{next_part}".strip()
                if self.estimate_text_duration(combined, speed) <= self.preferred_max:
                    curr = combined
                else:
                    clauses.append(curr)
                    curr = f"{conjunction.strip()} {next_part}".strip()
            if curr:
                clauses.append(curr)
            if len(clauses) > 1:
                return clauses

        # Fallback: split on commas
        comma_parts = [p.strip() for p in re.split(r',\s*', sentence) if p.strip()]
        if len(comma_parts) > 1:
            clauses = []
            curr = ""
            for cp in comma_parts:
                candidate = f"{curr}, {cp}" if curr else cp
                if self.estimate_text_duration(candidate, speed) <= self.preferred_max:
                    curr = candidate
                else:
                    if curr:
                        clauses.append(curr + ",")
                    curr = cp
            if curr:
                clauses.append(curr)
            return clauses

        # If completely unyielding without punctuation, split near word threshold
        words = sentence.split()
        max_words = int(self.preferred_max * self.wps * speed)
        chunks = []
        for i in range(0, len(words), max_words):
            chunks.append(" ".join(words[i:i+max_words]))
        return chunks

    def chunk_recap_segment(
        self,
        recap_segment: Dict[str, Any],
        speed: float = 1.0,
        start_chunk_counter: int = 1
    ) -> List[TTSChunk]:
        """
        Takes a single recap segment and decomposes its narrative text
        into 1 or more sentence-aware TTS chunks adhering to 20-27s guidelines.
        """
        recap_id = str(recap_segment.get("id", "0"))
        source_start = float(recap_segment.get("sourceStart", 0.0))
        source_end = float(recap_segment.get("sourceEnd", 0.0))
        source_duration = float(recap_segment.get("sourceDuration", max(0.0, source_end - source_start)))
        source_text = recap_segment.get("sourceText", "")
        target_text = (recap_segment.get("targetText") or recap_segment.get("scriptText") or "").strip()

        if not target_text:
            return []

        # Step 1: Estimate full duration of this recap segment text
        total_est = self.estimate_text_duration(target_text, speed)

        # Case A: Entire segment is already within preferred range or hard max (<= 30s)
        # Even if slightly above 27s (e.g. 28.5s), keep intact per instructions!
        if total_est <= self.hard_max:
            chunk_id = f"tts_{start_chunk_counter:04d}"
            return [
                TTSChunk(
                    tts_chunk_id=chunk_id,
                    recap_segment_id=recap_id,
                    chunk_index=0,
                    chunk_count_for_recap_segment=1,
                    text=target_text,
                    estimated_duration=total_est,
                    source_start=source_start,
                    source_end=source_end,
                    source_duration=source_duration,
                    source_text=source_text,
                    target_text=target_text,
                )
            ]

        # Case B: Long text that must be broken down into multiple sentence-aware chunks
        raw_sentences = self.split_into_sentences(target_text)
        fine_sentences: List[str] = []
        for s in raw_sentences:
            if self.estimate_text_duration(s, speed) > self.hard_max:
                fine_sentences.extend(self.split_long_sentence_into_clauses(s, speed))
            else:
                fine_sentences.append(s)

        # Group sentences into chunks between preferred_min (20s) and preferred_max (27s)
        chunk_texts: List[str] = []
        current_chunk_parts: List[str] = []
        current_chunk_duration = 0.0

        for sentence in fine_sentences:
            sent_duration = self.estimate_text_duration(sentence, speed)
            combined_duration = current_chunk_duration + sent_duration

            # If current chunk has content and adding sentence pushes it past preferred max:
            if current_chunk_parts and combined_duration > self.preferred_max:
                # If current duration is at least acceptable (or soft threshold), yield chunk
                if current_chunk_duration >= self.preferred_min or combined_duration > self.hard_max:
                    chunk_texts.append(" ".join(current_chunk_parts))
                    current_chunk_parts = [sentence]
                    current_chunk_duration = sent_duration
                    continue

            # Otherwise accumulate
            current_chunk_parts.append(sentence)
            current_chunk_duration = combined_duration

        if current_chunk_parts:
            chunk_texts.append(" ".join(current_chunk_parts))

        # Check for tiny tail/orphan chunk (< 4s)
        if len(chunk_texts) > 1:
            last_text = chunk_texts[-1]
            last_duration = self.estimate_text_duration(last_text, speed)
            if last_duration < 4.5:
                prev_text = chunk_texts[-2]
                prev_duration = self.estimate_text_duration(prev_text, speed)
                # If combining stays under hard max (30s), merge it!
                if prev_duration + last_duration <= self.hard_max:
                    chunk_texts[-2] = f"{prev_text} {last_text}"
                    chunk_texts.pop()

        # Build TTSChunk objects
        total_chunks = len(chunk_texts)
        result_chunks: List[TTSChunk] = []

        for idx, c_text in enumerate(chunk_texts):
            chunk_id = f"tts_{start_chunk_counter + idx:04d}"
            est_dur = self.estimate_text_duration(c_text, speed)
            result_chunks.append(
                TTSChunk(
                    tts_chunk_id=chunk_id,
                    recap_segment_id=recap_id,
                    chunk_index=idx,
                    chunk_count_for_recap_segment=total_chunks,
                    text=c_text,
                    estimated_duration=est_dur,
                    source_start=source_start,
                    source_end=source_end,
                    source_duration=source_duration,
                    source_text=source_text,
                    target_text=target_text,
                )
            )

        return result_chunks

    def chunk_all_recap_segments(
        self,
        recap_segments: List[Dict[str, Any]],
        speed: float = 1.0
    ) -> List[TTSChunk]:
        """
        Transforms full array of recap segments into an ordered sequence of TTS chunks.
        """
        all_chunks: List[TTSChunk] = []
        counter = 1

        for seg in recap_segments:
            seg_chunks = self.chunk_recap_segment(seg, speed=speed, start_chunk_counter=counter)
            all_chunks.extend(seg_chunks)
            counter += len(seg_chunks)

        return all_chunks
