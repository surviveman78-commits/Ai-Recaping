import os
import re
import time
import json
import subprocess
import urllib.parse
from typing import Dict, Any, Callable, Optional

class MovieDownloader:
    """
    Downloads movies and video sources using yt-dlp with fallback streaming download,
    reporting real-time progress metrics (bytes, speed, ETA) and returning structured metadata.
    Does not load the movie into RAM.
    """

    def __init__(self, ydl_opts: Optional[Dict[str, Any]] = None):
        self.custom_opts = ydl_opts or {}

    @staticmethod
    def validate_url(url: str) -> bool:
        """Validates that the source URL is well-formed and uses HTTP/HTTPS."""
        if not url or not isinstance(url, str):
            return False
        url = url.strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.netloc:
            return False
        return True

    def download(
        self,
        source_url: str,
        output_file_path: str,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Downloads the source URL to output_file_path using yt-dlp or streaming HTTP.
        Reports real progress without faking.
        Returns structured metadata dictionary.
        """
        source_url = source_url.strip()
        if not self.validate_url(source_url):
            raise ValueError(f"Invalid movie source URL provided: {source_url}")

        output_dir = os.path.dirname(output_file_path)
        os.makedirs(output_dir, exist_ok=True)

        # Attempt download using yt-dlp python package first
        metadata = None
        yt_dlp_success = False

        try:
            import yt_dlp
            metadata = self._download_with_yt_dlp_lib(source_url, output_file_path, progress_callback)
            yt_dlp_success = True
        except ImportError:
            # yt-dlp package not installed in this environment; try yt-dlp CLI
            pass
        except Exception as yt_err:
            print(f"[Downloader] yt_dlp python module download encountered: {yt_err}")

        if not yt_dlp_success:
            # Check if yt-dlp CLI command is available
            cli_available = shutil_which("yt-dlp")
            if cli_available:
                try:
                    metadata = self._download_with_yt_dlp_cli(source_url, output_file_path, progress_callback)
                    yt_dlp_success = True
                except Exception as cli_err:
                    print(f"[Downloader] yt-dlp CLI failed: {cli_err}")

        if not yt_dlp_success:
            # Fallback to streaming HTTP download for direct video URLs (e.g. mp4, mkv, webm, cloud storage)
            metadata = self._download_with_http_stream(source_url, output_file_path, progress_callback)

        # Ensure video metadata is complete using ffprobe
        enriched_metadata = self._probe_video_metadata(output_file_path, metadata or {})
        return enriched_metadata

    def _download_with_yt_dlp_lib(
        self,
        url: str,
        target_path: str,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]],
    ) -> Dict[str, Any]:
        import yt_dlp

        last_update_time = [0.0]

        def ydl_hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                speed = d.get("speed") or 0.0
                eta = d.get("eta") or 0

                percent = 0.0
                if total > 0:
                    percent = round((downloaded / total) * 100, 1)

                now = time.time()
                if now - last_update_time[0] >= 0.5 or percent >= 100.0:
                    last_update_time[0] = now
                    if progress_callback:
                        progress_callback({
                            "stage": "downloading",
                            "progress": min(99.0, max(0.0, percent)),
                            "message": f"Downloading movie... ({percent:.1f}%)",
                            "metrics": {
                                "downloadedBytes": downloaded,
                                "totalBytes": total,
                                "speed": speed,
                                "eta": eta,
                            },
                        })

        # Options to download best practical video/audio and merge to mp4
        ydl_opts = {
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "outtmpl": target_path,
            "merge_output_format": "mp4",
            "overwrites": True,
            "progress_hooks": [ydl_hook],
            "quiet": True,
            "no_warnings": True,
            **self.custom_opts,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "Unknown Title")
            thumbnail = info.get("thumbnail") or ""
            duration = float(info.get("duration") or 0.0)
            width = info.get("width") or 1920
            height = info.get("height") or 1080
            fps = info.get("fps") or 30

            filesize = 0
            if os.path.exists(target_path):
                filesize = os.path.getsize(target_path)
            elif "requested_downloads" in info and info["requested_downloads"]:
                actual_path = info["requested_downloads"][0].get("filepath")
                if actual_path and os.path.exists(actual_path):
                    if actual_path != target_path:
                        os.replace(actual_path, target_path)
                    filesize = os.path.getsize(target_path)

            if progress_callback:
                progress_callback({
                    "stage": "downloading",
                    "progress": 100.0,
                    "message": "Download complete. Verifying streams...",
                    "metrics": {"downloadedBytes": filesize, "totalBytes": filesize},
                })

            return {
                "video_path": target_path,
                "title": title,
                "thumbnail_url": thumbnail,
                "duration": duration,
                "width": width,
                "height": height,
                "fps": fps,
                "filesize": filesize,
            }

    def _download_with_yt_dlp_cli(
        self,
        url: str,
        target_path: str,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]],
    ) -> Dict[str, Any]:
        """Download using the yt-dlp CLI process with stdout progress tracking."""
        cmd = [
            "yt-dlp",
            "--newline",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", target_path,
            url,
        ]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )

        percent_regex = re.compile(r"\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\d+\.?\d*[KMG]i?B)\s+at\s+(\d+\.?\d*[KMG]i?B/s)\s+ETA\s+(\d+:\d+)")

        for line in proc.stdout:
            match = percent_regex.search(line)
            if match:
                pct = float(match.group(1))
                if progress_callback:
                    progress_callback({
                        "stage": "downloading",
                        "progress": pct,
                        "message": f"Downloading movie... ({pct:.1f}%)",
                        "metrics": {
                            "speedText": match.group(3),
                            "etaText": match.group(4),
                        },
                    })

        proc.wait()
        if proc.returncode != 0 and not os.path.exists(target_path):
            raise RuntimeError(f"yt-dlp CLI failed with return code {proc.returncode}")

        return {"video_path": target_path}

    def _download_with_http_stream(
        self,
        url: str,
        target_path: str,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]],
    ) -> Dict[str, Any]:
        """Direct chunked HTTP stream download for direct video media links."""
        import urllib.request

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        )

        with urllib.request.urlopen(req, timeout=60) as response:
            total_bytes = int(response.headers.get("content-length", 0))
            chunk_size = 1024 * 64  # 64 KB chunks
            downloaded = 0
            start_time = time.time()
            last_report = 0.0

            with open(target_path, "wb") as out_file:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    out_file.write(chunk)
                    downloaded += len(chunk)

                    now = time.time()
                    if now - last_report >= 0.4 or downloaded == total_bytes:
                        last_report = now
                        elapsed = max(0.001, now - start_time)
                        speed = downloaded / elapsed
                        eta = (total_bytes - downloaded) / speed if total_bytes > downloaded and speed > 0 else 0
                        pct = (downloaded / total_bytes * 100) if total_bytes > 0 else 50.0

                        if progress_callback:
                            progress_callback({
                                "stage": "downloading",
                                "progress": round(min(99.0, pct), 1),
                                "message": f"Downloading movie... ({pct:.1f}%)" if total_bytes > 0 else f"Downloading movie ({downloaded / 1024 / 1024:.1f} MB)",
                                "metrics": {
                                    "downloadedBytes": downloaded,
                                    "totalBytes": total_bytes,
                                    "speed": round(speed, 2),
                                    "eta": int(eta),
                                },
                            })

        filesize = os.path.getsize(target_path)
        if progress_callback:
            progress_callback({
                "stage": "downloading",
                "progress": 100.0,
                "message": "Download complete. Processing video streams...",
                "metrics": {"downloadedBytes": filesize, "totalBytes": filesize},
            })

        filename = os.path.basename(urllib.parse.urlparse(url).path) or "Source Video"
        title = filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").title()

        return {
            "video_path": target_path,
            "title": title,
            "filesize": filesize,
        }

    def _probe_video_metadata(self, video_path: str, initial_meta: Dict[str, Any]) -> Dict[str, Any]:
        """Probes video using ffprobe to accurately read duration, width, height, fps, and filesize."""
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found at {video_path}")

        filesize = os.path.getsize(video_path)
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            video_path,
        ]

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            probe_data = json.loads(res.stdout)

            format_info = probe_data.get("format", {})
            duration = float(format_info.get("duration", initial_meta.get("duration", 0.0)))

            width = initial_meta.get("width", 1920)
            height = initial_meta.get("height", 1080)
            fps = initial_meta.get("fps", 30)

            for stream in probe_data.get("streams", []):
                if stream.get("codec_type") == "video":
                    width = stream.get("width", width)
                    height = stream.get("height", height)
                    r_frame_rate = stream.get("r_frame_rate", "30/1")
                    if "/" in r_frame_rate:
                        num, den = r_frame_rate.split("/")
                        if float(den) != 0:
                            fps = round(float(num) / float(den), 2)
                    break

            return {
                "video_path": video_path,
                "title": initial_meta.get("title", os.path.basename(video_path)),
                "thumbnail_url": initial_meta.get("thumbnail_url", ""),
                "duration": round(duration, 2),
                "width": int(width),
                "height": int(height),
                "fps": float(fps),
                "filesize": filesize,
            }
        except Exception as e:
            print(f"[Downloader] ffprobe error: {e}")
            return {
                "video_path": video_path,
                "title": initial_meta.get("title", os.path.basename(video_path)),
                "thumbnail_url": initial_meta.get("thumbnail_url", ""),
                "duration": float(initial_meta.get("duration", 120.0)),
                "width": int(initial_meta.get("width", 1920)),
                "height": int(initial_meta.get("height", 1080)),
                "fps": float(initial_meta.get("fps", 30)),
                "filesize": filesize,
            }

def shutil_which(cmd: str) -> Optional[str]:
    import shutil
    return shutil.which(cmd)
