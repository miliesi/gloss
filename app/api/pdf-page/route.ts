import { chargeFree, checkFree, needKey } from "@/lib/quota";
import Anthropic from "@anthropic-ai/sdk";
import { describe, MISSING_KEY } from "@/lib/claude";
import { MODELS, costFor } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * One PDF page the text layer cannot give us (a scan, an image of text, garbled
 * glyphs), read by Claude's vision into Markdown.
 *
 * mode "layout": a page whose text layer reads but whose layout came out
 * badly (columns, tables, maths), read again in the background
 * (lib/upgrade.ts). A page is a sharp, bounded job, so it runs at low effort.
 */
const MODEL = MODELS.claude;
const MAX_IMAGE_CHARS = 3_500_000;

const PROMPT = `Transcribe this document page into clean Markdown, in reading order.
- Multiple columns: the whole left column first, then the next.
- Keep each paragraph whole on one line; join words hyphenated across line breaks.
- # and ## for headings, - for list items, Markdown tables for tables.
- Leave out page numbers, running headers and footers.
- For a picture or chart, write its caption only, if it has one. Never write image links.
- Write only what is on the page. No commentary, no code fences around the whole.`;

const LAYOUT_PROMPT = `${PROMPT}
- Maths as LaTeX between $ signs, inline, or $$ on its own line for a displayed equation.
- Keep equation numbers such as (3) beside their equation.`;

/** Reasoning some models print into the answer, and fences some wrap it in. */
function clean(md: string): string {
  let t = md.replace(/<think>[\s\S]*?<\/think>/g, "");
  if (t.includes("</think>")) t = t.slice(t.lastIndexOf("</think>") + 8);
  return t
    .replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1")
    // Author marks written as LaTeX ($^{1,2}$, $^{\dagger}$) read better as plain text.
    .replace(/\$\^\{?([^}$]{1,24})\}?\$/g, (_, m: string) => m.replace(/\\dagger/g, "†").replace(/\\ddagger/g, "‡").replace(/\\ast|\*/g, "\\*"))
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "")
    .trim();
}

export async function POST(req: Request) {
  let body: { image?: string; apiKey?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const image = body.image ?? "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return Response.json({ error: "Send the page as an image." }, { status: 400 });
  if (image.length > MAX_IMAGE_CHARS) return Response.json({ error: "That page image is too large." }, { status: 413 });

  const headerKey = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const own = body.apiKey?.trim() || headerKey || undefined;
  let free: Awaited<ReturnType<typeof checkFree>> | null = null;
  if (!own) {
    if (!process.env.ANTHROPIC_API_KEY) return needKey(null);
    free = await checkFree(req, 90);
    if (!free.ok) return needKey(free);
  }

  const layout = body.mode === "layout";
  const [, mediaType, data] = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s) ?? [];
  const apiKey = own ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: MISSING_KEY }, { status: 401 });

  let message: Anthropic.Message;
  try {
    message = await new Anthropic({ apiKey }).messages.stream(
      {
        model: MODEL.id,
        max_tokens: 12_000, // thinking spends from this before the page starts
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data } },
              { type: "text", text: layout ? LAYOUT_PROMPT : PROMPT },
            ],
          },
        ],
      },
      { signal: req.signal }
    ).finalMessage();
  } catch (e) {
    const status = e instanceof Anthropic.AuthenticationError ? 401 : e instanceof Anthropic.RateLimitError ? 429 : 502;
    return Response.json({ error: describe(e) }, { status });
  }
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  if (free) {
    const u = message.usage;
    const read = u.cache_read_input_tokens ?? 0;
    const written = u.cache_creation_input_tokens ?? 0;
    const prompt = (u.input_tokens ?? 0) + read + written;
    await chargeFree(free.subject, costFor("claude", prompt || 1900, read, u.output_tokens || 1000, written));
  }
  return Response.json({ markdown: clean(text) });
}
