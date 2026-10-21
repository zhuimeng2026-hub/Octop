import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveTheme, type Scene, type VideoScript } from "../types";

/**
 * Shared scene chrome: background, safe-area padding and the fade envelope.
 *
 * Every scene fades in and out over `transition` seconds so cuts never look
 * like a hard glitch.
 */
export const SceneFrame: React.FC<{
  scene: Scene;
  script: VideoScript;
  children: React.ReactNode;
}> = ({ scene, script, children }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = resolveTheme(script);
  const transition = Math.max(0, Math.min(scene.transition ?? 0.4, 2));
  const transitionFrames = Math.round(transition * fps);

  const opacity =
    transitionFrames === 0
      ? 1
      : interpolate(frame, [0, transitionFrames, durationInFrames - transitionFrames, durationInFrames], [
          0,
          1,
          1,
          0,
        ]);

  const shift = interpolate(frame, [0, transitionFrames], [18, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: scene.bg ?? theme.bg,
        color: "#FFFFFF",
        fontFamily: theme.fontFamily,
        opacity,
        transform: `translateY(${shift}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Vertically centred content column with the project safe margins. */
export const Content: React.FC<{
  script: VideoScript;
  align?: "center" | "flex-start";
  padding?: number;
  children: React.ReactNode;
}> = ({ script, align = "center", padding, children }) => {
  const { width, height } = useVideoConfig();
  const theme = resolveTheme(script);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : "flex-start",
        alignItems: align === "center" ? "center" : "flex-start",
        padding: padding ?? Math.round(width * 0.08),
        boxSizing: "border-box",
        gap: Math.round(height * 0.02),
      }}
    >
      {children}
    </div>
  );
};

export const AccentBar: React.FC<{ script: VideoScript; width?: number }> = ({
  script,
  width = 220,
}) => {
  const theme = resolveTheme(script);
  return (
    <div
      style={{
        width,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.accent,
      }}
    />
  );
};
