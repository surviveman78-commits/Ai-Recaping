export interface EdgeVoice {
  name: string;
  shortName: string;
  locale: string;
  gender: 'Male' | 'Female';
  friendlyName: string;
}

export const ALL_EDGE_VOICES: EdgeVoice[] = [
  // English (US, UK, AU, CA, IN)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-US, ChristopherNeural)',
    shortName: 'en-US-ChristopherNeural',
    locale: 'en-US',
    gender: 'Male',
    friendlyName: 'Christopher (US - Cinematic Deep Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)',
    shortName: 'en-US-GuyNeural',
    locale: 'en-US',
    gender: 'Male',
    friendlyName: 'Guy (US - Natural Casual Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
    shortName: 'en-US-JennyNeural',
    locale: 'en-US',
    gender: 'Female',
    friendlyName: 'Jenny (US - Conversational Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)',
    shortName: 'en-US-AriaNeural',
    locale: 'en-US',
    gender: 'Female',
    friendlyName: 'Aria (US - Expressive Storyteller Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-US, EricNeural)',
    shortName: 'en-US-EricNeural',
    locale: 'en-US',
    gender: 'Male',
    friendlyName: 'Eric (US - Contemporary Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-GB, SoniaNeural)',
    shortName: 'en-GB-SoniaNeural',
    locale: 'en-GB',
    gender: 'Female',
    friendlyName: 'Sonia (UK - Documentary BBC Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-GB, RyanNeural)',
    shortName: 'en-GB-RyanNeural',
    locale: 'en-GB',
    gender: 'Male',
    friendlyName: 'Ryan (UK - Refined British Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-AU, WilliamNeural)',
    shortName: 'en-AU-WilliamNeural',
    locale: 'en-AU',
    gender: 'Male',
    friendlyName: 'William (AU - Engaging Australian Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (en-CA, LiamNeural)',
    shortName: 'en-CA-LiamNeural',
    locale: 'en-CA',
    gender: 'Male',
    friendlyName: 'Liam (CA - Clear Canadian Male)',
  },

  // Italian (it-IT)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (it-IT, DiegoNeural)',
    shortName: 'it-IT-DiegoNeural',
    locale: 'it-IT',
    gender: 'Male',
    friendlyName: 'Diego (Italy - Deep Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (it-IT, IsabellaNeural)',
    shortName: 'it-IT-IsabellaNeural',
    locale: 'it-IT',
    gender: 'Female',
    friendlyName: 'Isabella (Italy - Expressive Narrative Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (it-IT, ElsaNeural)',
    shortName: 'it-IT-ElsaNeural',
    locale: 'it-IT',
    gender: 'Female',
    friendlyName: 'Elsa (Italy - Natural Broadcast Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (it-IT, GiuseppeNeural)',
    shortName: 'it-IT-GiuseppeNeural',
    locale: 'it-IT',
    gender: 'Male',
    friendlyName: 'Giuseppe (Italy - Warm Casual Male)',
  },

  // Spanish (es-ES, es-MX, es-US)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (es-ES, AlvaroNeural)',
    shortName: 'es-ES-AlvaroNeural',
    locale: 'es-ES',
    gender: 'Male',
    friendlyName: 'Alvaro (Spain - Resonant Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (es-ES, ElviraNeural)',
    shortName: 'es-ES-ElviraNeural',
    locale: 'es-ES',
    gender: 'Female',
    friendlyName: 'Elvira (Spain - Expressive Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (es-MX, JorgeNeural)',
    shortName: 'es-MX-JorgeNeural',
    locale: 'es-MX',
    gender: 'Male',
    friendlyName: 'Jorge (Mexico - Energetic Recap Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (es-MX, DaliaNeural)',
    shortName: 'es-MX-DaliaNeural',
    locale: 'es-MX',
    gender: 'Female',
    friendlyName: 'Dalia (Mexico - Warm Clear Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (es-US, AlonsoNeural)',
    shortName: 'es-US-AlonsoNeural',
    locale: 'es-US',
    gender: 'Male',
    friendlyName: 'Alonso (US Hispanic - Dynamic Male)',
  },

  // French (fr-FR, fr-CA)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (fr-FR, HenriNeural)',
    shortName: 'fr-FR-HenriNeural',
    locale: 'fr-FR',
    gender: 'Male',
    friendlyName: 'Henri (France - Narrative Cinema Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (fr-FR, DeniseNeural)',
    shortName: 'fr-FR-DeniseNeural',
    locale: 'fr-FR',
    gender: 'Female',
    friendlyName: 'Denise (France - Expressive Storyteller Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (fr-FR, EloiseNeural)',
    shortName: 'fr-FR-EloiseNeural',
    locale: 'fr-FR',
    gender: 'Female',
    friendlyName: 'Eloise (France - Clear Broadcast Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (fr-CA, AntoineNeural)',
    shortName: 'fr-CA-AntoineNeural',
    locale: 'fr-CA',
    gender: 'Male',
    friendlyName: 'Antoine (Canada - Canadian French Male)',
  },

  // German (de-DE, de-AT)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (de-DE, ConradNeural)',
    shortName: 'de-DE-ConradNeural',
    locale: 'de-DE',
    gender: 'Male',
    friendlyName: 'Conrad (Germany - Authoritative Documentary Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)',
    shortName: 'de-DE-KatjaNeural',
    locale: 'de-DE',
    gender: 'Female',
    friendlyName: 'Katja (Germany - Clear Storyteller Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KillianNeural)',
    shortName: 'de-DE-KillianNeural',
    locale: 'de-DE',
    gender: 'Male',
    friendlyName: 'Killian (Germany - Narrative Baritone Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (de-DE, AmalaNeural)',
    shortName: 'de-DE-AmalaNeural',
    locale: 'de-DE',
    gender: 'Female',
    friendlyName: 'Amala (Germany - Natural Female)',
  },

  // Burmese (my-MM)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (my-MM, ThihaNeural)',
    shortName: 'my-MM-ThihaNeural',
    locale: 'my-MM',
    gender: 'Male',
    friendlyName: 'Thiha (Burma / Myanmar - Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (my-MM, NilarNeural)',
    shortName: 'my-MM-NilarNeural',
    locale: 'my-MM',
    gender: 'Female',
    friendlyName: 'Nilar (Burma / Myanmar - Expressive Female)',
  },

  // Japanese (ja-JP)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, KeitaNeural)',
    shortName: 'ja-JP-KeitaNeural',
    locale: 'ja-JP',
    gender: 'Male',
    friendlyName: 'Keita (Japan - Cinematic Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, NanamiNeural)',
    shortName: 'ja-JP-NanamiNeural',
    locale: 'ja-JP',
    gender: 'Female',
    friendlyName: 'Nanami (Japan - Clear Storyteller Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, NaokiNeural)',
    shortName: 'ja-JP-NaokiNeural',
    locale: 'ja-JP',
    gender: 'Male',
    friendlyName: 'Naoki (Japan - Calm Documentary Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, AoiNeural)',
    shortName: 'ja-JP-AoiNeural',
    locale: 'ja-JP',
    gender: 'Female',
    friendlyName: 'Aoi (Japan - Expressive Narrative Female)',
  },

  // Portuguese (pt-BR, pt-PT)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (pt-BR, AntonioNeural)',
    shortName: 'pt-BR-AntonioNeural',
    locale: 'pt-BR',
    gender: 'Male',
    friendlyName: 'Antonio (Brazil - Narrative Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (pt-BR, FranciscaNeural)',
    shortName: 'pt-BR-FranciscaNeural',
    locale: 'pt-BR',
    gender: 'Female',
    friendlyName: 'Francisca (Brazil - Warm Expressive Female)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (pt-PT, DuarteNeural)',
    shortName: 'pt-PT-DuarteNeural',
    locale: 'pt-PT',
    gender: 'Male',
    friendlyName: 'Duarte (Portugal - European Portuguese Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (pt-PT, RaquelNeural)',
    shortName: 'pt-PT-RaquelNeural',
    locale: 'pt-PT',
    gender: 'Female',
    friendlyName: 'Raquel (Portugal - Expressive Female)',
  },

  // Hindi (hi-IN)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (hi-IN, MadhurNeural)',
    shortName: 'hi-IN-MadhurNeural',
    locale: 'hi-IN',
    gender: 'Male',
    friendlyName: 'Madhur (India - Narrative Hindi Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (hi-IN, SwaraNeural)',
    shortName: 'hi-IN-SwaraNeural',
    locale: 'hi-IN',
    gender: 'Female',
    friendlyName: 'Swara (India - Clear Expressive Hindi Female)',
  },

  // Chinese (zh-CN, zh-TW)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)',
    shortName: 'zh-CN-YunxiNeural',
    locale: 'zh-CN',
    gender: 'Male',
    friendlyName: 'Yunxi (China - Storyteller Mandarin Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)',
    shortName: 'zh-CN-XiaoxiaoNeural',
    locale: 'zh-CN',
    gender: 'Female',
    friendlyName: 'Xiaoxiao (China - Warm Mandarin Female)',
  },

  // Korean (ko-KR)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ko-KR, InJoonNeural)',
    shortName: 'ko-KR-InJoonNeural',
    locale: 'ko-KR',
    gender: 'Male',
    friendlyName: 'InJoon (Korea - Narrative Korean Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ko-KR, SunHiNeural)',
    shortName: 'ko-KR-SunHiNeural',
    locale: 'ko-KR',
    gender: 'Female',
    friendlyName: 'SunHi (Korea - Expressive Korean Female)',
  },

  // Russian (ru-RU)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ru-RU, DmitryNeural)',
    shortName: 'ru-RU-DmitryNeural',
    locale: 'ru-RU',
    gender: 'Male',
    friendlyName: 'Dmitry (Russia - Deep Russian Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ru-RU, SvetlanaNeural)',
    shortName: 'ru-RU-SvetlanaNeural',
    locale: 'ru-RU',
    gender: 'Female',
    friendlyName: 'Svetlana (Russia - Expressive Russian Female)',
  },

  // Arabic (ar-SA)
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ar-SA, HamedNeural)',
    shortName: 'ar-SA-HamedNeural',
    locale: 'ar-SA',
    gender: 'Male',
    friendlyName: 'Hamed (Saudi Arabia - Narrative Arabic Male)',
  },
  {
    name: 'Microsoft Server Speech Text to Speech Voice (ar-SA, ZariyahNeural)',
    shortName: 'ar-SA-ZariyahNeural',
    locale: 'ar-SA',
    gender: 'Female',
    friendlyName: 'Zariyah (Saudi Arabia - Expressive Arabic Female)',
  },
];

