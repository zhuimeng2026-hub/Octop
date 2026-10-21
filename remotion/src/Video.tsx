import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SCENE_COMPONENTS } from "./scenes";
import { resolveTheme, sceneDuration, type VideoScript } from "./types";

export interface VideoProps {
  script: VideoScript;
}

/**
 * Renders a script scene by scene.
 *
 * Each scene is placed on its own `<Sequence>`, so scene timing lives in the
 * script rather than in the component tree.
 */
export const Video: React.FC<VideoProps> = ({ script }) => {
  const theme = resolveTheme(script);
  const fps = script.fps ?? 30;
  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {(script.scenes ?? []).map((scene) => {
        const durationInFrames = Math.max(
          1,
          Math.round(sceneDuration(scene) * fps),
        );
        const start = from;
        from += durationInFrames;
        const Component = SCENE_COMPONENTS[scene.type] ?? SCENE_COMPONENTS.text;
        return (
          <Sequence
            key={scene.id ?? `${scene.type}-${start}`}
            from={start}
            durationInFrames={durationInFrames}
            name={scene.id ?? scene.type}
          >
            <Component scene={scene} script={script} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
