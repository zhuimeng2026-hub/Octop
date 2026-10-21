import React from "react";
import { Img, staticFile, Video as RemotionVideo } from "remotion";
import { AccentBar, Content, SceneFrame } from "./SceneFrame";
import { resolveTheme, type Scene, type VideoScript } from "../types";

/** Resolve an asset file name to a URL inside the bundled public directory. */
function assetUrl(asset: string): string {
  return staticFile(`assets/${asset}`);
}

export const TitleScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script}>
        <AccentBar script={script} />
        <h1
          style={{
            margin: 0,
            fontSize: 96,
            lineHeight: 1.15,
            fontWeight: 700,
            textAlign: "center",
            color: theme.primary,
          }}
        >
          {scene.text ?? ""}
        </h1>
        {scene.subtitle ? (
          <p
            style={{
              margin: 0,
              fontSize: 42,
              color: "#D6DEE8",
              textAlign: "center",
            }}
          >
            {scene.subtitle}
          </p>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const TextScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script} align="flex-start" padding={undefined}>
        <div
          style={{
            maxWidth: "82%",
            fontSize: 52,
            lineHeight: 1.6,
            color: "#EDF2F7",
            whiteSpace: "pre-wrap",
          }}
        >
          {scene.text ?? ""}
        </div>
        {scene.subtitle ? (
          <div style={{ fontSize: 34, color: theme.secondary, marginTop: 24 }}>
            {scene.subtitle}
          </div>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const BulletsScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  const bullets = scene.bullets ?? [];
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script} align="flex-start">
        <div style={{ fontSize: 64, fontWeight: 700, color: theme.primary }}>
          {scene.text ?? ""}
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 48,
            fontSize: 46,
            lineHeight: 1.7,
            color: "#EDF2F7",
            maxWidth: "80%",
          }}
        >
          {bullets.map((bullet, index) => (
            <li key={index} style={{ marginBottom: 18 }}>
              <span style={{ color: theme.accent, marginRight: 16 }}>▍</span>
              {bullet}
            </li>
          ))}
        </ul>
        {scene.subtitle ? (
          <div style={{ fontSize: 34, color: theme.secondary }}>{scene.subtitle}</div>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const ImageScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script}>
        {scene.asset ? (
          <Img
            src={assetUrl(scene.asset)}
            style={{
              maxWidth: "82%",
              maxHeight: "70%",
              objectFit: "contain",
              borderRadius: 16,
            }}
          />
        ) : null}
        {scene.caption ? (
          <div style={{ fontSize: 38, color: theme.secondary, marginTop: 28 }}>
            {scene.caption}
          </div>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const VideoClipScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script}>
        {scene.asset ? (
          <RemotionVideo
            src={assetUrl(scene.asset)}
            style={{
              maxWidth: "88%",
              maxHeight: "76%",
              objectFit: "contain",
              borderRadius: 16,
              backgroundColor: "#000000",
            }}
          />
        ) : null}
        {scene.caption ? (
          <div style={{ fontSize: 38, color: theme.secondary, marginTop: 28 }}>
            {scene.caption}
          </div>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const EndCardScene: React.FC<{ scene: Scene; script: VideoScript }> = ({
  scene,
  script,
}) => {
  const theme = resolveTheme(script);
  return (
    <SceneFrame scene={scene} script={script}>
      <Content script={script}>
        <div style={{ fontSize: 88, fontWeight: 700, color: theme.primary }}>
          {scene.text ?? ""}
        </div>
        {scene.subtitle ? (
          <div style={{ fontSize: 40, color: "#D6DEE8" }}>{scene.subtitle}</div>
        ) : null}
      </Content>
    </SceneFrame>
  );
};

export const SCENE_COMPONENTS: Record<
  Scene["type"],
  React.FC<{ scene: Scene; script: VideoScript }>
> = {
  title: TitleScene,
  bullets: BulletsScene,
  image: ImageScene,
  video: VideoClipScene,
  text: TextScene,
  endcard: EndCardScene,
};
