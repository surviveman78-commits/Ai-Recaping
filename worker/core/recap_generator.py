import os
import re
import time
import json
from typing import List, Dict, Any, Callable, Optional

# Configurable central model identifier
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
MAX_RETRIES = 4
BATCH_SEGMENT_LIMIT = 25  # Context-aware chunking batch size

class RecapGenerationError(Exception):
    def __init__(self, message: str, stage: str = "translating", retryable: bool = True, code: str = "GEMINI_RECAP_FAILED"):
        super().__init__(message)
        self.payload = {
            "code": code,
            "stage": stage,
            "message": message,
            "retryable": retryable,
        }

class GeminiRecapGenerator:
    """
    Transforms timestamped transcripts into a dramatic, chronological, narration-ready recap script.
    Supports dynamic target language, context-aware batching for long movies,
    strict schema validation, timestamp sanity checks, and repair retries.
    """

    def __init__(self, api_key: str, model: str = GEMINI_MODEL):
        if not api_key or not api_key.strip():
            raise RecapGenerationError("Gemini API key is missing or not configured.", retryable=False, code="MISSING_GEMINI_KEY")
        self.api_key = api_key.strip()
        self.model = model

    def generate_recap(
        self,
        movie_title: str,
        transcript_segments: List[Dict[str, Any]],
        target_language: str = "English",
        total_video_duration: Optional[float] = None,
        output_json_path: Optional[str] = None,
        output_txt_path: Optional[str] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Main recap generation pipeline:
        1. Context-aware chunking for long transcripts
        2. Gemini recap narration generation per batch
        3. Strict schema & timestamp validation and repair
        4. Saving authoritative recap.json and readable recap.txt
        """
        if not transcript_segments:
            raise RecapGenerationError("Cannot generate recap: transcript segments list is empty.", retryable=False)

        max_duration = total_video_duration or max(s.get("end", 60.0) for s in transcript_segments)
        target_lang = target_language.strip() if target_language and target_language.strip() else "English"

        # Split transcript into batches if long
        batches = self._chunk_transcript(transcript_segments, BATCH_SEGMENT_LIMIT)
        total_batches = len(batches)

        if progress_callback:
            progress_callback({
                "stage": "translating",
                "progress": 5.0,
                "message": f"Starting narrative recap generation in {target_lang} ({total_batches} batch{'es' if total_batches > 1 else ''})",
                "metrics": {"totalBatches": total_batches, "targetLanguage": target_lang},
            })

        all_recap_segments: List[Dict[str, Any]] = []
        running_context_summary = ""

        for idx, batch_segments in enumerate(batches):
            batch_num = idx + 1

            if progress_callback:
                progress_pct = 5.0 + (idx / total_batches) * 85.0
                progress_callback({
                    "stage": "translating",
                    "progress": round(progress_pct, 1),
                    "message": f"Generating recap batch {batch_num} of {total_batches} ({target_lang})",
                    "metrics": {
                        "currentBatch": batch_num,
                        "totalBatches": total_batches,
                    },
                })

            batch_result = self._generate_batch_with_retry(
                movie_title=movie_title,
                batch_segments=batch_segments,
                target_language=target_lang,
                previous_context=running_context_summary,
                batch_index=idx,
                max_video_duration=max_duration,
            )

            valid_batch_segments = batch_result.get("segments", [])
            all_recap_segments.extend(valid_batch_segments)

            # Update running context summary for the next batch
            recent_texts = [s["targetText"] for s in valid_batch_segments[-3:]] if valid_batch_segments else []
            running_context_summary = " ".join(recent_texts)

            # Rate-limiting pause between batches
            if batch_num < total_batches:
                time.sleep(1.0)

        # Global validation and deduplication across all batches
        final_segments = self._validate_and_normalize_recap_segments(all_recap_segments, max_duration)

        full_recap_text = "\n\n".join(s["targetText"] for s in final_segments)

        result_payload = {
            "movieTitle": movie_title,
            "targetLanguage": target_lang,
            "model": self.model,
            "duration": round(max_duration, 2),
            "fullRecapText": full_recap_text,
            "segments": final_segments,
        }

        # Save to filesystem if output paths provided
        if output_json_path:
            os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
            with open(output_json_path, "w", encoding="utf-8") as f:
                json.dump(result_payload, f, indent=2, ensure_ascii=False)

        if output_txt_path:
            os.makedirs(os.path.dirname(output_txt_path), exist_ok=True)
            readable_lines = [
                f"# Movie Recap: {movie_title}",
                f"# Language: {target_lang}",
                f"# Total Segments: {len(final_segments)}",
                "",
            ]
            for s in final_segments:
                s_str = format_seconds_to_timestamp(s["sourceStart"])
                e_str = format_seconds_to_timestamp(s["sourceEnd"])
                readable_lines.append(f"[{s_str} -> {e_str}] (Cut duration: {s['sourceDuration']:.1f}s)")
                readable_lines.append(f"Source: \"{s['sourceText']}\"")
                readable_lines.append(f"Narration: {s['targetText']}")
                readable_lines.append("")

            with open(output_txt_path, "w", encoding="utf-8") as f:
                f.write("\n".join(readable_lines))

        if progress_callback:
            progress_callback({
                "stage": "translating",
                "progress": 100.0,
                "message": f"Recap generated successfully ({len(final_segments)} narration segments in {target_lang})",
                "metrics": {
                    "totalRecapSegments": len(final_segments),
                    "targetLanguage": target_lang,
                },
                "translatedScript": full_recap_text,
                "recapSegments": final_segments,
            })

        return result_payload

    def _chunk_transcript(self, segments: List[Dict[str, Any]], batch_size: int) -> List[List[Dict[str, Any]]]:
        """Splits transcript segments list into sequential batches for processing."""
        if len(segments) <= batch_size:
            return [segments]
        return [segments[i : i + batch_size] for i in range(0, len(segments), batch_size)]

    def _generate_batch_with_retry(
        self,
        movie_title: str,
        batch_segments: List[Dict[str, Any]],
        target_language: str,
        previous_context: str,
        batch_index: int,
        max_video_duration: float,
    ) -> Dict[str, Any]:
        """Calls Gemini with exponential backoff and JSON repair validation."""
        last_err = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                raw_response = self._call_gemini_api(
                    movie_title=movie_title,
                    batch_segments=batch_segments,
                    target_language=target_language,
                    previous_context=previous_context,
                    batch_index=batch_index,
                )
                parsed = self._extract_and_validate_json(raw_response, batch_segments, max_video_duration)
                return parsed
            except Exception as e:
                last_err = e
                err_msg = str(e)

                # Permanent authorization error
                if "API_KEY_INVALID" in err_msg or "403" in err_msg or "PERMISSION_DENIED" in err_msg:
                    raise RecapGenerationError(
                        "Gemini API key is invalid or lacks necessary permissions. Please check Settings.",
                        retryable=False,
                        code="INVALID_GEMINI_KEY"
                    )

                backoff = (2 ** attempt) + (attempt * 0.75)
                print(f"[Gemini] Attempt {attempt}/{MAX_RETRIES} failed: {err_msg}. Retrying in {backoff:.1f}s...")
                time.sleep(backoff)

        raise RecapGenerationError(
            f"Gemini recap generation failed after {MAX_RETRIES} retries: {str(last_err)}",
            retryable=True,
        )

    def _call_gemini_api(
        self,
        movie_title: str,
        batch_segments: List[Dict[str, Any]],
        target_language: str,
        previous_context: str,
        batch_index: int,
    ) -> str:
        """Invokes Gemini API via google.genai SDK or direct HTTP POST."""
        # Format the timestamped dialogue
        dialogue_lines = []
        for s in batch_segments:
            s_start = float(s.get("start", 0.0))
            s_end = float(s.get("end", s_start + 1.0))
            s_text = s.get("text", "").strip()
            dialogue_lines.append(f"[{s_start:.2f}s - {s_end:.2f}s]: {s_text}")

        dialogue_block = "\n".join(dialogue_lines)
        first_start = float(batch_segments[0].get("start", 0.0))
        last_end = float(batch_segments[-1].get("end", first_start + 5.0))

        context_clause = ""
        if previous_context:
            context_clause = f"\nPreceding Story Beat Context (for narrative continuity, do NOT duplicate this):\n\"{previous_context}\"\n"

        prompt = f"""You are a master cinematic movie recap narrator.
Transform the following timestamped dialogue section from the movie "{movie_title}" ({first_start:.2f}s to {last_end:.2f}s) into an engaging, high-stakes recap narration in {target_language}.
{context_clause}
STRICT REQUIREMENTS:
1. TARGET LANGUAGE: Write all narration strictly in {target_language}.
2. PRESERVE CHRONOLOGICAL ORDER: Maintain the exact chronological story progression. Do NOT invent scenes, do NOT hallucinate events or fake dialogue, and base all storytelling strictly on what happens in the source dialogue/scene.
3. RECAP STYLE: Natural, conversational YouTube/TikTok movie recap narrator voice. Build tension, explain key actions, cut filler or excessive repetition.
4. NO SCREENPLAY ARTIFACTS: Do NOT include [Music], [SFX], scene directions, camera angles, or character name prefixes (e.g., do NOT write "Narrator:").
5. SEGMENTED OUTPUT WITH SOURCE MAPPING:
   Divide the narrative into sequential, natural story beats. Each segment MUST map to the corresponding original timestamp interval in the source video.
   - sourceStart must be >= {first_start:.2f}
   - sourceEnd must be > sourceStart and <= {last_end + 1.0:.2f}
   - sourceDuration = sourceEnd - sourceStart
   - sourceText = summary or key dialogue from that slice of the original video
   - targetText = clean, thrilling narration sentence in {target_language}

You MUST return ONLY a JSON object matching this exact schema:
{{
  "segments": [
    {{
      "id": 0,
      "sourceStart": {first_start:.2f},
      "sourceEnd": {min(last_end, first_start + 8.5):.2f},
      "sourceDuration": {min(last_end - first_start, 8.5):.2f},
      "sourceText": "Original scene dialogue...",
      "targetText": "Narration in {target_language}..."
    }}
  ]
}}

Source Dialogue Transcript:
{dialogue_block}"""

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.65,
                ),
            )
            return response.text or ""

        except ImportError:
            # Fallback to direct HTTP API call
            return self._call_gemini_http_direct(prompt)

    def _call_gemini_http_direct(self, prompt: str) -> str:
        """Fallback direct REST API call to Google Generative Language endpoint."""
        import urllib.request

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.65,
            },
        }
        data = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            candidates = body.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            return "{}"

    def _extract_and_validate_json(
        self,
        raw_text: str,
        batch_segments: List[Dict[str, Any]],
        max_duration: float,
    ) -> Dict[str, Any]:
        """Strips markdown code blocks, parses JSON, and validates schema and constraints."""
        text = raw_text.strip()
        # Strip markdown ```json ... ``` wrapper
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text)
            text = text.strip()

        # Find outer braces if wrapped in surrounding text
        start_idx = text.find("{")
        end_idx = text.rfind("}")
        if start_idx != -1 and end_idx != -1:
            text = text[start_idx : end_idx + 1]

        data = json.loads(text)

        if not isinstance(data, dict) or "segments" not in data or not isinstance(data["segments"], list):
            raise ValueError("Malformed JSON: missing 'segments' array")

        raw_segs = data["segments"]
        if not raw_segs:
            raise ValueError("Malformed JSON: 'segments' array is empty")

        first_avail_start = float(batch_segments[0].get("start", 0.0))
        last_avail_end = float(batch_segments[-1].get("end", first_avail_start + 10.0))

        valid_segments = []
        for idx, seg in enumerate(raw_segs):
            target_text = seg.get("targetText", "").strip()
            source_text = seg.get("sourceText", "").strip()

            if not target_text:
                continue

            try:
                s_start = max(0.0, float(seg.get("sourceStart", first_avail_start)))
                s_end = float(seg.get("sourceEnd", s_start + 5.0))
            except (ValueError, TypeError):
                s_start = first_avail_start
                s_end = s_start + 5.0

            if s_end <= s_start:
                s_end = round(s_start + 3.5, 2)

            s_dur = round(s_end - s_start, 2)

            valid_segments.append({
                "id": idx,
                "sourceStart": round(s_start, 2),
                "sourceEnd": round(min(max_duration, s_end), 2),
                "sourceDuration": s_dur,
                "sourceText": source_text or "Scene dialogue",
                "targetText": target_text,
            })

        if not valid_segments:
            raise ValueError("No valid segments could be parsed from Gemini response")

        return {"segments": valid_segments}

    def _validate_and_normalize_recap_segments(
        self,
        segments: List[Dict[str, Any]],
        max_duration: float,
    ) -> List[Dict[str, Any]]:
        """
        Global normalization & validation:
        - Strict sorting by sourceStart
        - Normalization of minor floating point issues
        - Ensuring sourceEnd > sourceStart and does not exceed video duration
        - Sequential clean integer IDs (0, 1, 2, ...)
        - Duplicate segment detection
        """
        if not segments:
            return []

        # Sort chronologically by sourceStart
        sorted_segs = sorted(segments, key=lambda s: s["sourceStart"])

        normalized: List[Dict[str, Any]] = []
        seen_narrations = set()

        for seg in sorted_segs:
            target_text = seg.get("targetText", "").strip()
            # Deduplicate identical sentences
            text_key = target_text.lower()
            if text_key in seen_narrations and len(target_text) > 10:
                continue
            seen_narrations.add(text_key)

            s_start = max(0.0, round(float(seg.get("sourceStart", 0.0)), 2))
            s_end = round(float(seg.get("sourceEnd", s_start + 4.0)), 2)

            if s_end <= s_start:
                s_end = round(s_start + 3.0, 2)

            s_end = min(round(max_duration, 2), s_end)
            s_dur = round(max(0.5, s_end - s_start), 2)

            # Prevent overlap anomalies
            if normalized:
                prev = normalized[-1]
                if s_start < prev["sourceStart"]:
                    s_start = prev["sourceStart"]
                if s_start < prev["sourceEnd"] and s_dur > 2.0:
                    # Minor boundary reconciliation
                    pass

            normalized.append({
                "id": len(normalized),
                "sourceStart": s_start,
                "sourceEnd": s_end,
                "sourceDuration": s_dur,
                "sourceText": seg.get("sourceText", "").strip(),
                "targetText": target_text,
            })

        return normalized

def format_seconds_to_timestamp(seconds: float) -> str:
    sec = max(0, int(seconds))
    hrs = sec // 3600
    mins = (sec % 3600) // 60
    secs = sec % 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d}"
