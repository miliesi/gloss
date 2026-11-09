/** Every outbound URL in one place. */
export const BRAND = {
  name: "Gloss",
  claudeUrl: "https://www.anthropic.com/claude",
  geminiUrl: "https://ai.google.dev/gemini-api",
  keysUrl: "https://platform.claude.com/settings/keys",
  geminiKeysUrl: "https://aistudio.google.com/apikey",
  modelsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
} as const;

/** Sent with Gloss's own fetches of other people's pages. */
export const APP_UA = "Gloss/0.1";


/** The social card. The version busts the caches of X, Slack and LinkedIn, which keep a card image by its URL. */
export const OG_IMAGE = { url: "/og.jpg?v=3", width: 1200, height: 630, alt: "Gloss: highlight any line, ask it anything. Powered by Claude." };

/** The public origin, for canonical, sitemap and social card URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3100");
