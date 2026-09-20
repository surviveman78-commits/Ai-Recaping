import { Router, Request, Response } from 'express';
import { jobStore } from '../services/jobStore.ts';
import { GoogleGenAI } from '@google/genai';

const router = Router();

// GET /api/settings - Fetch current settings (keys masked)
router.get('/', (_req: Request, res: Response) => {
  res.json(jobStore.getSettings());
});

// PUT /api/settings - Update settings
router.put('/', (req: Request, res: Response) => {
  try {
    const updated = jobStore.updateSettings(req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
});

// POST /api/settings/test-gemini - Test Gemini API key
router.post('/test-gemini', async (req: Request, res: Response) => {
  try {
    const key = req.body.apiKey || jobStore.getRawKeys().geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      res.status(400).json({ success: false, error: 'Gemini API key is not configured' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Ping: Answer with word "OK"',
    });

    res.json({ success: true, message: 'Gemini API key verified successfully', reply: response.text?.trim() });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Gemini verification failed' });
  }
});

// POST /api/settings/test-groq - Test Groq API key
router.post('/test-groq', async (req: Request, res: Response) => {
  try {
    const key = req.body.apiKey || jobStore.getRawKeys().groqApiKey || process.env.GROQ_API_KEY;
    if (!key) {
      res.status(400).json({ success: false, error: 'Groq API key is not configured' });
      return;
    }

    // Call Groq API models endpoint
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(400).json({ success: false, error: `Groq authentication failed: ${response.statusText}`, details: errText });
      return;
    }

    const data: any = await response.json();
    const hasWhisper = data.data?.some((m: any) => m.id.includes('whisper'));

    res.json({
      success: true,
      message: `Groq API key verified! ${hasWhisper ? 'Whisper-large-v3 model available.' : ''}`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Groq verification failed' });
  }
});

export default router;
