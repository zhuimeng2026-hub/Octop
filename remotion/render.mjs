#!/usr/bin/env node
/**
 * Local renderer: script.json (+ assets) → mp4.
 *
 * Usage:
 *   node render.mjs --project <dir> [--out <file.mp4>] [--quality draft|prod]
 *
 * <dir> must contain:
 *   script.json      the script produced by the LLM
 *   assets/          images / base videos referenced by the script
 *
 * The Remotion project itself (this directory) provides the components; the
 * project folder only carries data, so a script produced on a remote server
 * can be rendered here without shipping any code.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.join(HERE, "src", "index.ts");
const LOCAL_NODE_MODULES = path.join(HERE, "node_modules");

/**
 * Find a Chromium to render with.
 *
 * Remotion downloads its own headless shell, but that download can be
 * unusably slow on some networks. A locally installed Chrome/Chromium
 * (Playwright's, or the system one) works just as well and is preferred.
 */
function detectBrowser() {
  const explicit = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const pwRoot = path.join(localAppData, "ms-playwright");
    if (fs.existsSync(pwRoot)) {
      for (const dir of fs.readdirSync(pwRoot).sort().reverse()) {
        const exe = path.join(pwRoot, dir, "chrome-win64", "chrome.exe");
        if (fs.existsSync(exe)) return exe;
        const mac = path.join(pwRoot, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
        if (fs.existsSync(mac)) return mac;
        const linux = path.join(pwRoot, dir, "chrome-linux", "chrome");
        if (fs.existsSync(linux)) return linux;
      }
    }
    for (const candidate of [
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function parseArgs(argv) {
  const args = { project: null, out: null, quality: "prod", scale: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--project" || arg === "-p") args.project = next();
    else if (arg === "--out" || arg === "-o") args.out = next();
    else if (arg === "--quality" || arg === "-q") args.quality = next();
    else if (arg === "--scale") args.scale = Number(next());
  }
  return args;
}

/** Minimal validation — the renderer must fail loudly, not render garbage. */
function validateScript(script, projectDir) {
  if (!script || typeof script !== "object") {
    throw new Error("script.json must contain a JSON object");
  }
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error("script.json has no scenes");
  }
  const missing = [];
  for (const [index, scene] of script.scenes.entries()) {
    if (!scene || typeof scene !== "object") {
      throw new Error(`scene #${index} is not an object`);
    }
    if (!scene.type) throw new Error(`scene #${index} has no "type"`);
    if (!(Number(scene.duration) > 0)) {
      throw new Error(`scene #${index} ("${scene.id ?? scene.type}") has no positive duration`);
    }
    if (scene.asset) {
      const assetPath = path.join(projectDir, "assets", scene.asset);
      if (!fs.existsSync(assetPath)) missing.push(scene.asset);
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing asset file(s): ${missing.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("usage: node render.mjs --project <dir> [--out file.mp4] [--quality draft|prod]");
    process.exit(2);
  }
  const projectDir = path.resolve(args.project);
  const scriptPath = path.join(projectDir, "script.json");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`script.json not found in ${projectDir}`);
  }
  const script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  validateScript(script, projectDir);

  const outPath = path.resolve(
    args.out ?? path.join(projectDir, "out", "final.mp4"),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const draft = args.quality === "draft";
  const scale = args.scale ?? (draft ? 0.5 : 1);

  console.log(`[render] script: ${scriptPath}`);
  console.log(`[render] scenes: ${script.scenes.length}`);
  console.log(`[render] output: ${outPath} (${draft ? "draft" : "prod"}, scale ${scale})`);

  const browserExecutable = detectBrowser();
  if (browserExecutable) {
    console.log(`[render] browser: ${browserExecutable}`);
  } else {
    console.log("[render] ensuring chromium (downloading Remotion's shell)…");
    await ensureBrowser({
      onBrowserDownload: () => ({
        version: null,
        onProgress: ({ alreadyAvailable, percent }) => {
          if (alreadyAvailable) return;
          if (percent % 20 === 0) console.log(`[render] downloading chromium ${percent}%`);
        },
      }),
    });
  }

  console.log("[render] bundling…");
  // A job may ship its own Remotion project (server-generated components);
  // otherwise the local project provides the components and the job only
  // carries data (script.json + assets).
  const jobEntry = path.join(projectDir, "src", "index.ts");
  const entryPoint = fs.existsSync(jobEntry) ? jobEntry : ENTRY_POINT;
  const jobPublic = path.join(projectDir, "public");
  const publicDir = fs.existsSync(jobPublic) ? jobPublic : projectDir;
  console.log(`[render] entry: ${entryPoint}`);
  console.log(`[render] public: ${publicDir}`);

  // Resolve react/remotion from the local install even when the job carries
  // its own project files (the downloaded folder has no node_modules).
  const webpackOverride = (config) => {
    const modules = config.resolve?.modules;
    return {
      ...config,
      resolve: {
        ...config.resolve,
        modules: Array.isArray(modules)
          ? [LOCAL_NODE_MODULES, ...modules]
          : [LOCAL_NODE_MODULES, "node_modules"],
      },
    };
  };

  const bundleLocation = await bundle({
    entryPoint,
    publicDir,
    webpackOverride,
    onProgress: (progress) => {
      if (progress % 25 === 0) console.log(`[render] bundling ${progress}%`);
    },
  });
  console.log(`[render] bundle: ${bundleLocation}`);

  const inputProps = { script };
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "Video",
    inputProps,
    // Without this, selectComposition triggers a Chrome Headless Shell
    // download from storage.googleapis.com, which hangs on networks that
    // cannot reach it. Reuse the browser detected above.
    browserExecutable,
  });
  console.log(
    `[render] composition: ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames`,
  );

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    crf: draft ? 28 : 18,
    scale,
    overwrite: true,
    browserExecutable: browserExecutable ?? null,
    timeoutInMilliseconds: 600000,
    onProgress: ({ renderedFrames }) => {
      if (renderedFrames % 30 === 0) {
        console.log(`[render] frame ${renderedFrames}/${composition.durationInFrames}`);
      }
    },
  });

  const size = fs.statSync(outPath).size;
  console.log(`[render] done: ${outPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(JSON.stringify({ ok: true, output: outPath, bytes: size }));
}

main().catch((err) => {
  console.error(`[render] failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
