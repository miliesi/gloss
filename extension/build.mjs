// Bundles the extension into extension/dist: load that folder unpacked in Brave or Chrome.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: join(here, "src/background.ts"), content: join(here, "src/content.ts"), options: join(here, "src/options.ts") },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  tsconfig: join(here, "../tsconfig.json"),
  logLevel: "info",
});

for (const f of ["manifest.json", "options.html", "icons"]) cpSync(join(here, f), join(out, f), { recursive: true });
console.log("Built extension/dist. In Brave: brave://extensions, turn on Developer mode, Load unpacked, pick that folder.");
