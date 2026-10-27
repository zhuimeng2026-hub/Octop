/** Verify the staged Windows component runtime with no host Node/npm or browser on PATH. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("This smoke check requires a staged Windows component runtime");
const runtime = path.resolve(fileURLToPath(new URL("../../desktop/src/video-runtime", import.meta.url)));
const node = path.join(runtime, "node.exe");
const browser = path.join(runtime, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
assert.ok(fs.statSync(node).size > 0, "bundled Node executable is missing");
assert.ok(fs.statSync(browser).size > 0, "bundled Remotion headless shell is missing");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "octop-components-smoke-"));
const emptyProfile = path.join(root, "empty-profile");
const cache = path.join(root, "cache");
const project = path.join(root, "project");
fs.mkdirSync(emptyProfile);
fs.mkdirSync(path.join(project, "assets"), { recursive: true });
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "src", "index.ts"), "throw new Error('untrusted project source must not run');\n");
const script = Buffer.from(JSON.stringify({ fps: 1, width: 640, height: 360, scenes: [{ type: "title", duration: 1, text: "Bundled browser smoke" }] }));
fs.writeFileSync(path.join(project, "script.json"), script);
fs.writeFileSync(path.join(project, "manifest.json"), JSON.stringify({
  schema: "octop-remotion-package/1", template_version: "1", project_id: "component-smoke",
  script_sha256: createHash("sha256").update(script).digest("hex"), assets: [],
}));

function run(args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: "", LOCALAPPDATA: emptyProfile, ProgramFiles: emptyProfile, "ProgramFiles(x86)": emptyProfile, OCTOP_DESKTOP_VIDEO_RUNTIME: runtime, OCTOP_DESKTOP_VIDEO_CACHE: cache };
    delete env.REMOTION_BROWSER_EXECUTABLE;
    const child = spawn(node, [path.join(runtime, "desktop-worker.mjs"), ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
    // Keep stdin open to exercise the native parent's long-lived pipe behavior.
  });
}

try {
  const firstCheck = await run(["--check", "--cache", cache]);
  assert.equal(firstCheck.status, 0, firstCheck.stderr);
  assert.equal(JSON.parse(firstCheck.stdout.trim().split(/\r?\n/).at(-1)).state, "needs_setup");

  const verify = await run(["--verify", "--cache", cache]);
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout.trim().split(/\r?\n/).at(-1)).state, "ready");

  const check = await run(["--check", "--cache", cache]);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout.trim().split(/\r?\n/).at(-1)).state, "ready");

  const output = path.join(root, "out", "final.mp4");
  const render = await run(["--project", project, "--out", output]);
  assert.equal(render.status, 0, render.stderr);
  const complete = render.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)).find((event) => event.type === "complete");
  assert.ok(complete?.bytes > 0);
  console.log(`Bundled runtime/browser rendered ${complete.bytes} bytes with host PATH empty and no host browser.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
