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

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}
