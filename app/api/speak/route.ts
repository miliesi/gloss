import { generate } from "@/lib/gemini";
import { needKey } from "@/lib/quota";
import { TTS_MAX_CHARS, TTS_MODEL, TTS_VOICE } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One passage, spoken. Gemini answers with the whole clip as WAV, which the browser plays as soon as it arrives. */
export async function POST(req: Request) {
  let body: { text?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "Nothing to read." }, { status: 400 });
  if (text.length > TTS_MAX_CHARS + 200) return Response.json({ error: "That passage is too long to read in one go." }, { status: 413 });

  const headerKey = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  // Reading aloud is never on the shared key: a minute of voice costs more than a day of free answers.
  const apiKey = body.apiKey?.trim() || headerKey || undefined;
  if (!apiKey) return needKey(null, "Reading aloud uses your own Gemini API key. Add it to listen.");

  const r = await generate({
    apiKey,
    type: "audio",
    signal: req.signal,
    body: {
      model: TTS_MODEL,
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: TTS_VOICE }] },
    },
  });
  if (!r.ok) return Response.json({ error: r.error, ...(r.status === 401 ? { code: "need_key" } : {}) }, { status: r.status });
  return new Response(Buffer.from(r.media.data, "base64"), { headers: { "Content-Type": r.media.mime || "audio/wav", "Cache-Control": "no-store" } });
}
