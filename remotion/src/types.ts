/**
 * The contract between the LLM and the renderer.
 *
 * A "script" is the single artefact the model produces: a JSON file that
 * fully describes the video (scenes, timing, assets, palette). The renderer
 * never invents content — it only turns this file into frames.
 */

export type SceneType =
  | "title"
  | "bullets"
  | "image"
  | "video"
  | "text"
  | "endcard";

export interface Theme {
  /** Background colour of the whole video. */
  bg?: string;
  /** Primary accent (headings, highlights). */
  primary?: string;
  /** Secondary accent (sub-headings, body emphasis). */
  secondary?: string;
  /** Highlight colour (numbers, keywords). */
  accent?: string;
  /** Font family used for all text. */
  fontFamily?: string;
}

export interface Scene {
  /** Stable id, unique inside one script. */
  id: string;
  type: SceneType;
  /** Duration in seconds (fractional allowed). */
  duration: number;
  /** Main text (title / paragraph / endcard line). */
  text?: string;
  /** Secondary line under the main text. */
  subtitle?: string;
  /** Bullet list — `bullets` scene type. */
  bullets?: string[];
  /** File name inside the assets directory (image / video scenes). */
  asset?: string;
  /** Caption burned into the lower third (image / video scenes). */
  caption?: string;
  /** Per-scene background override. */
  bg?: string;
  /** Seconds the scene fades in / out. Default 0.4. */
  transition?: number;
}

export interface VideoScript {
  title: string;
  fps?: number;
  width?: number;
  height?: number;
  theme?: Theme;
  scenes: Scene[];
}

export const DEFAULT_FPS = 30;
export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;

export const DEFAULT_THEME: Required<Theme> = {
  bg: "#0F1117",
  primary: "#58C4DD",
  secondary: "#83C167",
  accent: "#FFD93D",
  fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif",
};

export function resolveTheme(script: VideoScript): Required<Theme> {
  return { ...DEFAULT_THEME, ...(script.theme ?? {}) };
}

/** Total duration of a script in seconds. */
export function scriptDurationSeconds(script: VideoScript): number {
  return (script.scenes ?? []).reduce((sum, scene) => sum + sceneDuration(scene), 0);
}

/** Duration of one scene in seconds, with a sane floor. */
export function sceneDuration(scene: Scene): number {
  const value = Number(scene.duration);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

/** Total duration of a script in frames. */
export function scriptDurationInFrames(script: VideoScript): number {
  const fps = script.fps ?? DEFAULT_FPS;
  return Math.max(1, Math.round(scriptDurationSeconds(script) * fps));
}
