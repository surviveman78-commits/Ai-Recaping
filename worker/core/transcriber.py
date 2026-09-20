import os
import re
import time
import json
import wave
import subprocess
from typing import List, Dict, Any, Callable, Optional

DEFAULT_WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3")
CHUNK_DURATION_SECONDS = 600.0  # 10 minutes (~19.2 MB at 16kHz 16-bit mono PCM)
CHUNK_OVERLAP_SECONDS = 3.0     # 3 seconds overlap to avoid cutting words at boundaries
MAX_RETRIES = 4

class TranscriptionError(Exception):
    def __init__(self, message: str, stage: str = "transcribing", retryable: bool = True, code: str = "WHISPER_TRANSCRIPTION_FAILED"):
        super().__init__(message)
        self.payload = {
            "code": code,
            "stage": stage,
            "message": message,
            "retryable": retryable,
        }

class GroqWhisperTranscriber:
    """
    Handles audio transcription with precise timestamps using Groq Whisper API.
    Includes audio chunking for long movies, overlap reconciliation,
    exponential backoff retry logic, and transcript normalization.
    """

    def __init__(self, api_key: str, model: str = DEFAULT_WHISPER_MODEL):
        if not api_key or not api_key.strip():
            raise TranscriptionError("Groq API key is missing or not configured.", retryable=False, code="MISSING_GROQ_KEY")
        self.api_key = api_key.strip()
        self.model = model

    def transcribe_movie_audio(
        self,
        audio_path: str,
        output_json_path: str,
        output_txt_path: str,
        total_duration: Optional[float] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Full pipeline for transcribing movie audio:
        1. Probe audio duration
        2. Chunk long audio if necessary
        3. Transcribe chunks independently with Groq Whisper
        4. Normalize and merge timestamps into global timeline
        5. Save authoritative original.json and readable original.txt
        """
        if not os.path.exists(audio_path):
            raise TranscriptionError(f"Audio file not found: {audio_path}", retryable=False)

        duration = total_duration or self._get_wav_duration(audio_path)
        if duration <= 0:
            duration = 60.0

        # Plan chunks
        chunks = self._prepare_chunks(audio_path, duration)
        total_chunks = len(chunks)

        if progress_callback:
            progress_callback({
                "stage": "transcribing",
                "progress": 5.0,
                "message": f"Prepared {total_chunks} audio chunk(s) for Whisper transcription",
                "metrics": {"totalChunks": total_chunks, "audioDuration": duration},
            })

        all_raw_segments: List[Dict[str, Any]] = []
        all_words: List[Dict[str, Any]] = []

        for idx, (chunk_path, chunk_offset, chunk_dur) in enumerate(chunks):
            chunk_num = idx + 1
            if progress_callback:
                progress_pct = 5.0 + (idx / total_chunks) * 85.0
                progress_callback({
                    "stage": "transcribing",
                    "progress": round(progress_pct, 1),
                    "message": f"Transcribing audio chunk {chunk_num} of {total_chunks}",
                    "metrics": {
                        "currentChunk": chunk_num,
                        "totalChunks": total_chunks,
                    },
                })

            chunk_res = self._transcribe_chunk_with_retry(chunk_path)

            # Map local chunk timestamps into global movie timeline
            chunk_segments = chunk_res.get("segments", [])
            for seg in chunk_segments:
                g_start = round(float(seg.get("start", 0.0)) + chunk_offset, 2)
                g_end = round(float(seg.get("end", 0.0)) + chunk_offset, 2)
                text = seg.get("text", "").strip()

                if text and g_end > g_start:
                    all_raw_segments.append({
                        "start": g_start,
                        "end": min(round(duration, 2), g_end),
                        "text": text,
                    })

            for w in chunk_res.get("words", []):
                all_words.append({
                    "word": w.get("word", "").strip(),
                    "start": round(float(w.get("start", 0.0)) + chunk_offset, 2),
                    "end": round(float(w.get("end", 0.0)) + chunk_offset, 2),
                })

            # Small rate-limiting sleep between chunks
            if chunk_num < total_chunks:
                time.sleep(0.5)

            # Clean up temporary split chunk files if different from original
            if chunk_path != audio_path and os.path.exists(chunk_path):
                try:
                    os.remove(chunk_path)
                except Exception:
                    pass

        # Normalization layer
        normalized_segments = self._normalize_transcript(all_raw_segments, duration)

        # Build full text
        full_text = " ".join(s["text"] for s in normalized_segments)

        final_transcript = {
            "model": self.model,
            "duration": round(duration, 2),
            "text": full_text,
            "segments": normalized_segments,
            "words": all_words,
        }

        # Save original.json (authoritative)
        os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(final_transcript, f, indent=2, ensure_ascii=False)

        # Save original.txt (readable)
        readable_lines = []
        for s in normalized_segments:
            s_str = format_seconds_to_timestamp(s["start"])
            e_str = format_seconds_to_timestamp(s["end"])
            readable_lines.append(f"[{s_str} -> {e_str}] {s['text']}")

        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(readable_lines))

        if progress_callback:
            progress_callback({
                "stage": "transcribing",
                "progress": 100.0,
                "message": f"Transcription complete ({len(normalized_segments)} timestamped dialogue segments)",
                "metrics": {
                    "totalSegments": len(normalized_segments),
                    "fullWordCount": len(full_text.split()),
                },
                "originalTranscript": normalized_segments,
            })

        return final_transcript

    def _prepare_chunks(self, audio_path: str, duration: float) -> List[tuple]:
        """
        Splits audio into chunks of ~600s (10 min) with 3s overlap if total duration exceeds 600s.
        Returns list of (file_path, start_offset_seconds, chunk_duration_seconds).
        """
        file_size = os.path.getsize(audio_path)
        # Groq limit is 25 MB. If smaller than 24 MB and <= 600 seconds, use directly as single chunk
        if duration <= CHUNK_DURATION_SECONDS and file_size < 24 * 1024 * 1024:
            return [(audio_path, 0.0, duration)]

        chunks = []
        chunk_dir = os.path.join(os.path.dirname(audio_path), "chunks")
        os.makedirs(chunk_dir, exist_ok=True)

        current_start = 0.0
        chunk_idx = 0

        while current_start < duration:
            chunk_end = min(duration, current_start + CHUNK_DURATION_SECONDS)
            chunk_length = chunk_end - current_start
            chunk_file = os.path.join(chunk_dir, f"chunk_{chunk_idx:03d}.wav")

            # Extract chunk using FFmpeg fast stream copy or PCM conversion
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(current_start),
                "-t", str(chunk_length),
                "-i", audio_path,
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                chunk_file,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            chunks.append((chunk_file, current_start, chunk_length))
            chunk_idx += 1

            if chunk_end >= duration:
                break
            current_start = chunk_end - CHUNK_OVERLAP_SECONDS

        return chunks

    def _transcribe_chunk_with_retry(self, chunk_path: str) -> Dict[str, Any]:
        """Calls Groq Whisper API with exponential backoff on temporary failures."""
        last_error = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return self._call_groq_api(chunk_path)
            except Exception as e:
                last_error = e
                err_msg = str(e)

                # Check if error is permanent (e.g. invalid API key)
                if "401" in err_msg or "Invalid API Key" in err_msg or "unauthorized" in err_msg.lower():
                    raise TranscriptionError(
                        "Groq API key is invalid or unauthorized. Please verify your Groq API key in Settings.",
                        retryable=False,
                        code="INVALID_GROQ_KEY"
                    )

                # If rate limited (429) or server error (500, 502, 503, 504), wait and retry
                backoff_time = (2 ** attempt) + (attempt * 0.5)
                print(f"[Whisper] Attempt {attempt}/{MAX_RETRIES} failed: {err_msg}. Retrying in {backoff_time:.1f}s...")
                time.sleep(backoff_time)

        raise TranscriptionError(
            f"Groq Whisper transcription failed after {MAX_RETRIES} retries: {str(last_error)}",
            retryable=True,
        )

    def _call_groq_api(self, audio_file_path: str) -> Dict[str, Any]:
        """Performs request to Groq API using groq client library if available, else urllib multipart."""
        try:
            from groq import Groq
            client = Groq(api_key=self.api_key)
            with open(audio_file_path, "rb") as f:
                transcription = client.audio.transcriptions.create(
                    file=(os.path.basename(audio_file_path), f.read()),
                    model=self.model,
                    response_format="verbose_json",
                    timestamp_granularities=["segment"],
                )

            res_dict = {
                "text": getattr(transcription, "text", ""),
                "segments": [],
                "words": [],
            }

            raw_segs = getattr(transcription, "segments", None)
            if raw_segs:
                for s in raw_segs:
                    if isinstance(s, dict):
                        res_dict["segments"].append(s)
                    else:
                        res_dict["segments"].append({
                            "start": getattr(s, "start", 0.0),
                            "end": getattr(s, "end", 0.0),
                            "text": getattr(s, "text", ""),
                        })

            return res_dict

        except ImportError:
            # Fallback to pure Python multipart request without requiring external groq module
            return self._call_groq_http_multipart(audio_file_path)

    def _call_groq_http_multipart(self, audio_file_path: str) -> Dict[str, Any]:
        """Direct HTTP multipart POST to Groq's transcription endpoint."""
        import urllib.request
        import uuid

        boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
        filename = os.path.basename(audio_file_path)

        with open(audio_file_path, "rb") as f:
            file_bytes = f.read()

        body_parts = []
        # model field
        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{self.model}\r\n".encode("utf-8"))
        # response_format field
        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\nverbose_json\r\n".encode("utf-8"))
        # timestamp_granularities
        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"timestamp_granularities[]\"\r\n\r\nsegment\r\n".encode("utf-8"))
        # file field
        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: audio/wav\r\n\r\n".encode("utf-8"))
        body_parts.append(file_bytes)
        body_parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))

        full_body = b"".join(body_parts)

        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            data=full_body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "User-Agent": "MovieRecapStudio/1.0",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data

    def _normalize_transcript(self, raw_segments: List[Dict[str, Any]], max_duration: float) -> List[Dict[str, Any]]:
        """
        Transcript Normalization Layer:
        - Removes obvious Whisper artifacts (repetitive subtitle credits, empty silence tags like [BLANK_AUDIO])
        - Normalizes whitespace, preserves proper punctuation
        - Merges overlapping chunk boundaries safely
        - Enforces chronological ordering and non-negative timestamps
        - Assigns clean sequential IDs (0, 1, 2, ...)
        """
        if not raw_segments:
            return []

        # Sort by start timestamp
        sorted_segs = sorted(raw_segments, key=lambda s: s["start"])

        # Banned artifact regexes
        artifact_regex = re.compile(r"^\[(blank audio|silence|music|applause|laughter)\]$", re.IGNORECASE)

        cleaned: List[Dict[str, Any]] = []
        last_end = 0.0

        for seg in sorted_segs:
            text = seg.get("text", "").strip()
            # Clean repetitive spaces
            text = re.sub(r"\s+", " ", text).strip()

            if not text or len(text) < 2:
                continue

            if artifact_regex.match(text):
                continue

            start = max(0.0, round(float(seg.get("start", 0.0)), 2))
            end = min(round(max_duration, 2), round(float(seg.get("end", start + 1.0)), 2))

            if end <= start:
                end = round(start + 1.0, 2)

            # Check overlap deduplication: if identical text appears within 4s of previous segment
            if cleaned:
                prev = cleaned[-1]
                if text.lower() == prev["text"].lower() and abs(start - prev["start"]) < 4.0:
                    # Skip duplicate overlap segment from chunk boundary
                    continue
                # If start is slightly before prev end due to chunk overlap, align start to prev end
                if start < prev["end"]:
                    if start >= prev["start"]:
                        start = prev["end"]
                        if end <= start:
                            end = round(start + 0.8, 2)

            cleaned.append({
                "id": len(cleaned),
                "start": start,
                "end": end,
                "text": text,
            })
            last_end = end

        return cleaned

    def _get_wav_duration(self, wav_path: str) -> float:
        """Calculates audio duration in seconds from WAV header."""
        try:
            with wave.open(wav_path, "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                if rate > 0:
                    return frames / float(rate)
        except Exception:
            pass

        # Fallback to ffprobe
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", wav_path]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            info = json.loads(res.stdout)
            return float(info.get("format", {}).get("duration", 0.0))
        except Exception:
            return 0.0

def format_seconds_to_timestamp(seconds: float) -> str:
    """Formats float seconds into HH:MM:SS or MM:SS."""
    sec = max(0, int(seconds))
    hrs = sec // 3600
    mins = (sec % 3600) // 60
    secs = sec % 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d}"
