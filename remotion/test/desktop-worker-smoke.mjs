/** Run with `node test/desktop-worker-smoke.mjs` for one real low-resolution render. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "octop-desktop-render-smoke-"));
const project = path.join(root, "project");
fs.mkdirSync(path.join(project, "assets"), { recursive: true });
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "src", "index.ts"), "throw new Error('Downloaded project code must never run');\n");
const script = Buffer.from(JSON.stringify({ fps: 1, width: 640, height: 360, scenes: [{ type: "title", duration: 1, text: "Desktop worker smoke" }] }));
fs.writeFileSync(path.join(project, "script.json"), script);
fs.writeFileSync(path.join(project, "manifest.json"), JSON.stringify({
  schema: "octop-remotion-package/1",
  template_version: "1",
  project_id: "desktop-worker-smoke",
  script_sha256: createHash("sha256").update(script).digest("hex"),
  assets: [],
}));
fs.writeFileSync(path.join(root, "runtime.json"), JSON.stringify({ schema: "octop-desktop-video-runtime/1", templateVersion: 1 }));
try {
  const worker = fileURLToPath(new URL("../desktop-worker.mjs", import.meta.url));
  const output = path.join(root, "out", "final.mp4");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, "--project", project, "--out", output], { env: { ...process.env, OCTOP_DESKTOP_VIDEO_RUNTIME: root }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
    // Keep stdin open like the native parent does; worker must exit after completion.
  });
  assert.equal(result.status, 0, result.stderr);
  const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === "stage" && event.stage === "rendering"));
  assert.ok(events.some((event) => event.type === "complete" && event.bytes > 0));
  assert.ok(fs.statSync(output).size > 0);
  console.log(`Rendered ${output} (${fs.statSync(output).size} bytes)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
