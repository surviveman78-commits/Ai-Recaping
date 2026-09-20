import os
import shutil
import json
from typing import Dict, Any, Optional

class JobWorkspace:
    """
    Manages an isolated workspace directory structure for a specific job:
    workspace/
      jobs/
        <job-id>/
          source/
          audio/
          transcript/
          tts/
          timeline/
          subtitles/
          output/
    Guarantees that jobs never accidentally overwrite another job's artifacts.
    """

    def __init__(self, job_id: str, base_dir: Optional[str] = None):
        if not job_id or not isinstance(job_id, str):
            raise ValueError("Valid non-empty job_id is required for JobWorkspace")
        # Sanitize job_id to prevent path traversal
        clean_job_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_")).strip()
        if not clean_job_id:
            clean_job_id = f"job-{hash(job_id) & 0xffffffff}"

        self.job_id = clean_job_id
        root_dir = base_dir or os.environ.get("RECAP_WORKSPACE_ROOT", "workspace")
        self.job_dir = os.path.abspath(os.path.join(root_dir, "jobs", self.job_id))

        # Core directories for this stage and future stages
        self.source_dir = os.path.join(self.job_dir, "source")
        self.audio_dir = os.path.join(self.job_dir, "audio")
        self.transcript_dir = os.path.join(self.job_dir, "transcript")
        self.tts_dir = os.path.join(self.job_dir, "tts")
        self.timeline_dir = os.path.join(self.job_dir, "timeline")
        self.subtitles_dir = os.path.join(self.job_dir, "subtitles")
        self.output_dir = os.path.join(self.job_dir, "output")

        self._ensure_directories()

    def _ensure_directories(self):
        """Creates the isolated directories for this job."""
        for path in [
            self.source_dir,
            self.audio_dir,
            self.transcript_dir,
            self.tts_dir,
            self.timeline_dir,
            self.subtitles_dir,
            self.output_dir,
        ]:
            os.makedirs(path, exist_ok=True)

    # File path accessors
    @property
    def source_video_path(self) -> str:
        return os.path.join(self.source_dir, "movie.mp4")

    @property
    def source_metadata_path(self) -> str:
        return os.path.join(self.source_dir, "metadata.json")

    @property
    def extracted_audio_path(self) -> str:
        return os.path.join(self.audio_dir, "source.wav")

    @property
    def audio_metadata_path(self) -> str:
        return os.path.join(self.audio_dir, "metadata.json")

    @property
    def original_transcript_json_path(self) -> str:
        return os.path.join(self.transcript_dir, "original.json")

    @property
    def original_transcript_txt_path(self) -> str:
        return os.path.join(self.transcript_dir, "original.txt")

    @property
    def recap_json_path(self) -> str:
        return os.path.join(self.transcript_dir, "recap.json")

    @property
    def recap_txt_path(self) -> str:
        return os.path.join(self.transcript_dir, "recap.txt")

    @property
    def tts_segments_json_path(self) -> str:
        return os.path.join(self.tts_dir, "segments.json")

    @property
    def tts_chunks_json_path(self) -> str:
        return os.path.join(self.tts_dir, "chunks.json")

    @property
    def tts_manifest_json_path(self) -> str:
        return os.path.join(self.tts_dir, "manifest.json")

    @property
    def timeline_json_path(self) -> str:
        return os.path.join(self.timeline_dir, "timeline.json")

    @property
    def timeline_manifest_path(self) -> str:
        return os.path.join(self.timeline_dir, "manifest.json")

    @property
    def subtitles_srt_path(self) -> str:
        return os.path.join(self.subtitles_dir, "recap.srt")

    @property
    def subtitles_manifest_path(self) -> str:
        return os.path.join(self.subtitles_dir, "manifest.json")

    @property
    def subtitles_ass_path(self) -> str:
        return os.path.join(self.subtitles_dir, "recap.ass")

    @property
    def tts_track_audio_path(self) -> str:
        return os.path.join(self.audio_dir, "tts_track.wav")

    @property
    def mixed_audio_path(self) -> str:
        return os.path.join(self.audio_dir, "mixed_audio.wav")

    @property
    def reconstructed_video_path(self) -> str:
        return os.path.join(self.timeline_dir, "reconstructed_video.mp4")

    @property
    def output_video_path(self) -> str:
        return os.path.join(self.output_dir, "final_recap.mp4")

    @property
    def output_manifest_path(self) -> str:
        return os.path.join(self.output_dir, "manifest.json")

    def save_json(self, file_path: str, data: Any):
        """Safely write JSON data with atomic formatting."""
        self._assert_path_inside_job(file_path)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def load_json(self, file_path: str) -> Optional[Any]:
        """Safely load JSON data if file exists."""
        self._assert_path_inside_job(file_path)
        if not os.path.exists(file_path):
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_text(self, file_path: str, text: str):
        """Safely write readable text file."""
        self._assert_path_inside_job(file_path)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text)

    def _assert_path_inside_job(self, target_path: str):
        """Prevents path traversal outside of this job's workspace."""
        abs_target = os.path.abspath(target_path)
        if not abs_target.startswith(self.job_dir):
            raise PermissionError(f"Security error: {target_path} is outside job workspace {self.job_dir}")

    def cleanup(self, keep_debug_artifacts: bool = True):
        """Optionally cleans up heavy binary files while retaining transcript & debug files."""
        if not keep_debug_artifacts and os.path.exists(self.job_dir):
            shutil.rmtree(self.job_dir, ignore_errors=True)
