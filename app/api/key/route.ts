import { claudeKeyWorks } from "@/lib/claude";
import { geminiKeyWorks } from "@/lib/gemini";
import { peekFree } from "@/lib/quota";

export const runtime = "nodejs";

/** Validates a pasted key with a zero-cost model listing. The key is never stored or logged. */
export async function POST(req: Request) {
  let body: { apiKey?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const key = body.apiKey?.trim();
  if (!key) return Response.json({ ok: false });
  return Response.json({ ok: body.provider === "gemini" ? await geminiKeyWorks(key) : await claudeKeyWorks(key) });
}

/** Whether there is a shared key, and how much of today's free allowance is left on it. */
export async function GET(req: Request) {
  const house = Boolean(process.env.ANTHROPIC_API_KEY);
  return Response.json({ house, free: house ? await peekFree(req) : null });
}
