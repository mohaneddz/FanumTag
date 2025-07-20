import {
  FileText, Video, File, Code, Archive, FileSpreadsheet, FileImage, Volume2
} from "lucide-solid";

// This component is now "dumb". It just displays what it's given.
// It has NO internal state, NO effects, and NO async calls.
function FileSystemIcon(props: { fileName: string; thumbnail?: string }) {
  // If a thumbnail URL is provided, display it.
  if (props.thumbnail) {
    return (
      <img
        src={props.thumbnail}
        alt={`${props.fileName} thumbnail`}
        class="w-full h-full object-cover"
      />
    );
  }

  // Otherwise, show the correct fallback icon based on file type.
  const fileType = getFileType(props.fileName);
  const IconComponent = {
    video: Video,
    audio: Volume2,
    code: Code,
    archive: Archive,
    spreadsheet: FileSpreadsheet,
    document: FileText,
    image: FileImage,
    file: File,
  }[fileType] || File;

  return <IconComponent size={16} class="text-primary" />;
}

// Helper functions that are now needed by the dumb FileSystemIcon
function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length > 1 && parts[0] !== "") {
    return parts.pop()?.toLowerCase() || "";
  }
  return "";
}

function getFileType(filename: string): string {
  const ext = getFileExtension(filename);
  const imageExts = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "tiff"];
  if (imageExts.includes(ext)) return "image";
  if (
    ["mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v"].includes(ext)
  )
    return "video";
  if (
    ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a"].includes(ext)
  )
    return "audio";
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "html",
      "css",
      "scss",
      "json",
      "xml",
      "php",
      "py",
      "java",
      "cpp",
      "c",
      "h",
      "cs",
      "go",
      "rs",
      "rb",
      "swift",
      "kt",
      "vue",
      "svelte",
    ].includes(ext)
  )
    return "code";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext))
    return "archive";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "spreadsheet";
  if (["txt", "md", "rtf", "doc", "docx", "pdf"].includes(ext))
    return "document";
  return "file";
}

export const useFileItem = () => {
  // This function now just passes the props down to our new dumb component.
  function getFileIconDisplay(fileName: string, folderPath: string, thumbnail?: string) {
    return (
      <div class="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 overflow-hidden">
        <FileSystemIcon fileName={fileName} thumbnail={thumbnail} />
      </div>
    );
  }

  return {
    getFileExtension,
    getFileType,
    FileSystemIcon,
    getFileIconDisplay,
  };
};