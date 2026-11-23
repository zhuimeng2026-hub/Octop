import type { ImportEntry } from "../../api/modules/productLibrary";
import { MAX_IMPORT_FILE_BYTES } from "./importFiles";

const MAX_OUTPUT_BYTES = MAX_IMPORT_FILE_BYTES;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function detectImageType(bytes: Uint8Array): {
  mime: string;
  animated: boolean;
} {
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { mime: "image/gif", animated: true };
  }
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        4,
      ).getUint32(0);
      const type = ascii(bytes, offset + 4, 4);
      if (type === "acTL") return { mime: "image/png", animated: true };
      if (type === "IDAT") return { mime: "image/png", animated: false };
      offset += 12 + length;
    }
    throw new Error("unsupported image format");
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const length = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset + 4,
        4,
      ).getUint32(0, true);
      if (type === "ANIM") return { mime: "image/webp", animated: true };
      if (type === "VP8X") {
        if (offset + 9 > bytes.length)
          throw new Error("unsupported image format");
        return {
          mime: "image/webp",
          animated: (bytes[offset + 8] & 0x02) !== 0,
        };
      }
      if (type === "VP8 " || type === "VP8L")
        return { mime: "image/webp", animated: false };
      offset += 8 + length + (length % 2);
    }
    throw new Error("unsupported image format");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", animated: false };
  }
  throw new Error("unsupported image format");
}

async function detectImage(
  file: File,
): Promise<{ mime: string; animated: boolean }> {
  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer(),
  );
  return detectImageType(header);
}

function outputName(name: string, type: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem}-compressed.${
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"
  }`;
}

/** Compress one still image locally in a module Web Worker. */
export async function compressImportImage(file: File): Promise<File> {
  const detected = await detectImage(file);
  if (detected.animated) throw new Error("animated image");
  if (typeof Worker !== "function") throw new Error("compression unavailable");
  const worker = new Worker(
    new URL("./importCompression.worker.ts", import.meta.url),
    { type: "module" },
  );
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<{ blob?: Blob; error?: string }>,
      ) => {
        if (event.data.blob) resolve(event.data.blob);
        else reject(new Error(event.data.error || "compression failed"));
      };
      worker.onerror = () => reject(new Error("compression unavailable"));
      worker.postMessage({
        file,
        maxBytes: MAX_OUTPUT_BYTES,
        mime: detected.mime,
      });
    });
    return new File([blob], outputName(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } finally {
    worker.terminate();
  }
}

export function compressedEntryPath(entry: ImportEntry, file: File): string {
  const slash = entry.path.lastIndexOf("/");
  return `${slash >= 0 ? entry.path.slice(0, slash + 1) : ""}${file.name}`;
}
