/**
 * Gemini client for the two things Claude does not make: speech and pictures.
 * Server-side only. Raw fetch against the Interactions API, one request, one
 * answer; the audio or image comes back as a base64 block inside `steps`.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const MISSING_GEMINI_KEY = "No Gemini API key. Set GEMINI_API_KEY, or add your own key.";

/** A block of generated media: base64 data and its type. */
export type Media = { data: string; mime: string };

/** The first block of a kind anywhere in the answer, wherever the API nests it. */
function findBlock(node: unknown, type: "audio" | "image"): Media | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (o.type === type && typeof o.data === "string" && o.data) return { data: o.data, mime: typeof o.mime_type === "string" ? o.mime_type : "" };
  for (const v of Object.values(o)) {
    const hit = findBlock(v, type);
    if (hit) return hit;
  }
  return null;
}

/** Runs one interaction and returns the audio or image it produced. */
export async function generate(req: {
  apiKey: string;
  type: "audio" | "image";
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ ok: true; media: Media } | { ok: false; status: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/interactions`, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": req.apiKey },
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Could not reach Gemini: ${String(e)}` };
  }
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  if (!res.ok) {
    const msg = typeof j?.error === "string" ? j.error : j?.error?.message;
    if (res.status === 400 && /api key/i.test(msg ?? "")) return { ok: false, status: 401, error: "Gemini rejected that API key. Check it and try again." };
    if (res.status === 401 || res.status === 403) return { ok: false, status: 401, error: "Gemini rejected that API key. Check it and try again." };
    return { ok: false, status: res.status === 429 ? 429 : 502, error: msg ?? `Gemini answered ${res.status}.` };
  }
  const media = findBlock(j, req.type);
  if (!media) return { ok: false, status: 502, error: `Gemini returned no ${req.type}.` };
  return { ok: true, media };
}

/** A zero-cost model listing, to check a pasted key. */
export async function geminiKeyWorks(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}
