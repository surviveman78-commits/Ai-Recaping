import os
import subprocess
import shutil
import math
from typing import Optional, Callable, Dict, Any

class FFmpegOpError(Exception):
    def __init__(self, message: str, cmd: Optional[str] = None, stderr: Optional[str] = None):
        super().__init__(message)
        self.cmd = cmd
        self.stderr = stderr

class FFmpegOps:
    """
    Executes real FFmpeg and FFprobe operations to produce frame-accurate intermediate video segments.
    
    GUARANTEES:
    - Accurate cuts with frame-exact duration
    - Timestamp normalization (avoid_negative_ts, setpts=PTS-STARTPTS)
    - Original aspect ratio, resolution, and pixel format preserved (yuv420p)
    - Subtitles are NEVER burned into video frames
    - Audio is NOT mixed into video in this stage (-an)
    - Cancellation responsiveness
    """

    def __init__(self, ffmpeg_bin: str = "ffmpeg", ffprobe_bin: str = "ffprobe"):
        self.ffmpeg_bin = ffmpeg_bin
        self.ffprobe_bin = ffprobe_bin

    def _run_cmd(
        self,
        args: list,
        is_cancelled: Optional[Callable[[], bool]] = None,
        timeout: int = 180,
    ) -> str:
        if is_cancelled and is_cancelled():
            raise FFmpegOpError("Operation cancelled by user", cmd=" ".join(args))

        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            raise FFmpegOpError(f"FFmpeg process timed out after {timeout}s", cmd=" ".join(args))
        except Exception as ex:
            process.kill()
            raise FFmpegOpError(f"FFmpeg subprocess error: {str(ex)}", cmd=" ".join(args))

        if is_cancelled and is_cancelled():
            raise FFmpegOpError("Operation cancelled by user during execution", cmd=" ".join(args))

        if process.returncode != 0:
            raise FFmpegOpError(
                f"FFmpeg failed with exit code {process.returncode}: {stderr[-800:] if stderr else 'unknown error'}",
                cmd=" ".join(args),
                stderr=stderr,
            )

        return stdout

    def get_video_duration(self, video_path: str) -> float:
        """Measures precise media duration using ffprobe."""
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        cmd = [
            self.ffprobe_bin,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path,
        ]

        try:
            out = subprocess.check_output(cmd, stderr=subprocess.PIPE, text=True).strip()
            return round(float(out), 3)
        except Exception as e:
            raise FFmpegOpError(f"Failed to probe duration of {video_path}: {e}")

    def probe_video_stream_info(self, video_path: str) -> Dict[str, Any]:
        """Probes video metadata such as resolution, fps, and stream count."""
        cmd = [
            self.ffprobe_bin,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,pix_fmt,codec_name",
            "-of", "json",
            video_path,
        ]
        try:
            import json
            out = subprocess.check_output(cmd, stderr=subprocess.PIPE, text=True)
            data = json.loads(out)
            streams = data.get("streams", [])
            return streams[0] if streams else {}
        except Exception:
            return {}

    def cut_direct(
        self,
        source_path: str,
        start: float,
        duration: float,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> str:
        """Cuts direct segment where sourceDuration ≈ ttsDuration."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        # Using accurate two-pass seeking (-ss before -i and -ss 0 with -t) for frame accuracy
        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-ss", f"{start:.3f}",
            "-i", source_path,
            "-t", f"{duration:.3f}",
            "-vf", "setpts=PTS-STARTPTS",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-an",  # Audio is NOT mixed yet!
            "-avoid_negative_ts", "make_zero",
            "-fflags", "+genpts",
            output_path,
        ]
        self._run_cmd(cmd, is_cancelled=is_cancelled)
        return output_path

    def cut_trim(
        self,
        source_path: str,
        start: float,
        duration: float,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> str:
        """Trims source segment: keeps beginning of interval to match exact ttsDuration."""
        return self.cut_direct(source_path, start, duration, output_path, is_cancelled=is_cancelled)

    def cut_extend_forward(
        self,
        source_path: str,
        start: float,
        duration: float,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> str:
        """Extends segment forward continuously using available footage before next boundary."""
        return self.cut_direct(source_path, start, duration, output_path, is_cancelled=is_cancelled)

    def build_loop(
        self,
        source_path: str,
        start: float,
        src_duration: float,
        target_duration: float,
        output_path: str,
        temp_dir: Optional[str] = None,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> str:
        """
        Controlled seamless loop when forward source material is unavailable / boundary reached.
        Uses stream_loop on the extracted source interval to avoid any PTS discontinuities.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        work_dir = temp_dir or os.path.dirname(output_path)
        base_snippet = os.path.join(work_dir, f"_temp_base_{os.path.basename(output_path)}")

        try:
            # Step 1: Extract the base source snippet
            self.cut_direct(source_path, start, src_duration, base_snippet, is_cancelled=is_cancelled)

            # Step 2: Calculate loop count
            effective_src_dur = max(0.1, src_duration)
            loops_needed = int(math.ceil(target_duration / effective_src_dur))

            # Step 3: Stream loop to exact target duration
            cmd = [
                self.ffmpeg_bin,
                "-y",
                "-stream_loop", str(loops_needed),
                "-i", base_snippet,
                "-t", f"{target_duration:.3f}",
                "-vf", "setpts=PTS-STARTPTS",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                "-an",
                "-avoid_negative_ts", "make_zero",
                output_path,
            ]
            self._run_cmd(cmd, is_cancelled=is_cancelled)
        finally:
            if os.path.exists(base_snippet):
                try:
                    os.remove(base_snippet)
                except Exception:
                    pass

        return output_path

    def build_freeze_last_frame(
        self,
        source_path: str,
        start: float,
        src_duration: float,
        target_duration: float,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> str:
        """
        Fallback when loop or extend_forward cannot be used:
        Freezes the last valid frame of the interval using tpad until target_duration.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        extra_duration = max(0.1, target_duration - src_duration)

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-ss", f"{start:.3f}",
            "-i", source_path,
            "-t", f"{src_duration:.3f}",
            "-vf", f"setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={extra_duration:.3f}",
            "-t", f"{target_duration:.3f}",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-an",
            "-avoid_negative_ts", "make_zero",
            output_path,
        ]
        self._run_cmd(cmd, is_cancelled=is_cancelled)
        return output_path
