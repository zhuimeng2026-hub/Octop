import { describe, expect, it } from "vitest";
import { decodeVideoBrief, encodeVideoBrief, type VideoBrief } from "./brief";

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
