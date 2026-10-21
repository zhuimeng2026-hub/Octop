import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const projectDir = path.resolve(process.argv[2] ?? "test-mini");
const browserExecutable =
  "C:\\Users\\Admin\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe";
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const bundleLocation = await bundle({
  entryPoint: path.join(process.cwd(), "src", "index.ts"),
  publicDir: projectDir,
});
const script = JSON.parse(fs.readFileSync(path.join(projectDir, "script.json"), "utf-8"));
const composition = await selectComposition({
  serveUrl: bundleLocation,
  id: "Video",
  inputProps: { script },
  browserExecutable,
});
log(`composition ${composition.durationInFrames}f`);

log("renderMedia…");
await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: "h264",
  outputLocation: path.join(projectDir, "out", "final.mp4"),
  inputProps: { script },
  crf: 28,
  scale: 0.5,
  overwrite: true,
  browserExecutable,
  concurrency: 2,
  timeoutInMilliseconds: 240000,
  onProgress: (p) => log(`frame ${p.renderedFrames}/${composition.durationInFrames}`),
  onBrowserLog: (l) => log(`browser[${l.type}] ${String(l.text).slice(0, 160)}`),
});
log("done");
