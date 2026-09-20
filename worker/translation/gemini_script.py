import json
from typing import List, Dict, Any

class GeminiScriptRewriter:
    """
    Rewrites transcripts into a high-stakes, cinematic movie recap narration script using Gemini API.
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        if not api_key:
            raise ValueError("Gemini API key is required for script rewriting")

    def rewrite_to_recap(
        self,
        movie_title: str,
        transcript_segments: List[Dict[str, Any]],
        tone: str = "suspenseful"
    ) -> Dict[str, Any]:
        """
        Translates/rewrites raw dialog timestamps into dramatic recap narrative beats.
        Returns:
        {
            "full_script": str,
            "segments": [
                {
                    "source_start": float,
                    "source_end": float,
                    "script_text": str
                }
            ]
        }
        """
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)

        transcript_text = "\n".join(
            f"[{s['start']:.1f}s - {s['end']:.1f}s] {s['text']}" for s in transcript_segments
        )

        prompt = f"""You are a master movie recap narrator. Transform the following raw dialogue transcript from "{movie_title}" into a thrilling, cinematic recap narration script.
Tone: {tone} (high engagement, suspenseful, dramatic beats).

Raw dialogue with timestamps:
{transcript_text}

Requirements:
1. Divide the movie into sequential key narrative segments, mapping each narration line to the corresponding source video timestamp interval.
2. Return ONLY valid JSON matching this schema:
{{
  "full_script": "The complete recap narration text...",
  "segments": [
    {{
      "source_start": 0.0,
      "source_end": 12.5,
      "script_text": "Narration text for this scene..."
    }}
  ]
}}"""

        response = client.models.generate_content(
            model="gemini-3.8-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.7,
            ),
        )

        data = json.loads(response.text.strip())
        return data
