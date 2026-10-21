import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Chromium is downloaded by Remotion itself; keep it inside the project so
// the renderer stays self-contained on the machine that renders.
Config.setChromiumOpenGlRenderer("angle");
