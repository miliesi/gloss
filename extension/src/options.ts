/// <reference types="chrome" />
import { DEFAULTS, MODEL_CHOICES, getSettings } from "./shared";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const key = $<HTMLInputElement>("key");
const model = $<HTMLSelectElement>("model");
const length = $<HTMLSelectElement>("length");
const save = $<HTMLButtonElement>("save");
const status = $("status");

model.innerHTML = MODEL_CHOICES.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");

void getSettings().then((s) => {
  key.value = s.apiKey;
  model.value = s.model;
  length.value = s.length;
});

function say(text: string, bad = false) {
  status.textContent = text;
  status.className = bad ? "bad" : "";
}

/** A zero-cost model listing, to check the key before it is kept. */
async function keyWorks(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

save.addEventListener("click", async () => {
  const apiKey = key.value.trim();
  save.disabled = true;
  say("Checking");
  if (apiKey && !(await keyWorks(apiKey))) {
    say("Anthropic rejected that key. Check it and try again.", true);
    save.disabled = false;
    return;
  }
  await chrome.storage.local.set({ apiKey, model: model.value || DEFAULTS.model, length: length.value });
  say(apiKey ? "Saved." : "Saved. Add a key to start asking.");
  save.disabled = false;
});
