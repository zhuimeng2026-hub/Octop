import React from "react";
import { Composition } from "remotion";
import { Video, type VideoProps } from "./Video";
import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  scriptDurationInFrames,
  type VideoScript,
} from "./types";

/** Fallback script — used by `remotion studio` and as the default props. */
export const DEFAULT_SCRIPT: VideoScript = {
  title: "Octop Remotion",
  fps: DEFAULT_FPS,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  scenes: [
    { id: "s1", type: "title", duration: 3, text: "视频标题", subtitle: "副标题" },
    { id: "s2", type: "bullets", duration: 5, text: "要点", bullets: ["第一条", "第二条"] },
    { id: "s3", type: "endcard", duration: 2, text: "完" },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Video"
      component={Video}
      durationInFrames={scriptDurationInFrames(DEFAULT_SCRIPT)}
      fps={DEFAULT_SCRIPT.fps}
      width={DEFAULT_SCRIPT.width}
      height={DEFAULT_SCRIPT.height}
      defaultProps={{ script: DEFAULT_SCRIPT } as VideoProps}
      calculateMetadata={({ props }) => {
        const script = (props as VideoProps).script ?? DEFAULT_SCRIPT;
        return {
          durationInFrames: scriptDurationInFrames(script),
          fps: script.fps ?? DEFAULT_FPS,
          width: script.width ?? DEFAULT_WIDTH,
          height: script.height ?? DEFAULT_HEIGHT,
        };
      }}
    />
  );
};
