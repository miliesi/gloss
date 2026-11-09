/**
 * Claude client. Server-side only. The Anthropic SDK, streamed.
 *
 * Things worth knowing, kept on purpose:
 * 1. Sonnet 5.5 thinks by default, and effort is the main dial, so these calls run at
 *    "low" (chat, shelving) or "high" (the brief, which checks a text against
 *    itself). Thinking spends from max_tokens, hence THINKING_ROOM.
 * 2. The text goes first in `system` with a cache breakpoint after it, so a
 *    follow-up question, a brief and a gloss on the same text all read it
 *    from Anthropic's prompt cache. Anything that varies per question comes
 *    after the breakpoint.
 * 3. A tool_use turn goes back with its thinking blocks untouched (`blocks`).
 * 4. `fallbacks: "default"` re-runs a policy refusal on a substitute model
 *    inside the same call, so a paper that trips a classifier still gets a gloss.
 * 5. Sonnet 5.5 rejects non-default temperature and top_p, so there are none here.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODELS, costFor, type ModelEntry, type ModelKey, type StreamEvent, type Usage } from "./models";

export { MODELS, DEFAULT_MODEL, isModelKey, costFor } from "./models";
export type { ModelKey, StreamEvent, Usage } from "./models";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  /** `blocks` is the model's own turn (thinking included), sent back as it came when a tool result follows. */
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; blocks?: unknown[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** A tool the model may call, in the Anthropic shape. */
export type ToolDef = { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] } };

type Effort = "low" | "medium" | "high";
export const BETAS = ["server-side-fallback-2026-07-01"];
/** Added to max_tokens: the model's thinking spends from it before the answer starts. */
export const THINKING_ROOM = 4000;

export const MISSING_KEY = "No Anthropic API key. Set ANTHROPIC_API_KEY, or add your own key.";

/** What went wrong, in words a reader can act on. */
export function describe(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Anthropic rejected that API key. Check it and try again.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is rate limiting this key. Wait a moment, or use your own key.";
  if (e instanceof Anthropic.APIConnectionError) return `Could not reach Anthropic: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Anthropic API ${e.status ?? "error"}: ${e.message}`;
  return String(e);
}

/** A zero-cost model listing, to check a pasted key. */
export async function claudeKeyWorks(apiKey: string): Promise<boolean> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** The chat messages Gloss builds, as a Messages API request: `system` blocks and alternating turns. */
export function toRequest(messages: ChatMessage[]): { system: Anthropic.Beta.BetaTextBlockParam[]; messages: Anthropic.Beta.BetaMessageParam[] } {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [];
  const turns: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      turns.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }] });
    } else if (m.role === "assistant") {
      const content: Anthropic.Beta.BetaContentBlockParam[] = m.blocks
        ? (m.blocks as Anthropic.Beta.BetaContentBlockParam[])
        : [
            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ...(m.tool_calls ?? []).map((c) => ({ type: "tool_use" as const, id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) })),
          ];
      turns.push({ role: "assistant", content });
    } else if (m.role === "system") {
      // The first system message is the text itself: cache everything up to and including it.
      system.push({ type: "text", text: m.content, ...(system.length === 0 ? { cache_control: { type: "ephemeral" as const } } : {}) });
    } else {
      turns.push({ role: "user", content: m.content });
    }
  }
  return { system, messages: turns };
}

function usageOf(key: ModelKey, u: Anthropic.Beta.BetaUsage): Usage {
  const read = u.cache_read_input_tokens ?? 0;
  const written = u.cache_creation_input_tokens ?? 0;
  const prompt = (u.input_tokens ?? 0) + read + written;
  const out = u.output_tokens ?? 0;
  return { promptTokens: prompt, cachedTokens: read, completionTokens: out, costUsd: costFor(key, prompt, read, out, written) };
}

export async function* streamChat(req: {
  messages: ChatMessage[];
  model: ModelKey;
  apiKey?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Tools the model may call; a call ends the stream with a "tool" event instead of an answer. */
  tools?: readonly ToolDef[];
  /** "none" sends the tools (a conversation that already used one needs them) but asks for an answer. */
  toolChoice?: "auto" | "none";
  effort?: Effort;
}): AsyncGenerator<StreamEvent> {
  const model: ModelEntry = MODELS[req.model];
  const apiKey = req.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "error", text: MISSING_KEY };
    return;
  }

  yield { type: "meta", model: model.label };

  const { system, messages } = toRequest(req.messages);
  try {
    const stream = new Anthropic({ apiKey }).beta.messages.stream(
      {
        model: model.id,
        max_tokens: (req.maxTokens ?? 900) + THINKING_ROOM,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: req.effort ?? "low" },
        system,
        messages,
        ...(req.tools ? { tools: [...req.tools], tool_choice: { type: req.toolChoice ?? "auto" } } : {}),
      },
      { signal: req.signal }
    );

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) yield { type: "content", text: ev.delta.text };
    }
    const final = await stream.finalMessage();
    yield { type: "usage", usage: usageOf(req.model, final.usage) };

    const call = final.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (call && final.stop_reason === "tool_use") {
      yield { type: "tool", id: call.id, name: call.name, args: JSON.stringify(call.input ?? {}), blocks: final.content };
      return;
    }
    if (final.stop_reason === "refusal") {
      yield { type: "error", text: "Claude declined to answer this one. Try rephrasing the question." };
      return;
    }
    yield { type: "done" };
  } catch (e) {
    if (req.signal?.aborted) return;
    yield { type: "error", text: describe(e) };
  }
}

/** Non-streaming JSON completion, for structured output like the brief. */
export async function completeJSON<T>(req: {
  messages: ChatMessage[];
  model: ModelKey;
  apiKey?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Think harder before answering, for checking a text against itself. Thinking spends from maxTokens. */
  thinking?: boolean;
}): Promise<{ ok: true; data: T; usage: Usage } | { ok: false; error: string }> {
  const model: ModelEntry = MODELS[req.model];
  const apiKey = req.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: MISSING_KEY };

  const { system, messages } = toRequest(req.messages);
  let final: Anthropic.Beta.BetaMessage;
  try {
    // Streamed and gathered: the brief's budget is large enough that a plain request could time out.
    final = await new Anthropic({ apiKey }).beta.messages
      .stream(
        {
          model: model.id,
          max_tokens: (req.maxTokens ?? 1400) + THINKING_ROOM,
          betas: BETAS,
          fallbacks: "default",
          output_config: { effort: req.thinking ? "high" : "low" },
          system,
          messages,
        },
        { signal: req.signal }
      )
      .finalMessage();
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
  if (final.stop_reason === "refusal") return { ok: false, error: "Claude declined to read this text. Try a different one." };

  const raw = final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as T;
    return { ok: true, data, usage: usageOf(req.model, final.usage) };
  } catch {
    return { ok: false, error: "The model returned something that was not valid JSON. Try again." };
  }
}
