import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/popup.ts", "src/injectedExtract.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome110",
  platform: "browser",
});

cpSync("manifest.json", "dist/manifest.json");
cpSync("popup.html", "dist/popup.html");

console.log("Built extension to dist/ — load that folder as an unpacked extension.");
