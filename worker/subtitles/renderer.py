import os
from typing import List, Dict, Any

class SubtitleRenderer:
    """
    Renders styled subtitles using Advanced SubStation Alpha (.ass) format:
    - Custom font family / custom font file (.ttf / .otf)
    - Font size, primary color, outline color & width, shadow blur
    - Exact timing synchronized to the reconstructed final timeline
    """

    @staticmethod
    def format_timestamp(seconds: float) -> str:
        """Formats seconds into ASS timestamp: H:MM:SS.cs"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        cs = int((seconds - int(seconds)) * 100)
        return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"

    @staticmethod
    def hex_to_ass_color(hex_color: str, alpha: int = 0) -> str:
        """
        Converts #RRGGBB to ASS &HAABBGGRR format.
        """
        hex_color = hex_color.lstrip("#")
        if len(hex_color) == 6:
            r = hex_color[0:2]
            g = hex_color[2:4]
            b = hex_color[4:6]
            return f"&H{alpha:02X}{b}{g}{r}"
        return "&H00FFFFFF"

    def generate_ass_file(
        self,
        segments: List[Dict[str, Any]],
        subtitle_config: Dict[str, Any],
        output_ass_path: str,
    ) -> str:
        """
        Builds .ass subtitle file honoring all style parameters.
        """
        os.makedirs(os.path.dirname(output_ass_path), exist_ok=True)

        cfg = subtitle_config or {}
        font_name = cfg.get("fontFamily", "Plus Jakarta Sans")
        font_size = cfg.get("fontSize", 24)
        font_color = cfg.get("fontColor", "#ffffff")
        outline_color = cfg.get("outlineColor", "#000000")
        outline_width = cfg.get("outlineWidth", 3)
        shadow_offset = cfg.get("shadowOffset", 2)
        bottom_margin = cfg.get("bottomMargin", 48)

        primary_bgr = self.hex_to_ass_color(font_color)
        outline_bgr = self.hex_to_ass_color(outline_color)
        shadow_bgr = "&H80000000"

        # Alignment: 2 = bottom center, 5 = middle center, 8 = top center
        pos_str = cfg.get("position", "bottom")
        alignment = 2
        if pos_str == "middle":
            alignment = 5
        elif pos_str == "top":
            alignment = 8

        ass_content = f"""[Script Info]
Title: Movie Recap Studio Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size * 2},{primary_bgr},&H000000FF,{outline_bgr},{shadow_bgr},-1,0,0,0,100,100,0.5,0,1,{outline_width},{shadow_offset},{alignment},60,60,{bottom_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

        events = []
        for seg in segments:
            start_ts = self.format_timestamp(seg["subtitleStart"])
            end_ts = self.format_timestamp(seg["subtitleEnd"])
            clean_text = seg["scriptText"].replace("\n", "\\N")
            events.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{clean_text}")

        full_script = ass_content + "\n".join(events) + "\n"

        with open(output_ass_path, "w", encoding="utf-8") as f:
            f.write(full_script)

        return output_ass_path

    def burn_subtitles_ffmpeg(
        self,
        input_video_path: str,
        ass_subtitle_path: str,
        output_video_path: str,
        custom_fonts_dir: str = None,
    ) -> List[str]:
        """
        Returns the FFmpeg command list to burn ASS subtitles with optional font directory.
        """
        filter_str = f"ass='{ass_subtitle_path}'"
        if custom_fonts_dir and os.path.exists(custom_fonts_dir):
            filter_str = f"ass='{ass_subtitle_path}':fontsdir='{custom_fonts_dir}'"

        cmd = [
            "ffmpeg", "-y",
            "-i", input_video_path,
            "-vf", filter_str,
            "-c:v", "libx264",
            "-crf", "19",
            "-preset", "medium",
            "-c:a", "copy",
            output_video_path,
        ]
        return cmd
