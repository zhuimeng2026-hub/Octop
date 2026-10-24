export interface VideoBrief {
  purpose: string;
  audience: string;
  platform: string;
  targetDuration: string;
  style: string;
  sellingPoints: string;
  extra: string;
}

export const EMPTY_VIDEO_BRIEF: VideoBrief = {
  purpose: "",
  audience: "",
  platform: "",
  targetDuration: "",
  style: "",
  sellingPoints: "",
  extra: "",
};

const PREFIX = "OCTOP_VIDEO_BRIEF_V1:";
const MAX_INSTRUCTIONS_LENGTH = 3000;

export function encodeVideoBrief(brief: VideoBrief): string {
  const encoded = `${PREFIX}${JSON.stringify(brief)}`;
  if (encoded.length > MAX_INSTRUCTIONS_LENGTH) {
    throw new Error("Video brief exceeds the instructions limit");
  }
  return encoded;
}

export function decodeVideoBrief(instructions: string): VideoBrief {
  if (!instructions.startsWith(PREFIX)) {
    return { ...EMPTY_VIDEO_BRIEF, extra: instructions };
  }

  try {
    const value: unknown = JSON.parse(instructions.slice(PREFIX.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ...EMPTY_VIDEO_BRIEF, extra: instructions };
    }
    const fields = value as Partial<Record<keyof VideoBrief, unknown>>;
    return {
      purpose: typeof fields.purpose === "string" ? fields.purpose : "",
      audience: typeof fields.audience === "string" ? fields.audience : "",
      platform: typeof fields.platform === "string" ? fields.platform : "",
      targetDuration:
        typeof fields.targetDuration === "string" ? fields.targetDuration : "",
      style: typeof fields.style === "string" ? fields.style : "",
      sellingPoints:
        typeof fields.sellingPoints === "string" ? fields.sellingPoints : "",
      extra: typeof fields.extra === "string" ? fields.extra : "",
    };
  } catch {
    return { ...EMPTY_VIDEO_BRIEF, extra: instructions };
  }
}
