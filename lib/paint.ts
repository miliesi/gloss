/**
 * A painted cover for one text, on the server: the scene the classifier
 * wrote, as a two-colour risograph print in its topic's inks, painted by
 * Gemini. The title is never in the prompt, or the model letters it onto the
 * picture.
 */

import { TOPIC, type TopicKey } from "./library";
import { generate, MISSING_GEMINI_KEY } from "./gemini";

/** Gemini 3.1 Flash-Lite Image: the fastest, cheapest Gemini image model. It makes 1K pictures. */
const MODEL = "gemini-3.1-flash-lite-image";
/** What one cover costs, charged to the free allowance: $0.0336 for a 1K image, rounded up. */
export const COVER_USD = 0.04;

export async function paintCover(req: { scene: string; topic: TopicKey; apiKey?: string; signal?: AbortSignal }): Promise<{ ok: true; jpeg: Uint8Array } | { ok: false; error: string }> {
  const apiKey = req.apiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: MISSING_GEMINI_KEY };
  const prompt = `Editorial risograph print. ${req.scene.replace(/\.?$/, ".")} Two-colour palette of ${TOPIC[req.topic].inks} ink on warm cream paper filling the whole image, grain and halftone texture, mid-century book-cover illustration, wordless, no lettering, no border.`;
  const r = await generate({
    apiKey,
    type: "image",
    signal: req.signal,
    body: { model: MODEL, input: prompt, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" } },
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, jpeg: Uint8Array.from(Buffer.from(r.media.data, "base64")) };
}
