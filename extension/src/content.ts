/// <reference types="chrome" />
/**
 * The margin: a panel beside the page, in a shadow root so the page's styles
 * cannot reach it. Injected on demand by the background worker. It reads the
 * page into numbered paragraphs (the same [¶n] Gloss uses), takes the reader's
 * selection, and shows the answer as it streams in. Running this script again
 * (the toolbar icon, the shortcut, the right-click item) rebuilds the panel
 * from the page and selection as they are now.
 */

import { ACTIONS, ARTICLE_QUESTIONS, isShortSelection, type Action } from "@/lib/actions";
import type { DocPayload, ThreadPayload } from "@/lib/prompts";
import type { AskRequest, PortEvent } from "./shared";

/** Characters of page text sent with a question, about 40k tokens. */
const MAX_CHARS = 150_000;
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, figcaption";
const SKIP = "nav, header, footer, aside, form, button, [role=navigation], [aria-hidden=true], [hidden], script, style, noscript";

/* ---------------- the page, as numbered paragraphs ---------------- */

type Page = { doc: DocPayload; byNumber: Map<number, Element>; byElement: Map<Element, number> };

function readPage(): Page {
  const root = document.querySelector("article") ?? document.querySelector("main, [role=main]") ?? document.body;
  const paras: { n: number; text: string }[] = [];
  const byNumber = new Map<number, Element>();
  const byElement = new Map<Element, number>();
  let chars = 0;
  let partial = false;
  for (const el of root.querySelectorAll(BLOCKS)) {
    // The innermost blocks only, so a list item holding a paragraph is read once.
    if (el.querySelector(BLOCKS) || el.closest(SKIP)) continue;
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    if (chars + text.length > MAX_CHARS) {
      partial = true;
      break;
    }
    chars += text.length;
    const n = paras.length + 1;
    paras.push({ n, text });
    byNumber.set(n, el);
    byElement.set(el, n);
  }
  const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() || undefined;
  const published = meta('meta[property="article:published_time"]') ?? meta('meta[name="date"]');
  return {
    doc: {
      title: meta('meta[property="og:title"]') ?? document.title ?? location.hostname,
      author: meta('meta[name="author"]'),
      published: published?.slice(0, 10),
      paras,
      ...(partial ? { partial: true } : {}),
    },
    byNumber,
    byElement,
  };
}

/** The paragraph number a node sits in, if the reader's selection touches one. */
function numberAt(page: Page, node: Node | null): number | undefined {
  for (let el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement); el; el = el.parentElement) {
    const n = page.byElement.get(el);
    if (n) return n;
  }
  return undefined;
}

