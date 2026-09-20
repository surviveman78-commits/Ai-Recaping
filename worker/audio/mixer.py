import os
import subprocess
from typing import List, Dict, Any

class AudioMixer:
    """
    Mixes TTS narration with original background movie audio:
    - Normalizes TTS voice audio for broadcast clarity
    - Ducks original background audio when narrator speaks
    - Exports master blended audio track
    """

    def __init__(self, ducking_attenuation_db: int = -18):
        self.ducking_attenuation_db = ducking_attenuation_db

    def assemble_tts_track(
        self,
        segments: List[Dict[str, Any]],
        total_duration: float,
        output_tts_track_path: str,
    ) -> None:
        """
        Places each TTS audio segment at its exact finalStart position on a silent canvas.
        """
        os.makedirs(os.path.dirname(output_tts_track_path), exist_ok=True)

        inputs = []
        filter_parts = []

        # Create silent base track for full duration
        filter_parts.append(f"aevalsrc=0:d={total_duration}[base];")

        last_label = "[base]"
        for idx, seg in enumerate(segments):
            path = seg.get("ttsAudioPath")
            if not path or not os.path.exists(path):
                continue

            inputs.extend(["-i", path])
            input_idx = len(inputs) // 2  # 1-indexed because input 0 is not yet in inputs list

            # Delay the audio to finalStart milliseconds
            delay_ms = int(seg["finalStart"] * 1000)
            delayed_label = f"[delayed{idx}]"
            filter_parts.append(f"[{input_idx}:a]adelay={delay_ms}|{delay_ms}{delayed_label};")

            next_label = f"[mix{idx}]"
            filter_parts.append(f"{last_label}{delayed_label}amix=inputs=2:duration=first:dropout_transition=0{next_label};")
            last_label = next_label

        # If no TTS segments were found, write silent audio
        if not inputs:
            cmd = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
                "-t", str(total_duration), "-q:a", "9", "-acodec", "libmp3lame",
                output_tts_track_path
            ]
            subprocess.run(cmd, check=True)
            return

        full_filter = "".join(filter_parts)
        cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={total_duration}"] + inputs + [
            "-filter_complex", full_filter.rstrip(";"),
            "-map", last_label,
            "-ac", "2",
            "-ar", "44100",
            output_tts_track_path
        ]
        subprocess.run(cmd, check=True)

    def mix_narration_with_background(
        self,
        tts_audio_path: str,
        background_audio_path: str,
        output_mixed_path: str,
    ) -> None:
        """
        Applies sidechain compression (ducking) to lower background music/SFX during narration.
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", background_audio_path,
            "-i", tts_audio_path,
            "-filter_complex",
            "[0:a][1:a]sidechaincompress=threshold=0.125:ratio=6:attack=20:release=350[ducked];"
            "[ducked][1:a]amix=inputs=2:weights=0.35 1.0:normalize=0[out]",
            "-map", "[out]",
            "-ac", "2",
            "-ar", "44100",
            output_mixed_path
        ]
        subprocess.run(cmd, check=True)
