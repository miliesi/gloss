/**
 * The model allow-list and wire types. Safe to import on the client: no keys,
 * no fetches. lib/claude.ts does the network side.
 */

export type ModelEntry = {
  id: string;
  label: string;
  short: string;
  blurb: string;
  inPerM: number;
  cachedPerM: number;
  outPerM: number;
};

/**
 * The allow-list. Route and UI both read it. Prices are Claude API list
 * prices per million tokens; a cache write bills at 1.25x the input price.
 * Swap `id` and the prices to move every answer to another Claude model:
 * claude-opus-5-5 ($4 in, $0.20 cached, $20 out) is the more capable choice,
 * claude-haiku-5-5 ($0.10 in, $0.50 out up to 100k tokens) the cheaper, faster one.
 *
 * Older answers and settings may still name "flash" (the Together-era model
 * key); anything that looks a model up goes through modelOf(), which falls
 * back to the default.
 */
export const MODELS = {
  claude: {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    short: "Claude",
    blurb: "Anthropic's Claude. Reads the whole text and cites paragraphs.",
    inPerM: 2,
    cachedPerM: 0.2,
    outPerM: 10,
  },
} as const satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelKey = "claude";

export function isModelKey(v: unknown): v is ModelKey {
  return typeof v === "string" && v in MODELS;
}

/** A model key that is still on the list: a saved "pro" from before Deep was dropped becomes Flash. */
export const modelOf = (v: unknown): ModelKey => (isModelKey(v) ? v : DEFAULT_MODEL);

export type Usage = {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
};

/** Dollars for a run. `prompt` counts every input token; cache reads bill at the cached rate and cache writes at 1.25x. */
export function costFor(key: ModelKey, prompt: number, cached: number, completion: number, written = 0): number {
  const m: ModelEntry = MODELS[key];
  const fresh = Math.max(0, prompt - cached - written);
  return (fresh * m.inPerM + written * m.inPerM * 1.25 + cached * m.cachedPerM + completion * m.outPerM) / 1_000_000;
}

/** A web result an answer can cite as [n]. */
export type Source = { n: number; title: string; url: string; site: string; date?: string };

export type StreamEvent =
  | { type: "meta"; model: string }
  | { type: "searching" }
  /** The model asked for a tool (web search); the route runs it and asks again. Never sent to the browser. */
  | { type: "tool"; id: string; name: string; args: string; blocks?: unknown[] }
  /** Drop what was written so far: a line before a tool call ("I'll look that up") that the real answer replaces. */
  | { type: "reset" }
  | { type: "sources"; sources: Source[] }
  | { type: "content"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" }
  | { type: "error"; text: string };
