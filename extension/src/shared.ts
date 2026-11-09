/// <reference types="chrome" />

import type { Action } from "@/lib/actions";
import type { DocPayload, LengthKey, ThreadPayload } from "@/lib/prompts";

export const MODEL_CHOICES = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (default)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable)" },
] as const;

export type Settings = { apiKey: string; model: string; length: LengthKey };
export const DEFAULTS: Settings = { apiKey: "", model: MODEL_CHOICES[0].id, length: "normal" };

export async function getSettings(): Promise<Settings> {
  // Asking with the defaults fills in whatever was never saved.
  return (await chrome.storage.local.get({ ...DEFAULTS })) as Settings;
}

/** What the page's panel sends the background over a port. */
export type AskRequest = {
  type: "ask";
  doc: DocPayload;
  thread: ThreadPayload;
  /** Turns after the first question: the first answer, then each follow-up and its answer. */
  history: { role: "user" | "assistant"; content: string }[];
};

/** What the background streams back. */
export type PortEvent = { type: "content"; text: string } | { type: "done" } | { type: "need_key" } | { type: "error"; text: string };

export type { Action };
