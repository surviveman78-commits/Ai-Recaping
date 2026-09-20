import { GoogleGenAI } from '@google/genai';
import { jobStore } from './jobStore.ts';

export interface RecapSegmentDraft {
  sourceStart: number;
  sourceEnd: number;
  scriptText: string;
}

export class GeminiRecapService {
  private getClient(): GoogleGenAI | null {
    const { geminiApiKey } = jobStore.getRawKeys();
    const key = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) return null;

    return new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async generateRecapScript(params: {
    movieTitle: string;
    originalTranscript: Array<{ start: number; end: number; text: string }> | string;
    targetLanguage?: string;
    toneStyle?: 'suspenseful' | 'documentary' | 'action' | 'casual';
  }): Promise<{ fullScript: string; segments: RecapSegmentDraft[] }> {
    const ai = this.getClient();
    const rawTranscript = typeof params.originalTranscript === 'string'
      ? params.originalTranscript
      : params.originalTranscript.map((t) => `[${t.start.toFixed(1)}s - ${t.end.toFixed(1)}s] ${t.text}`).join('\n');

    if (!ai) {
      // Fallback generator when Gemini key is not yet configured
      return this.generateFallbackScript(params.movieTitle, params.originalTranscript);
    }

    try {
      const toneInstruction = {
        suspenseful: 'Mysterious, dramatic, high tension, highlighting plot twists.',
        documentary: 'Authoritative, analytical, engaging, balanced cinema critique.',
        action: 'Fast-paced, punchy, adrenaline-driven, emphasizing high-stakes stakes.',
        casual: 'Conversational, witty, modern internet storytelling style.',
      }[params.toneStyle || 'suspenseful'];

      const prompt = `You are an elite Movie Recap narrator. You take raw audio transcripts with timestamps and craft an enthralling, cohesive narration script.
Movie: ${params.movieTitle}
Tone: ${toneInstruction}
Language: ${params.targetLanguage || 'English'}

Raw Timestamped Transcript:
${rawTranscript}

Instructions:
1. Rewrite the transcript into a thrilling, cinematic recap narration script.
2. Group the movie into sequential key narrative beats/scenes, matching each narration sentence to the corresponding source video timestamp window [sourceStart, sourceEnd].
3. Return STRICT JSON with this schema:
{
  "fullScript": "Complete recap narration text...",
  "segments": [
    {
      "sourceStart": 12.0,
      "sourceEnd": 20.0,
      "scriptText": "Narration for this segment..."
    }
  ]
}
Do not return Markdown code fences or extra text, only valid JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const text = response.text?.trim() || '{}';
      const parsed = JSON.parse(text);

      if (parsed.fullScript && Array.isArray(parsed.segments) && parsed.segments.length > 0) {
        return {
          fullScript: parsed.fullScript,
          segments: parsed.segments.map((s: any) => ({
            sourceStart: Number(s.sourceStart) || 0,
            sourceEnd: Number(s.sourceEnd) || (Number(s.sourceStart) + 5),
            scriptText: String(s.scriptText || ''),
          })),
        };
      }
      return this.generateFallbackScript(params.movieTitle, params.originalTranscript);
    } catch (err) {
      console.warn('Gemini script generation fallback triggered:', err);
      return this.generateFallbackScript(params.movieTitle, params.originalTranscript);
    }
  }

  private generateFallbackScript(
    title: string,
    transcript: Array<{ start: number; end: number; text: string }> | string
  ): { fullScript: string; segments: RecapSegmentDraft[] } {
    if (Array.isArray(transcript) && transcript.length > 0) {
      const segments: RecapSegmentDraft[] = transcript.map((t, idx) => ({
        sourceStart: t.start,
        sourceEnd: t.end,
        scriptText: idx === 0
          ? `The story of ${title} opens as events rapidly unfold.`
          : `Next, our protagonist realizes the true gravity of the situation: ${t.text.slice(0, 80)}.`,
      }));

      const fullScript = segments.map((s) => s.scriptText).join(' ');
      return { fullScript, segments };
    }

    return {
      fullScript: `In the opening chapter of ${title}, unexplained signals emerge from the depths. Without warning, a chain reaction is unleashed that will alter everything.`,
      segments: [
        {
          sourceStart: 0,
          sourceEnd: 8.0,
          scriptText: `In the opening chapter of ${title}, unexplained signals emerge from the depths.`,
        },
        {
          sourceStart: 8.0,
          sourceEnd: 16.5,
          scriptText: `Without warning, a chain reaction is unleashed that will alter everything forever.`,
        },
      ],
    };
  }
}

export const geminiRecapService = new GeminiRecapService();
