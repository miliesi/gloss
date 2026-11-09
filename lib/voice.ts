/**
 * Read aloud: Gemini text-to-speech. gemini-3.8-flash-tts is the full model;
 * gemini-3.8-flash-lite-tts is about a third cheaper. Swap the id here.
 * The answer is a 24 kHz mono WAV, which every browser plays.
 */
export const TTS_MODEL = "gemini-3.8-flash-tts";
/** "Charon": an informative, even voice, steady over long reading. */
export const TTS_VOICE = "Charon";
/** One request's worth of text. Paragraphs past this are split at sentence ends. */
export const TTS_MAX_CHARS = 1200;