/**
 * Maps common language name strings or ISO codes to locale prefixes (e.g. "Italian" -> "it")
 */
export const LANGUAGE_LOCALE_MAP: Record<string, string> = {
  english: 'en',
  en: 'en',
  italian: 'it',
  italiano: 'it',
  it: 'it',
  spanish: 'es',
  español: 'es',
  es: 'es',
  french: 'fr',
  français: 'fr',
  fr: 'fr',
  german: 'de',
  deutsch: 'de',
  de: 'de',
  burmese: 'my',
  myanmar: 'my',
  my: 'my',
  japanese: 'ja',
  nihongo: 'ja',
  ja: 'ja',
  portuguese: 'pt',
  português: 'pt',
  pt: 'pt',
  hindi: 'hi',
  hi: 'hi',
  chinese: 'zh',
  mandarin: 'zh',
  zh: 'zh',
  korean: 'ko',
  ko: 'ko',
  russian: 'ru',
  ru: 'ru',
  arabic: 'ar',
  ar: 'ar',
};

/**
 * Extracts a normalized 2-letter language code from language string or locale
 */
export function resolveLanguageCode(input: string): string | null {
  if (!input || !input.trim()) return null;
  const cleaned = input.trim().toLowerCase();

  if (LANGUAGE_LOCALE_MAP[cleaned]) {
    return LANGUAGE_LOCALE_MAP[cleaned];
  }

  // If input is in format "it-IT", "en-US", etc.
  if (cleaned.includes('-')) {
    const prefix = cleaned.split('-')[0];
    if (prefix && prefix.length === 2) return prefix;
  }

  // Match if input starts with or contains any key in map
  for (const [key, code] of Object.entries(LANGUAGE_LOCALE_MAP)) {
    if (cleaned.startsWith(key) || key.startsWith(cleaned)) {
      return code;
    }
  }

  return null;
}

