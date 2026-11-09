/// <reference types="chrome" />
/**
 * The service worker: opens Gloss on the current tab (toolbar icon, shortcut
 * or right-click) and answers questions. The page's panel never sees the key;
 * it sends the text and the question over a port and gets the answer back.
 */

import Anthropic from "@anthropic-ai/sdk";
import { BETAS, THINKING_ROOM, describe, toRequest } from "@/lib/claude";
import { buildMessages } from "@/lib/prompts";
import { getSettings, type AskRequest, type PortEvent } from "./shared";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "gloss", title: "Gloss this", contexts: ["selection", "page"] });
});

/** Injected on demand, so Gloss reads a page only when asked. Running the script again just reopens the panel. */
async function open(tab?: chrome.tabs.Tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    // Pages the browser keeps closed to extensions (brave://, the web store, the PDF viewer).
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id!, text: "" }), 2500);
  }
}

chrome.action.onClicked.addListener(open);
chrome.contextMenus.onClicked.addListener((_info, tab) => void open(tab));
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "options") void chrome.runtime.openOptionsPage();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "gloss") return;
  const ctrl = new AbortController();
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
    ctrl.abort();
  });
  const send = (e: PortEvent) => open && port.postMessage(e);
  port.onMessage.addListener((msg: AskRequest) => {
    if (msg?.type === "ask") void answer(msg, send, ctrl.signal);
  });
});

async function answer(req: AskRequest, send: (e: PortEvent) => void, signal: AbortSignal) {
  const { apiKey, model, length } = await getSettings();
  if (!apiKey) return send({ type: "need_key" });
  const { system, messages } = toRequest(buildMessages(req.doc, req.thread, req.history, length));
  try {
    const stream = new Anthropic({ apiKey, dangerouslyAllowBrowser: true }).beta.messages.stream(
      {
        model,
        max_tokens: (length === "long" ? 1400 : 900) + THINKING_ROOM,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages,
      },
      { signal }
    );
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) send({ type: "content", text: ev.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") return send({ type: "error", text: "Claude declined to answer this one. Try rephrasing the question." });
    send({ type: "done" });
  } catch (e) {
    if (!signal.aborted) send({ type: "error", text: describe(e) });
  }
}
