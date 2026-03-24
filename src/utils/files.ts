import { readFile } from "@tauri-apps/plugin-fs";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".avi", ".mov", ".mkv", ".webm", ".wmv", ".flv", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma", ".opus"]);
const TEXT_EXTENSIONS = new Set([".txt"]);

export type FileKind = "image" | "video" | "audio" | "txt" | "fallback";
export type FileFilterType = "image" | "video" | "audio" | "text" | "other";

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx).toLowerCase();
}

export function getFileKind(fileName: string): FileKind {
  const ext = getExtension(fileName);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (TEXT_EXTENSIONS.has(ext)) return "txt";
  return "fallback";
}

export function getFilterType(fileName: string): FileFilterType {
  const kind = getFileKind(fileName);
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "txt") return "text";
  return "other";
}

export function getFilePath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, "")}/${name}`;
}

export async function generateThumbnail(filePath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(filePath);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);

    return await new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const width = 160;
        const height = 96;
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          resolve(undefined);
          return;
        }

        const scale = Math.max(width / img.width, height / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/webp", 0.9));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };

      img.src = url;
    });
  } catch {
    return undefined;
  }
}

export async function extractVideoFrameBase64(filePath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(filePath);
    const blob = new Blob([bytes], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    const base64 = await new Promise<string | undefined>((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        video.pause();
        video.removeAttribute("src");
        video.load();
        resolve(value);
      };

      video.preload = "metadata";
      video.muted = true;
      video.src = url;

      video.onloadedmetadata = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          finish(undefined);
          return;
        }

        video.currentTime = Math.max(0, video.duration / 2);
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 800;
        canvas.height = video.videoHeight || 450;

        const context = canvas.getContext("2d");
        if (!context) {
          finish(undefined);
          return;
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const comma = dataUrl.indexOf(",");
        finish(comma >= 0 ? dataUrl.slice(comma + 1) : undefined);
      };

      video.onerror = () => {
        finish(undefined);
      };
    });

    URL.revokeObjectURL(url);
    return base64;
  } catch {
    return undefined;
  }
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}