/**
 * Filters Edge TTS voices strictly matching the given target language
 */
export function getCompatibleEdgeVoices(language: string): EdgeVoice[] {
  const langCode = resolveLanguageCode(language);
  if (!langCode) {
    return [];
  }

  return ALL_EDGE_VOICES.filter((voice) => {
    const voicePrefix = voice.locale.split('-')[0].toLowerCase();
    return voicePrefix === langCode;
  });
}

/**
 * Checks if a specific voice ID (e.g. "it-IT-DiegoNeural") is compatible with target language
 */
export function isVoiceCompatibleWithLanguage(voiceId: string, language: string): boolean {
  if (!voiceId || !language) return false;
  const targetCode = resolveLanguageCode(language);
  if (!targetCode) return false;

  const foundVoice = ALL_EDGE_VOICES.find((v) => v.shortName === voiceId || v.name === voiceId);
  if (foundVoice) {
    return foundVoice.locale.split('-')[0].toLowerCase() === targetCode;
  }

  // Fallback check on string prefix e.g. "it-IT-..."
  const prefix = voiceId.split('-')[0].toLowerCase();
  return prefix === targetCode;
}

/**
 * Returns the recommended default voice for a language, or null if none exist
 */
export function getDefaultVoiceForLanguage(language: string): EdgeVoice | null {
  const voices = getCompatibleEdgeVoices(language);
  return voices.length > 0 ? voices[0] : null;
}
