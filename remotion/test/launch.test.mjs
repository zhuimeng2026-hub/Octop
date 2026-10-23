import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { installState, parseArgs } from "../launch.mjs";
import { hashFile, propsDocument, studioArgs, validatePackage } from "../project.mjs";

const LAUNCH = fileURLToPath(new URL("../launch.mjs", import.meta.url));

const hash = (data) => createHash("sha256").update(data).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Octop 本机 Studio "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "assets"));
  const scriptBytes = Buffer.from(JSON.stringify({ title: "Demo", fps: 30, width: 1920, height: 1080, scenes: [{ id: "a", type: "image", duration: 2, asset: "cover.png" }] }));
  const assetBytes = Buffer.from("image data");
  fs.writeFileSync(path.join(root, "script.json"), scriptBytes);
  fs.writeFileSync(path.join(root, "assets", "cover.png"), assetBytes);
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ schema: "octop-remotion-package/1", template_version: "1", project_id: "demo", script_sha256: hash(scriptBytes), assets: [{ path: "assets/cover.png", sha256: hash(assetBytes), bytes: assetBytes.length }] }));
  return root;
}

test("validates package independently of cwd and accepts Unicode/space paths", (t) => {
  const root = fixture(t);
  const oldCwd = process.cwd();
  process.chdir(os.tmpdir());
  try { assert.equal(validatePackage(root).root, root); } finally { process.chdir(oldCwd); }
  assert.equal(parseArgs(["--project", root]).project, root);
});

test("Studio plan uses absolute entry point, wrapped props file and public directory", () => {
  const args = studioArgs({ cliEntry: "/renderer/bin/remotion.js", entryPoint: "/renderer/src/index.ts", projectDir: "/project with space", propsPath: "/tmp/props file.json" });
  assert.equal(args.command, process.execPath);
  assert.deepEqual(args.args, ["/renderer/bin/remotion.js", "studio", "/renderer/src/index.ts", "--props=/tmp/props file.json", `--public-dir=${path.join("/project with space", "assets")}`, "--force-new"]);
  assert.deepEqual(JSON.parse(propsDocument({ scenes: [] })), { script: { scenes: [] } });
});

test("rejects traversal, missing files, and manifest hash mismatches", (t) => {
  const root = fixture(t);
  const scriptPath = path.join(root, "script.json");
  const manifestPath = path.join(root, "manifest.json");
  const originalScript = fs.readFileSync(scriptPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(scriptPath, JSON.stringify({ scenes: [{ type: "image", duration: 1, asset: "../outside.png" }] }));
  assert.throws(() => validatePackage(root), /asset must be a basename/);
  fs.writeFileSync(scriptPath, originalScript);
  manifest.script_sha256 = "0".repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validatePackage(root), /SHA-256 does not match manifest/);
  manifest.script_sha256 = hash(originalScript);
  manifest.assets[0].sha256 = "0".repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validatePackage(root), /Asset hash or size/);
  fs.unlinkSync(path.join(root, "assets", "cover.png"));
  assert.throws(() => validatePackage(root), /asset is missing/);
});

test("rejects unsupported scene type and invalid canvas values", (t) => {
  const root = fixture(t);
  const scriptPath = path.join(root, "script.json");
  const setScript = (script) => {
    const bytes = Buffer.from(JSON.stringify(script));
    fs.writeFileSync(scriptPath, bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    manifest.script_sha256 = hash(bytes);
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
  };
  setScript({ width: 0, scenes: [{ type: "image", duration: 1, asset: "cover.png" }] });
  assert.throws(() => validatePackage(root), /script.width/);
  setScript({ scenes: [{ type: "unknown", duration: 1 }] });
  assert.throws(() => validatePackage(root), /unsupported type/);
});

test("requires assets for image and video scenes", (t) => {
  const root = fixture(t);
  const scriptPath = path.join(root, "script.json");
  const original = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  original.scenes[0].asset = undefined;
  const bytes = Buffer.from(JSON.stringify(original));
  fs.writeFileSync(scriptPath, bytes);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.script_sha256 = hash(bytes);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validatePackage(root), /image\) requires an asset/);
});

test("rejects symlinked assets whose real path escapes assets", (t) => {
  const root = fixture(t);
  const assetPath = path.join(root, "assets", "cover.png");
  const outside = path.join(path.dirname(root), "external-cover.png");
  fs.writeFileSync(outside, "external bytes");
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.unlinkSync(assetPath);
  try { fs.symlinkSync(outside, assetPath); } catch { t.skip("symlink creation is unavailable"); return; }
  assert.throws(() => validatePackage(root), /resolves outside assets/);
});

test("hashes large assets in bounded chunks", (t) => {
  const root = fixture(t);
  const large = path.join(root, "large.bin");
  const content = Buffer.alloc(3 * 1024 * 1024 + 17, 42);
  fs.writeFileSync(large, content);
  assert.deepEqual(hashFile(large), { bytes: content.length, sha256: hash(content) });
});

test("npm ci marker follows lockfile hash and requires an installed CLI bin", (t) => {
  const renderer = fs.mkdtempSync(path.join(os.tmpdir(), "Octop renderer "));
  t.after(() => fs.rmSync(renderer, { recursive: true, force: true }));
  fs.writeFileSync(path.join(renderer, "package-lock.json"), "lock-v1");
  const cliDir = path.join(renderer, "node_modules", "@remotion", "cli");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, "package.json"), JSON.stringify({ name: "@remotion/cli", bin: { remotion: "cli.js" } }));
  fs.writeFileSync(path.join(cliDir, "cli.js"), "");
  const state = installState(renderer);
  assert.equal(state.npmInstall, true);
  fs.writeFileSync(state.markerPath, JSON.stringify({ lock_sha256: state.lockHash }));
  assert.equal(installState(renderer).npmInstall, false);
  fs.writeFileSync(path.join(renderer, "package-lock.json"), "lock-v2");
  assert.equal(installState(renderer).npmInstall, true);
});

test("dry-run option is parsed without enabling render", () => {
  assert.deepEqual(parseArgs(["--dry-run"]), { project: path.resolve(fileURLToPath(new URL("../..", import.meta.url))), render: false, dryRun: true, quality: null });
});

test("dry-run validates and prints a plan without installing or starting Studio", (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [LAUNCH, "--project", root, "--dry-run"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"mode": "preview"/);
  assert.match(result.stdout, /"npmInstall": (true|false)/);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});
