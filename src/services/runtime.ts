import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type RuntimeConfig = {
  host: string;
  port: number;
  threads: number;
  gpuLayers: number;
  ctxSize: number;
  requestTimeoutSec: number;
  autoStart: boolean;
};

export type RuntimeStatus = {
  running: boolean;
  busy: boolean;
  cancelRequested: boolean;
  pid?: number | null;
  lastError?: string | null;
  binaryFound: boolean;
  modelFound: boolean;
  mmprojFound: boolean;
  whisperBinaryFound: boolean;
  whisperModelFound: boolean;
  ffmpegFound: boolean;
};

export type RuntimeBatchRequest = {
  ind: number;
  path: string;
  kind: "image" | "video" | "audio" | "txt" | "fallback";
  videoFrameBase64?: string;
  filenameStyle?: "short" | "average" | "long";
};

export type RuntimeBatchResult = {
  ind: number;
  suggestedName?: string;
  error?: string;
  source: "model" | "fallback" | "skipped";
};

export type RuntimeBatchProgress = {
  processed: number;
  total: number;
  currentPath: string;
  result: RuntimeBatchResult;
};

export type RenameRequest = {
  oldPath: string;
  suggestedName: string;
};

export type RenameResult = {
  oldPath: string;
  newPath?: string | null;
  status: "renamed" | "skipped" | "error";
  error?: string | null;
};

export type RuntimeProbeResult = {
  response: string;
  elapsedMs: number;
};

export type RuntimeHealth = {
  running: boolean;
  busy: boolean;
  responsive: boolean;
  lastError?: string | null;
};

export type FolderEntry = {
  name: string;
  path: string;
  extension: string;
  kind: "image" | "video" | "audio" | "txt" | "fallback";
  filterType: "image" | "video" | "audio" | "text" | "other";
};

export type FolderListing = {
  files: FolderEntry[];
  subfolders: string[];
};

export type ThumbnailResult = {
  path: string;
  dataUrl?: string | null;
};

export const runtimeGetStatus = () => invoke<RuntimeStatus>("runtime_get_status");
export const runtimeGetConfig = () => invoke<RuntimeConfig>("runtime_get_config");
export const runtimeUpdateConfig = (config: RuntimeConfig) => invoke<RuntimeConfig>("runtime_update_config", { config });
export const runtimeStart = () => invoke<RuntimeStatus>("runtime_start");
export const runtimeStop = () => invoke<RuntimeStatus>("runtime_stop");
export const runtimeCancelBatch = () => invoke<RuntimeStatus>("runtime_cancel_batch");
export const runtimeForceStop = () => invoke<RuntimeStatus>("runtime_force_stop");
export const runtimeHealth = () => invoke<RuntimeHealth>("runtime_health");
export const listFolder = (path: string) => invoke<FolderListing>("list_folder", { path });
export const generateThumbnails = (paths: string[]) =>
  invoke<ThumbnailResult[]>("generate_thumbnails", { paths });
export const runtimeGenerateBatch = (requests: RuntimeBatchRequest[]) =>
  invoke<RuntimeBatchResult[]>("runtime_generate_batch", { requests });
export const applyRenames = (requests: RenameRequest[]) => invoke<RenameResult[]>("apply_renames", { requests });
export const runtimeProbe = (prompt?: string) => invoke<RuntimeProbeResult>("runtime_probe", { prompt });

export const onRuntimeBatchProgress = (handler: (payload: RuntimeBatchProgress) => void): Promise<UnlistenFn> =>
  listen<RuntimeBatchProgress>("runtime://batch-progress", (event) => {
    handler(event.payload);
  });
