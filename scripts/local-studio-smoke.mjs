// CI-only integration check: real Studio startup and a short MP4, without Octop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { propsDocument, studioArgs } from "../remotion/project.mjs";
import { resolveCliEntry } from "../remotion/launch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "Octop video 中文 "));
let studio;
try {
  fs.mkdirSync(path.join(project, "assets"));
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOIOHL3PwAGagL5TiTrWgAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(project, "assets", "cover.png"), image);
  const script = {
    title: "Local package smoke",
    fps: 30,
    width: 320,
    height: 180,
    scenes: [
      { id: "s1", type: "title", duration: 0.2, text: "Local package" },
      { id: "s2", type: "image", duration: 0.2, asset: "cover.png" },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(script));
  fs.writeFileSync(path.join(project, "script.json"), bytes);
  fs.writeFileSync(path.join(project, "manifest.json"), JSON.stringify({
    schema: "octop-remotion-package/1",
    template_version: "1",
    project_id: "smoke",
    script_sha256: createHash("sha256").update(bytes).digest("hex"),
    assets: [{
      path: "assets/cover.png",
      sha256: createHash("sha256").update(image).digest("hex"),
      bytes: image.length,
    }],
  }));
  const propsPath = path.join(project, "props.json");
  fs.writeFileSync(propsPath, propsDocument(script));
  const plan = studioArgs({
    cliEntry: resolveCliEntry(),
    entryPoint: path.join(root, "remotion", "src", "index.ts"),
    projectDir: project,
    propsPath,
  });
  studio = spawn(plan.command, [...plan.args, "--no-open", "--port=3399"], {
    cwd: path.join(root, "remotion"), stdio: "inherit",
  });
  let studioFailure;
  studio.on("error", (error) => { studioFailure = error; });
  studio.on("exit", (code) => { studioFailure = new Error(`Studio exited: ${code}`); });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (studioFailure) throw studioFailure;
    try {
      const response = await fetch("http://127.0.0.1:3399/Video", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) { ready = true; break; }
    } catch { /* Startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Studio did not become ready within 60 seconds");
  studio.kill("SIGTERM");
  studio = undefined;
  await new Promise((resolve, reject) => {
    const render = spawn(process.execPath, [path.join(root, "remotion", "launch.mjs"),
      "--project", project, "--render"], { cwd: os.tmpdir(), stdio: "inherit" });
    render.on("error", reject);
    render.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Render exited: ${code}`)));
  });
  if (fs.statSync(path.join(project, "out", "final.mp4")).size <= 0) {
    throw new Error("Renderer did not produce an MP4");
  }
  console.log("Studio startup and local MP4 render passed.");
} finally {
  studio?.kill("SIGTERM");
  fs.rmSync(project, { recursive: true, force: true });
}