/* ---------------- the panel ---------------- */

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel { --bg: #fbf8f1; --ink: #1f1b16; --ink-2: #4a443a; --ink-3: #7a7164; --rule: #e0d8c8; --sunk: #f1ebdd; --rubric: #a63d2a; --mark: #fbe7a1;
  position: fixed; top: 0; right: 0; bottom: 0; width: min(400px, 100vw); display: flex; flex-direction: column; z-index: 2147483647;
  background: var(--bg); color: var(--ink); border-left: 1px solid var(--rule); box-shadow: -8px 0 32px rgba(0,0,0,.08);
  font: 14.5px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { .panel { --bg: #1b1815; --ink: #efe9dc; --ink-2: #cfc7b6; --ink-3: #a39a8a; --rule: #38322a; --sunk: #26221d; --rubric: #e07a63; --mark: #5c4b12; } }
header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--rule); }
.brand { font: 600 20px/1 Georgia, "Times New Roman", serif; letter-spacing: .01em; }
.x { all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: var(--ink-3); font-size: 20px; line-height: 1; }
.x:hover { background: var(--sunk); color: var(--ink); }
.body { flex: 1; overflow-y: auto; padding: 14px 16px 8px; }
.quote { margin: 0 0 12px; padding: 2px 0 2px 12px; border-left: 2px solid var(--rubric); color: var(--ink-2); font: italic 15px/1.5 Georgia, "Times New Roman", serif; }
.hint { margin: 0 0 12px; color: var(--ink-3); font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.chip { all: unset; cursor: pointer; padding: 5px 11px; border: 1px solid var(--rule); border-radius: 999px; font: 500 12.5px/1.3 ui-sans-serif, system-ui, sans-serif; color: var(--ink-2); }
.chip:hover { border-color: var(--ink-3); color: var(--ink); }
.ask { margin: 14px 0 6px; color: var(--ink-3); font-size: 12.5px; font-style: italic; }
.answer { margin: 0 0 10px; font: 16px/1.6 Georgia, "Times New Roman", serif; }
.answer p { margin: 0 0 10px; } .answer ul { margin: 0 0 10px; padding-left: 20px; }
.answer mark { background: var(--mark); color: inherit; border-radius: 2px; padding: 0 1px; }
.cite { all: unset; cursor: pointer; color: var(--rubric); font: 600 11.5px/1 ui-sans-serif, system-ui, sans-serif; vertical-align: baseline; padding: 0 1px; }
.cite:hover { text-decoration: underline; }
.dots::after { content: "…"; color: var(--ink-3); }
.err { margin: 8px 0; color: var(--rubric); font-size: 13.5px; }
.link { all: unset; cursor: pointer; color: var(--rubric); text-decoration: underline; text-underline-offset: 3px; }
form { display: flex; gap: 8px; padding: 10px 16px 14px; border-top: 1px solid var(--rule); }
input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--rule); border-radius: 8px; background: transparent; color: var(--ink); font: inherit; font-size: 14px; }
input:focus { outline: 2px solid var(--rubric); outline-offset: 1px; }
.send { all: unset; cursor: pointer; height: 36px; padding: 0 14px; border-radius: 8px; background: var(--ink); color: var(--bg); font: 600 13.5px/36px ui-sans-serif, system-ui, sans-serif; }
`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A reply's light Markdown: ==marked== answer, **bold**, - lists, and [¶n] citations that jump to the paragraph. */
function render(text: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[¶(\d+)\]/g, '<button class="cite" data-n="$1" type="button">¶$1</button>');
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      if (lines.length && lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      return `<p>${inline(lines.join(" "))}</p>`;
    })
    .join("");
}

function open() {
  document.getElementById("gloss-extension-host")?.remove();
  const page = readPage();
  const sel = window.getSelection();
  const quote = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, " ").trim().slice(0, 4000) : "";
  const range = quote && sel ? sel.getRangeAt(0) : null;
  const from = range ? numberAt(page, range.startContainer) : undefined;
  const to = range ? numberAt(page, range.endContainer) : undefined;

  const host = document.createElement("div");
  host.id = "gloss-extension-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style>
    <aside class="panel" role="complementary" aria-label="Gloss">
      <header><span class="brand">Gloss</span><button class="x" type="button" aria-label="Close">×</button></header>
      <div class="body"></div>
      <form><input type="text" placeholder="${quote ? "Ask about this…" : "Ask about this page…"}" aria-label="Your question" autocomplete="off" /><button class="send" type="submit">Ask</button></form>
    </aside>`;
  document.documentElement.appendChild(host);

  const body = root.querySelector<HTMLElement>(".body")!;
  const form = root.querySelector("form")!;
  const input = root.querySelector("input")!;
  const close = () => {
    port?.disconnect();
    host.remove();
  };
  root.querySelector(".x")!.addEventListener("click", close);
  root.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Escape" && close());

  // Intro: the selection and what to do with it, or the whole page and a few questions to start from.
  const actions: Action[] = ["explain", isShortSelection(quote) ? "define" : "simplify", "connect", "counter"];
  const intro = document.createElement("div");
  intro.innerHTML = quote
    ? `<blockquote class="quote">${esc(quote.length > 300 ? quote.slice(0, 300) + "…" : quote)}</blockquote><div class="chips">${actions.map((a) => `<button class="chip" type="button" data-action="${a}" title="${esc(ACTIONS[a].hint)}">${ACTIONS[a].label}</button>`).join("")}</div>`
    : `<p class="hint">${page.doc.paras.length ? "Select a line on the page, then press Alt+Shift+G. Or ask about the whole page:" : "This page has no text I can read. Select a line, then open Gloss again."}</p><div class="chips">${ARTICLE_QUESTIONS.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  body.appendChild(intro);

  /* ---- asking ---- */
  let thread: ThreadPayload | null = null;
  let turns: { role: "user" | "assistant"; content: string }[] = [];
  let port: chrome.runtime.Port | null = null;
  let busy = false;

  const scroll = () => (body.scrollTop = body.scrollHeight);

  function ask(request: ThreadPayload, history: typeof turns, label: string) {
    busy = true;
    port?.disconnect();
    if (label) {
      const q = document.createElement("div");
      q.className = "ask";
      q.textContent = label;
      body.appendChild(q);
    }
    const out = document.createElement("div");
    out.className = "answer dots";
    body.appendChild(out);
    scroll();

    let text = "";
    port = chrome.runtime.connect({ name: "gloss" });
    port.onMessage.addListener((ev: PortEvent) => {
      if (ev.type === "content") {
        text += ev.text;
        out.classList.remove("dots");
        out.innerHTML = render(text);
        scroll();
      } else if (ev.type === "done") {
        busy = false;
        out.classList.remove("dots");
        turns = [...history, { role: "assistant", content: text }];
        port?.disconnect();
      } else {
        busy = false;
        out.remove();
        const err = document.createElement("div");
        err.className = "err";
        if (ev.type === "need_key") {
          err.innerHTML = 'Add your Anthropic API key to start. <button class="link" type="button">Open settings</button>';
          err.querySelector("button")!.addEventListener("click", () => chrome.runtime.sendMessage({ type: "options" }));
        } else err.textContent = ev.text;
        body.appendChild(err);
        scroll();
        port?.disconnect();
      }
    });
    const msg: AskRequest = { type: "ask", doc: page.doc, thread: request, history };
    port.postMessage(msg);
  }

  /** The first question of a thread: a one-click action on the selection, a typed question, or a question about the page. */
  function start(action: Action, question?: string, label = "") {
    thread = { action, quote: quote || undefined, from, to, question };
    turns = [];
    ask(thread, [], label);
  }

  intro.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action], [data-q]");
    if (!el || busy) return;
    if (el.dataset.action) {
      const a = el.dataset.action as Action;
      intro.querySelector(".chips")?.remove();
      start(a, undefined, ACTIONS[a].label);
    } else if (el.dataset.q) {
      intro.querySelector(".chips")?.remove();
      start("ask", el.dataset.q, el.dataset.q);
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = "";
    intro.querySelector(".chips")?.remove();
    if (!thread || turns.length === 0) start("ask", q, q);
    else ask(thread, [...turns, { role: "user", content: q }], q);
  });

  // [¶n] in an answer: scroll the page to that paragraph and mark it for a moment.
  body.addEventListener("click", (e) => {
    const cite = (e.target as HTMLElement).closest<HTMLElement>(".cite");
    const el = cite && page.byNumber.get(Number(cite.dataset.n));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const html = el as HTMLElement;
    const old = html.style.cssText;
    html.style.cssText += ";outline:2px solid #a63d2a;outline-offset:3px;transition:outline-color .6s";
    setTimeout(() => (html.style.cssText = old), 1800);
  });

  input.focus();
}

open();
