import { describe, expect, it } from "vitest";
import {
  decodeVideoBrief,
  encodeVideoBrief,
  joinPlatforms,
  splitPlatforms,
  type VideoBrief,
} from "./brief";

describe("video brief encoding", () => {
  it("round-trips all business fields through the bounded instructions field", () => {
    const brief: VideoBrief = {
      purpose: "launch",
      audience: "new customers",
      platform: "Shorts",
      targetDuration: "30",
      style: "natural",
      sellingPoints: "Verified fact",
      extra: "Keep the packaging visible",
    };

    expect(decodeVideoBrief(encodeVideoBrief(brief))).toEqual(brief);
  });

  it("keeps legacy unstructured instructions as supplemental notes", () => {
    expect(decodeVideoBrief("Old storyboard note")).toMatchObject({
      platform: "",
      extra: "Old storyboard note",
    });
  });

  it("rejects an oversized brief instead of truncating its structure", () => {
    expect(() =>
      encodeVideoBrief({
        purpose: "",
        audience: "",
        platform: "",
        targetDuration: "",
        style: "",
        sellingPoints: "",
        extra: "x".repeat(3000),
      }),
    ).toThrow("Video brief exceeds the instructions limit");
  });
});

describe("platform selection helpers", () => {
  it("joins multiple platforms into one readable string", () => {
    expect(joinPlatforms(["抖音", "小红书"])).toBe("抖音、小红书");
    expect(joinPlatforms([" 抖音 ", ""])).toBe("抖音");
    expect(joinPlatforms([])).toBe("");
  });

  it("splits stored values back into selections, including legacy separators", () => {
    expect(splitPlatforms("抖音、小红书")).toEqual(["抖音", "小红书"]);
    expect(splitPlatforms("抖音, 小红书")).toEqual(["抖音", "小红书"]);
    expect(splitPlatforms("抖音/Instagram")).toEqual(["抖音", "Instagram"]);
    expect(splitPlatforms("")).toEqual([]);
  });

  it("round-trips a multi-platform selection through the brief envelope", () => {
    const brief: VideoBrief = {
      purpose: "launch",
      audience: "",
      platform: joinPlatforms(["抖音", "视频号", "TikTok"]),
      targetDuration: "",
      style: "",
      sellingPoints: "",
      extra: "",
    };
    const restored = decodeVideoBrief(encodeVideoBrief(brief));
    expect(restored.platform).toBe("抖音、视频号、TikTok");
    expect(splitPlatforms(restored.platform)).toEqual([
      "抖音",
      "视频号",
      "TikTok",
    ]);
  });
});
