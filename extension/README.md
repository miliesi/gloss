# Gloss for Brave and Chrome

Select any line on any page, press **Alt+Shift+G**, and ask Claude about it in a margin beside the text. It uses the same prompts as the Gloss reader (`lib/prompts.ts`): the page is read into numbered paragraphs, answers cite them as [¶n], and clicking a citation scrolls the page to that paragraph.

## Build and load

```bash
npm install
npm run ext:build
```

Then in Brave (or Chrome): open `brave://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/dist` folder. Open the extension's settings, paste an Anthropic API key, and pick a model (Claude Sonnet 5.5 by default). If the shortcut clashes with another, change it at `brave://extensions/shortcuts`.

## How it works

- **On demand only.** The extension has no always-on content script. The toolbar icon, the shortcut and the right-click item (**Gloss this**) inject `content.js` into the current tab using `activeTab`, so Gloss reads a page only when you ask.
- **The key stays in the background worker.** The panel (a shadow-DOM aside, so the page's CSS can't touch it) sends the page text and your question to `background.js` over a port; the worker calls the Anthropic API from there, with the key from `chrome.storage.local`, and streams the answer back. The only host it talks to is `api.anthropic.com`.
- **Same model code as the web app.** `background.js` bundles `lib/claude.ts` and `lib/prompts.ts`, so the prompt cache breakpoint and refusal fallback behave the same.

## Differences from the web app

No web search (so no Fact-check), no highlights, notes or library, and no briefs. It cannot run on `brave://` pages, the Chrome Web Store, or the built-in PDF viewer; the icon shows a `!` badge there.
