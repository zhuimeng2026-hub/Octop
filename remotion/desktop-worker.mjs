#!/usr/bin/env node
/** Trusted desktop worker. Project data is validated and never imported/executed. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validatePackage } from "./project.mjs";
import { renderProject } from "./render.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function args(argv) {
  const result = { project: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") result.project = argv[++i];
    else if (argv[i] === "--out") result.out = argv[++i];
    else throw new Error("invalid worker arguments");
  }
  if (!result.project || !result.out) throw new Error("--project and --out are required");
  return result;
}

async function main() {
  let code = "RENDER_FAILED";
  try {
    const runtimeDir = process.env.OCTOP_DESKTOP_VIDEO_RUNTIME ? path.resolve(process.env.OCTOP_DESKTOP_VIDEO_RUNTIME) : ROOT;
    let runtime;
    try { runtime = JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime.json"), "utf8")); }
    catch { code = "RUNTIME_UNAVAILABLE"; throw new Error("trusted runtime metadata is unavailable"); }
    if (runtime.schema !== "octop-desktop-video-runtime/1" || runtime.templateVersion !== 1) {
      code = "RUNTIME_UNAVAILABLE";
      throw new Error("unsupported trusted runtime");
    }
    const { project, out } = args(process.argv.slice(2));
    const abort = new AbortController();
    const onInput = (chunk) => {
      if (String(chunk).split(/\r?\n/).includes("cancel")) abort.abort();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onInput);
    process.stdin.resume();
    try {
      if (abort.signal.aborted) throw Object.assign(new Error("render cancelled"), { name: "AbortError" });
      let data;
      try { data = validatePackage(project); }
      catch (error) { code = "PACKAGE_INVALID"; throw error; }
      // Renderer diagnostics are private stderr; stdout is reserved for JSONL.
      const log = console.log;
      console.log = (...values) => process.stderr.write(`${values.join(" ")}\n`);
      try {
      emit({ type: "stage", stage: "preparing" });
      const result = await renderProject({
        projectDir: data.root,
        outPath: path.resolve(out),
        trustedTemplate: true,
        onStage: (stage) => emit({ type: "stage", stage }),
        onProgress: ({ stage, progress }) => {
          if (stage === "rendering") emit({ type: "progress", progress: Math.max(0, Math.min(1, progress)) });
        },
        cancelSignal: abort.signal,
      });
      emit({ type: "stage", stage: "saving" });
      const stat = fs.statSync(result.output);
      if (!stat.isFile() || stat.size <= 0) throw new Error("renderer produced an empty output");
      emit({ type: "complete", output: result.output, bytes: stat.size, duration: result.duration });
      } finally {
        console.log = log;
      }
    } finally {
      process.stdin.removeListener("data", onInput);
      process.stdin.pause();
    }
  } catch (error) {
    const cancelled = error?.name === "AbortError" || /cancel/i.test(error?.message ?? "");
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    emit({ type: "error", code: cancelled ? "CANCELLED" : code });
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
