import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "extension");
const outDir = path.join(extensionDir, "dist");

async function main() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: {
      content: path.join(extensionDir, "src/content.ts"),
      background: path.join(extensionDir, "src/background.ts"),
      options: path.join(extensionDir, "src/options.ts"),
    },
    bundle: true,
    outdir: outDir,
    format: "iife",
    target: "chrome110",
  });

  cpSync(path.join(extensionDir, "manifest.json"), path.join(outDir, "manifest.json"));
  cpSync(path.join(extensionDir, "options.html"), path.join(outDir, "options.html"));

  console.log(`Extension built to ${path.relative(root, outDir)}`);
  console.log('Load it unpacked via chrome://extensions -> "Load unpacked" -> select that folder.');
}

main().catch((error) => {
  console.error("Extension build failed:", error);
  process.exitCode = 1;
});
