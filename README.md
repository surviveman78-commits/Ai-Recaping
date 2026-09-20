# 🎬 AI Movie Recap Studio

### AI-Powered End-to-End Movie Recap & Video Dubbing Platform

> Video ကို Download လုပ်ရုံနဲ့ မပြီးဘူး။
> Video ကို နားလည်တယ်။
> Script ကို ပြန်တည်ဆောက်တယ်။
> Voice ကို ထုတ်တယ်။
> Timeline ကို ပြန်တွက်တယ်။
> ပြီးမှ Final Video ကို ပြန်တည်ဆောက်တယ်။

---

# 🧠 Project Overview

**AI Movie Recap Studio** ဟာ Long-form Video / Movie Content တွေကို AI နဲ့ အလိုအလျောက် Processing လုပ်ပြီး Target Language Recap Video အဖြစ် ပြန်လည်တည်ဆောက်နိုင်အောင် ရည်ရွယ်ထားတဲ့ End-to-End AI Video Processing Platform ဖြစ်ပါတယ်။

ဒီ Project ရဲ့ အဓိကအယူအဆက AI Model တစ်ခုတည်းကို သုံးပြီး Video Generate လုပ်တာ မဟုတ်ပါဘူး။

Video တစ်ခုကို Input အဖြစ် လက်ခံပြီး

```text
                    SOURCE VIDEO
                         │
                         ▼
                ┌─────────────────┐
                │ Video Acquisition│
                │ URL / Upload     │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Audio Extraction│
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Speech-to-Text  │
                │ Whisper / Groq  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Transcript       │
                │ Processing       │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Translation      │
                │ + Recap Rewrite  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ TTS Generation   │
                │ Edge / VoxCPM2   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Duration         │
                │ Measurement      │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Dynamic Timeline │
                │ Reconstruction   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Audio Mixing     │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Subtitle Engine  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Final Encoding   │
                └────────┬────────┘
                         │
                         ▼
                  FINAL VIDEO
