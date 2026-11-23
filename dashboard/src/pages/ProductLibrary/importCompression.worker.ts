const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 8192;

self.onmessage = async (
  event: MessageEvent<{ file: File; maxBytes: number; mime: string }>,
) => {
  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("compression unavailable");
    }
    const bitmap = await createImageBitmap(event.data.file, {
      imageOrientation: "from-image",
    });
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) {
        throw new Error("image dimensions are too large");
      }
      const preserveAlpha = event.data.mime === "image/png";
      const type = preserveAlpha
        ? "image/png"
        : event.data.mime === "image/webp"
        ? "image/webp"
        : "image/jpeg";
      const scale = Math.min(
        1,
        MAX_DIMENSION / bitmap.width,
        MAX_DIMENSION / bitmap.height,
      );
      let width = Math.max(1, Math.floor(bitmap.width * scale));
      let height = Math.max(1, Math.floor(bitmap.height * scale));
      const qualities = preserveAlpha ? [undefined] : [0.9, 0.82, 0.74, 0.66];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        for (const quality of qualities) {
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("compression unavailable");
          context.clearRect(0, 0, width, height);
          context.drawImage(bitmap, 0, 0, width, height);
          const blob = await canvas.convertToBlob({ type, quality });
          if (blob.size <= event.data.maxBytes) {
            self.postMessage({ blob });
            return;
          }
        }
        width = Math.max(1, Math.floor(width * 0.8));
        height = Math.max(1, Math.floor(height * 0.8));
      }
      throw new Error("image could not be reduced below the upload limit");
    } finally {
      bitmap.close();
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "compression failed",
    });
  }
};
