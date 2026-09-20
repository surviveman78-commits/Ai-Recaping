import os
import re
import json
import time
from typing import List, Dict, Any, Optional

from worker.core.timeline.models import TimelineSegment, SRTCue

class SRTGenerator:
    """
    Generates standalone, editable SubRip (.srt) subtitle tracks synchronized with the reconstructed timeline.
    
    CORE GUARANTEES:
    - Subtitle timing follows the FINAL TIMELINE (finalStart -> finalEnd), NOT source movie timestamps!
    - Subtitles are NEVER burned into video frames; this is purely a separate downloadable/importable artifact.
    - Sentence-aware cue splitting: multi-sentence narrative chunks are split at natural sentence boundaries.
    - Full Unicode preservation for Burmese (မြန်မာ), Italian, Spanish, English, CJK, etc.
    - Monotonic, non-overlapping cue sequence starting at 1.
    """

    def __init__(self, target_language: str = "English"):
        self.target_language = target_language

    def split_into_sentences(self, text: str) -> List[str]:
        """
        Splits text into sentences based on punctuation, supporting Latin, CJK, and Burmese.
        Burmese punctuation:
          \u104B (။ - section mark / full stop)
          \u104A (၊ - comma / pause mark)
        """
        clean = text.strip()
        if not clean:
            return []

        # Burmese sentence boundary: \u104B (။)
        # Latin & CJK boundaries: [.!?。！？]
        # Match sentences including their trailing punctuation
        pattern = r'([^.!?。！？\u104B\n]+(?:[.!?。！？\u104B]+|$))'
        matches = [s.strip() for s in re.findall(pattern, clean) if s.strip()]

        if not matches:
            return [clean]

        # If any sentence in matches is excessively long (> 120 chars) and contains comma or Burmese comma (\u104A),
        # break at clause boundary for subtitle readability
        sub_cues: List[str] = []
        for m in matches:
            if len(m) > 120 and (',' in m or '၊' in m or ';' in m):
                clauses = [c.strip() for c in re.split(r'([,;၊]\s*)', m) if c.strip()]
                # Re-stitch clause delimiter to preceding clause
                stitched = []
                temp = ""
                for part in clauses:
                    temp += part
                    if len(temp) >= 40 or part in (',', '၊', ';'):
                        stitched.append(temp.strip())
                        temp = ""
                if temp:
                    stitched.append(temp.strip())
                sub_cues.extend(stitched if stitched else [m])
            else:
                sub_cues.append(m)

        return sub_cues if sub_cues else [clean]

    def build_cues(self, timeline_segments: List[TimelineSegment]) -> List[SRTCue]:
        """
        Builds a continuous, monotonic list of SRTCue objects from timeline segments.
        Timestamps are derived directly from segment.final_start and segment.final_end!
        """
        cues: List[SRTCue] = []
        seq_num = 1

        for seg in timeline_segments:
            seg_start = seg.final_start
            seg_end = seg.final_end
            seg_dur = max(0.2, seg_end - seg_start)
            raw_text = seg.target_text.strip()

            if not raw_text:
                continue

            sentences = self.split_into_sentences(raw_text)

            if len(sentences) <= 1:
                # Single sentence cue spans the segment duration
                cues.append(SRTCue(
                    sequence_number=seq_num,
                    start_time=round(seg_start, 3),
                    end_time=round(seg_end, 3),
                    text=sentences[0] if sentences else raw_text,
                    timeline_index=seg.timeline_index,
                    timing_method="exact",
                ))
                seq_num += 1
            else:
                # Multiple sentences: distribute time proportionally based on character weight
                total_weight = sum(max(1, len(s)) for s in sentences)
                current_time = seg_start

                for s_idx, sentence in enumerate(sentences):
                    weight = max(1, len(sentence))
                    cue_dur = round(seg_dur * (weight / float(total_weight)), 3)

                    cue_start = round(current_time, 3)
                    # Last sentence cue closes exactly at seg_end to guarantee no drift
                    if s_idx == len(sentences) - 1:
                        cue_end = round(seg_end, 3)
                    else:
                        cue_end = round(min(seg_end, cue_start + cue_dur), 3)

                    # Ensure cue_end is strictly greater than cue_start
                    if cue_end <= cue_start:
                        cue_end = round(cue_start + 0.5, 3)

                    cues.append(SRTCue(
                        sequence_number=seq_num,
                        start_time=cue_start,
                        end_time=cue_end,
                        text=sentence,
                        timeline_index=seg.timeline_index,
                        timing_method="proportional_sentence_split",
                    ))
                    seq_num += 1
                    current_time = cue_end

        return cues

    def generate_srt_file(
        self,
        timeline_segments: List[TimelineSegment],
        output_srt_path: str,
        output_manifest_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Builds and saves the recap.srt file and subtitles/manifest.json.
        """
        os.makedirs(os.path.dirname(output_srt_path), exist_ok=True)
        cues = self.build_cues(timeline_segments)

        # Write SRT text in strict UTF-8 with standard Windows/Unix newline consistency
        srt_content_blocks = [cue.to_srt_block() for cue in cues]
        srt_content = "\n".join(srt_content_blocks)

        with open(output_srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)

        total_duration = round(timeline_segments[-1].final_end if timeline_segments else 0.0, 3)

        manifest_data = {
            "format": "srt",
            "language": self.target_language,
            "path": output_srt_path,
            "cueCount": len(cues),
            "duration": total_duration,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "timingMethod": "timeline_synchronized_sentence_split",
            "noBurnedInSubtitles": True,
        }

        if output_manifest_path:
            os.makedirs(os.path.dirname(output_manifest_path), exist_ok=True)
            with open(output_manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, indent=2, ensure_ascii=False)

        return {
            "srtPath": output_srt_path,
            "manifestPath": output_manifest_path,
            "cueCount": len(cues),
            "duration": total_duration,
            "cues": [
                {
                    "seq": c.sequence_number,
                    "start": c.start_time,
                    "end": c.end_time,
                    "text": c.text,
                    "timingMethod": c.timing_method,
                }
                for c in cues
            ],
            "manifest": manifest_data,
        }
