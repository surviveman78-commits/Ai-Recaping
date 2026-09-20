import os
from typing import List, Dict, Any

class TimelineReconstructor:
    """
    TTS-Driven Dynamic Timeline Reconstruction.
    
    IMPORTANT: The application MUST NOT assume that the original video's
    segment duration remains unchanged.
    TTS audio duration is the source of truth for the generated narration timeline.
    
    For every generated TTS segment:
    1. Measure actual TTS duration.
    2. Create a timeline segment using that exact duration.
    3. Map corresponding source video content to that duration.
    4. Trim, extend, or speed-adjust video frames without changing TTS natural speech cadence.
    5. Place TTS audio exactly on the timeline.
    6. Generate subtitle timing from the final timeline.
    """

    def __init__(self, pause_between_segments: float = 0.4):
        self.pause_between_segments = pause_between_segments

    def reconstruct_timeline(
        self,
        raw_segments: List[Dict[str, Any]],
        tts_durations: List[float],
        tts_audio_paths: List[str],
    ) -> List[Dict[str, Any]]:
        """
        Calculates final timeline positions where TTS duration is the source of truth.
        """
        reconstructed_segments = []
        current_final_time = 0.0

        for i, raw in enumerate(raw_segments):
            src_start = float(raw.get("source_start", raw.get("sourceStart", 0.0)))
            src_end = float(raw.get("source_end", raw.get("sourceEnd", src_start + 5.0)))
            src_duration = round(max(0.1, src_end - src_start), 2)

            script_text = raw.get("script_text", raw.get("scriptText", ""))
            tts_dur = float(tts_durations[i])
            tts_path = tts_audio_paths[i] if i < len(tts_audio_paths) else ""

            # The timeline segment duration MUST accommodate the TTS duration!
            # Adding slight lead-in / lead-out breathing room (0.15s)
            segment_timeline_duration = tts_dur

            final_start = round(current_final_time, 2)
            final_end = round(final_start + segment_timeline_duration, 2)

            # Subtitles start slightly after segment starts and conclude slightly before it ends
            sub_start = round(final_start + 0.1, 2)
            sub_end = round(max(sub_start + 0.5, final_end - 0.1), 2)

            # Determine video mapping strategy:
            # - If TTS is longer than source: video can be slowed down slightly (e.g. setpts=PTS*factor)
            #   or frozen/looped at keyframe to span the full narrative line.
            # - If TTS is shorter than source: source video segment is cleanly trimmed to match.
            stretch_ratio = round(tts_dur / src_duration, 3)

            reconstructed_segments.append({
                "id": f"seg-{i + 1}",
                "sourceStart": src_start,
                "sourceEnd": src_end,
                "sourceDuration": src_duration,
                "scriptText": script_text,
                "ttsAudioPath": tts_path,
                "ttsDuration": tts_dur,
                "finalStart": final_start,
                "finalEnd": final_end,
                "subtitleStart": sub_start,
                "subtitleEnd": sub_end,
                "stretchRatio": stretch_ratio,
            })

            current_final_time = final_end + self.pause_between_segments

        return reconstructed_segments

    def generate_ffmpeg_filtergraph(
        self,
        source_video_path: str,
        segments: List[Dict[str, Any]],
        output_temp_video: str,
    ) -> str:
        """
        Generates FFmpeg command string to slice and adjust each video segment to match its TTS duration.
        """
        filter_complex = []
        concat_inputs = []

        for idx, seg in enumerate(segments):
            src_start = seg["sourceStart"]
            src_end = seg["sourceEnd"]
            tts_dur = seg["ttsDuration"]
            src_dur = seg["sourceDuration"]

            # Speed adjustment factor for video frames:
            # setpts=(tts_dur / src_dur)*PTS so video matches the exact TTS length!
            speed_factor = tts_dur / max(0.1, src_dur)

            # Trim video from source, reset PTS, scale timestamps by speed_factor
            filt = f"[0:v]trim=start={src_start}:end={src_end},setpts=(PTS-STARTPTS)*{speed_factor:.4f}[v{idx}];"
            filter_complex.append(filt)
            concat_inputs.append(f"[v{idx}]")

        concat_clause = "".join(concat_inputs) + f"concat=n={len(segments)}:v=1:a=0[vout]"
        filter_complex.append(concat_clause)

        full_filter = "".join(filter_complex)
        cmd = f'ffmpeg -y -i "{source_video_path}" -filter_complex "{full_filter}" -map "[vout]" -c:v libx264 -crf 20 -preset faster "{output_temp_video}"'
        return cmd
