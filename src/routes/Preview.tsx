import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { desktopDir, documentDir, downloadDir, homeDir, pictureDir, videoDir } from "@tauri-apps/api/path";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  File,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Image,
  LoaderCircle,
  Mic,
  Play,
  RefreshCw,
  Search,
  Square,
  Timer,
  Video,
  X,
} from "lucide-solid";

import Toast from "@/components/Toast";
import {
  applyRenames,
  onRuntimeBatchProgress,
  runtimeCancelBatch,
  runtimeGenerateBatch,
  runtimeStart,
  type RuntimeBatchProgress,
  type RuntimeBatchRequest,
  type RuntimeBatchResult,
} from "@/services/runtime";
import {
  fileNameFromPath,
  generateThumbnail,
  getExtension,
  getFileKind,
  getFilePath,
  getFilterType,
  type FileFilterType,
  type FileKind,
} from "@/utils/files";

type WorkspaceFile = {
  index: number;
  name: string;
  path: string;
  extension: string;
  kind: FileKind;
  filterType: FileFilterType;
  thumbnail?: string;
};

type NavItem = {
  label: string;
  path: string;
  icon: typeof Folder;
};

type PreviewStateSnapshot = {
  folderPath: string;
  files: WorkspaceFile[];
  searchTerm: string;
  typeFilter: "all" | FileFilterType;
  filenameStyle: "short" | "average" | "long";
  currentPage: number;
  selectedRows: number[];
  activeBatchRows: number[];
  results: [number, RuntimeBatchResult][];
  progress: { processed: number; total: number; currentPath?: string } | null;
  batchStartedAt: number | null;
  lastRunSummary: {
    processed: number;
    total: number;
    modelCount: number;
    fallbackCount: number;
    skippedCount: number;
    elapsedMs: number;
    cancelled: boolean;
  } | null;
  quickAccess: NavItem[];
  subfolders: string[];
};

let previewStateCache: PreviewStateSnapshot | null = null;

const ITEMS_PER_PAGE = 16;
const PROGRESS_SEGMENT_COUNT = 34;

function iconForFilterType(type: FileFilterType) {
  if (type === "image") return Image;
  if (type === "video") return Video;
  if (type === "audio") return Mic;
  if (type === "text") return FileText;
  return File;
}

function normalizeFolderQuery(input: string | string[] | undefined): string {
  if (!input) return "";
  return Array.isArray(input) ? input[0] ?? "" : input;
}

export default function Preview() {
  const cached = previewStateCache;
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);
  const [folderPath, setFolderPath] = createSignal(cached?.folderPath ?? "");
  const [files, setFiles] = createSignal<WorkspaceFile[]>(cached?.files ?? []);
  const [searchTerm, setSearchTerm] = createSignal(cached?.searchTerm ?? "");
  const [typeFilter, setTypeFilter] = createSignal<"all" | FileFilterType>(cached?.typeFilter ?? "all");
  const [filenameStyle, setFilenameStyle] = createSignal<"short" | "average" | "long">(cached?.filenameStyle ?? "average");
  const [currentPage, setCurrentPage] = createSignal(cached?.currentPage ?? 1);
  const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set<number>(cached?.selectedRows ?? []));
  const [activeBatchRows, setActiveBatchRows] = createSignal<Set<number>>(new Set<number>(cached?.activeBatchRows ?? []));
  const [results, setResults] = createSignal<Map<number, RuntimeBatchResult>>(new Map(cached?.results ?? []));
  const [progress, setProgress] = createSignal<{ processed: number; total: number; currentPath?: string } | null>(cached?.progress ?? null);
  const [batchStartedAt, setBatchStartedAt] = createSignal<number | null>(cached?.batchStartedAt ?? null);
  const [lastRunSummary, setLastRunSummary] = createSignal<{
    processed: number;
    total: number;
    modelCount: number;
    fallbackCount: number;
    skippedCount: number;
    elapsedMs: number;
    cancelled: boolean;
  } | null>(cached?.lastRunSummary ?? null);
  const [quickAccess, setQuickAccess] = createSignal<NavItem[]>(cached?.quickAccess ?? []);
  const [subfolders, setSubfolders] = createSignal<string[]>(cached?.subfolders ?? []);
  const [toast, setToast] = createSignal<{ message: string; variant: "success" | "error" | "warning" | "info" } | null>(null);
  let activeFolderLoadId = 0;

  const statusText = createMemo(() => {
    if (loading()) return "Loading files";
    if (generating()) return "Generating suggestions";
    if (files().length === 0) return "Empty";
    return "Ready";
  });

  const counts = createMemo(() => {
    const base = { image: 0, video: 0, audio: 0, text: 0, other: 0 };
    for (const item of files()) {
      base[item.filterType] += 1;
    }
    return base;
  });

  const filtered = createMemo(() => {
    let next = files();
    const term = searchTerm().trim().toLowerCase();

    if (term) {
      next = next.filter((item) => {
        return (
          item.name.toLowerCase().includes(term) ||
          item.extension.toLowerCase().includes(term) ||
          item.filterType.toLowerCase().includes(term)
        );
      });
    }

    const filter = typeFilter();
    if (filter !== "all") {
      next = next.filter((item) => item.filterType === filter);
    }

    return next;
  });

  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / ITEMS_PER_PAGE)));
  const paginated = createMemo(() => {
    const start = (currentPage() - 1) * ITEMS_PER_PAGE;
    return filtered().slice(start, start + ITEMS_PER_PAGE);
  });

  const processedCount = createMemo(() => {
    let total = 0;
    for (const result of results().values()) {
      if (result.suggestedName) total += 1;
    }
    return total;
  });

  const readyCount = createMemo(() => {
    let total = 0;
    for (const index of selectedRows()) {
      const result = results().get(index);
      if (result?.suggestedName) total += 1;
    }
    return total;
  });

  const visibleSelection = createMemo(() => {
    const active = selectedRows();
    return paginated().filter((item) => active.has(item.index)).length;
  });

  const selectedSorted = createMemo(() => Array.from(selectedRows()).sort((a, b) => a - b));

  const selectedReadyCount = createMemo(() => {
    let total = 0;
    for (const index of selectedRows()) {
      if (results().get(index)?.suggestedName) total += 1;
    }
    return total;
  });

  const selectedPendingCount = createMemo(() => Math.max(0, selectedRows().size - selectedReadyCount()));
  const allFilteredSelected = createMemo(() => {
    const rows = filtered();
    if (rows.length === 0) return false;
    const selected = selectedRows();
    return rows.every((row) => selected.has(row.index));
  });

  const currentProgressPercent = createMemo(() => {
    const current = progress();
    if (!current) return 0;
    return Math.round((current.processed / Math.max(current.total, 1)) * 100);
  });

  const overallProgressPercent = createMemo(() => {
    const total = files().length;
    if (total === 0) return 0;
    return Math.round((processedCount() / total) * 100);
  });
  const overallProgressRatio = createMemo(() => {
    const total = files().length;
    if (total === 0) return 0;
    return processedCount() / total;
  });
  const activeProgressRatio = createMemo(() => {
    if (progress()) {
      return progress()!.processed / Math.max(progress()!.total, 1);
    }
    const totalSelected = selectedRows().size;
    if (totalSelected === 0) return 0;
    return selectedReadyCount() / totalSelected;
  });
  const activeProgressPercent = createMemo(() => Math.round(activeProgressRatio() * 100));

  const activeCurrentFileName = createMemo(() => {
    const current = progress()?.currentPath;
    if (!current) return "";
    return fileNameFromPath(current);
  });

  const canGenerate = createMemo(() => !loading() && !generating() && selectedRows().size > 0);
  const canApply = createMemo(() => !generating() && selectedReadyCount() > 0);

  const setFolderQuery = (path: string) => {
    navigate(`/?folder=${encodeURIComponent(path)}`, { replace: true });
  };

  const loadQuickAccess = async () => {
    const settled = await Promise.allSettled([
      desktopDir(),
      documentDir(),
      downloadDir(),
      pictureDir(),
      videoDir(),
      homeDir(),
    ]);

    const candidates: NavItem[] = [
      { label: "Desktop", path: settled[0].status === "fulfilled" ? settled[0].value : "", icon: Folder },
      { label: "Documents", path: settled[1].status === "fulfilled" ? settled[1].value : "", icon: Folder },
      { label: "Downloads", path: settled[2].status === "fulfilled" ? settled[2].value : "", icon: HardDrive },
      { label: "Pictures", path: settled[3].status === "fulfilled" ? settled[3].value : "", icon: Image },
      { label: "Videos", path: settled[4].status === "fulfilled" ? settled[4].value : "", icon: Video },
      { label: "Home", path: settled[5].status === "fulfilled" ? settled[5].value : "", icon: FolderOpen },
    ].filter((item) => item.path);

    const deduped = new Map<string, NavItem>();
    for (const item of candidates) {
      deduped.set(item.path.toLowerCase(), item);
    }

    setQuickAccess(Array.from(deduped.values()));
  };

  const loadSubfolders = async (path: string) => {
    if (!path) {
      setSubfolders([]);
      return;
    }

    try {
      const entries = await readDir(path);
      const folders = entries
        .filter((entry) => entry.isDirectory && entry.name)
        .map((entry) => getFilePath(path, entry.name!))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 80);
      setSubfolders(folders);
    } catch {
      setSubfolders([]);
    }
  };

  const loadFolder = async (path: string) => {
    if (!path) {
      setFiles([]);
      return;
    }

    const loadId = ++activeFolderLoadId;
    setLoading(true);

    try {
      const entries = await readDir(path);
      const filesOnly = entries
        .filter((entry) => !entry.isDirectory && entry.name)
        .map((entry) => entry.name as string)
        .sort((a, b) => a.localeCompare(b));

      const rows: WorkspaceFile[] = filesOnly.map((name, index) => {
        const filePath = getFilePath(path, name);
        return {
          index,
          name,
          path: filePath,
          extension: getExtension(name),
          kind: getFileKind(name),
          filterType: getFilterType(name),
        };
      });

      await Promise.all(
        rows.map(async (row) => {
          if (row.kind !== "image") return;
          row.thumbnail = await generateThumbnail(row.path);
        })
      );

      if (loadId !== activeFolderLoadId) {
        return;
      }

      setFiles(rows);
      setSelectedRows(new Set<number>());
      setResults(new Map());
      setProgress(null);
      setCurrentPage(1);
      await loadSubfolders(path);
    } catch (error) {
      if (loadId !== activeFolderLoadId) {
        return;
      }

      setToast({
        message: `Could not read folder: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
      setFiles([]);
    } finally {
      if (loadId === activeFolderLoadId) {
        setLoading(false);
      }
    }
  };

  const pickFolder = async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Select Folder",
    });

    if (typeof selected === "string") {
      setFolderQuery(selected);
    }
  };

  const refreshCurrentFolder = async () => {
    const path = folderPath();
    if (!path) {
      setToast({ message: "Choose a folder first.", variant: "warning" });
      return;
    }

    await loadFolder(path);
    setToast({ message: "Folder refreshed.", variant: "info" });
  };

  const toggleRow = (index: number, force?: boolean) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      const shouldSelect = force ?? !next.has(index);
      if (shouldSelect) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const selectAllVisible = () => {
    const page = paginated();
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const row of page) next.add(row.index);
      return next;
    });
  };

  const selectReadyVisible = () => {
    const readyOnly = new Set<number>();
    for (const row of filtered()) {
      if (results().get(row.index)?.suggestedName) {
        readyOnly.add(row.index);
      }
    }
    setSelectedRows(readyOnly);
  };

  const invertVisibleSelection = () => {
    const page = paginated();
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const row of page) {
        if (next.has(row.index)) next.delete(row.index);
        else next.add(row.index);
      }
      return next;
    });
  };

  const keepOnlyReadySelected = () => {
    setSelectedRows((prev) => {
      const next = new Set<number>();
      for (const index of prev) {
        if (results().get(index)?.suggestedName) next.add(index);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const rows = filtered();
    if (rows.length === 0) return;

    if (allFilteredSelected()) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const row of rows) next.delete(row.index);
        return next;
      });
      return;
    }

    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const row of rows) next.add(row.index);
      return next;
    });
  };

  const runGeneration = async () => {
    if (selectedRows().size === 0) {
      setToast({ message: "Select at least one file first.", variant: "warning" });
      return;
    }

    try {
      await runtimeStart();
    } catch {
      // runtime_generate_batch still reports exact error if start failed
    }

    const selected = Array.from(selectedRows()).sort((a, b) => a - b);
    const fileMap = new Map(files().map((item) => [item.index, item]));
    const activeSet = new Set<number>(selected);

    setGenerating(true);
    setBatchStartedAt(Date.now());
    setLastRunSummary(null);
    setActiveBatchRows(activeSet);
    setProgress({ processed: 0, total: selected.length });
    setResults((prev) => {
      const next = new Map(prev);
      for (const index of selected) {
        next.delete(index);
      }
      return next;
    });

    try {
      const requests = await Promise.all(
        selected.map(async (index) => {
          const item = fileMap.get(index)!;
          const payload: RuntimeBatchRequest = {
            ind: index,
            path: item.path,
            kind: item.kind,
            filenameStyle: filenameStyle(),
          };

          return payload;
        })
      );

      const finalResults = await runtimeGenerateBatch(requests);
      setResults((prev) => {
        const next = new Map(prev);
        for (const result of finalResults) {
          next.set(result.ind, result);
        }
        return next;
      });
      const skippedIndices = finalResults
        .filter((result) => result.source === "skipped")
        .map((result) => result.ind);
      if (skippedIndices.length > 0) {
        setSelectedRows((prev) => {
          const next = new Set(prev);
          for (const index of skippedIndices) {
            next.delete(index);
          }
          return next;
        });
      }

      const modelCount = finalResults.filter((result) => result.source === "model").length;
      const fallbackCount = finalResults.filter((result) => result.source === "fallback").length;
      const skippedCount = finalResults.filter((result) => result.source === "skipped").length;
      const elapsedMs = batchStartedAt() ? Date.now() - batchStartedAt()! : 0;
      const cancelled = finalResults.length < selected.length;

      setLastRunSummary({
        processed: finalResults.length,
        total: selected.length,
        modelCount,
        fallbackCount,
        skippedCount,
        elapsedMs,
        cancelled,
      });

      if (cancelled) {
        setToast({
          message: `Generation stopped at ${finalResults.length}/${selected.length}.`,
          variant: "info",
        });
      } else if (skippedCount > 0) {
        setToast({
          message: `Completed ${selected.length} files (${skippedCount} skipped).`,
          variant: "warning",
        });
      } else {
        setToast({
          message: `Completed ${selected.length} files (${modelCount} model, ${fallbackCount} fallback).`,
          variant: "success",
        });
      }
    } catch (error) {
      setToast({
        message: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setGenerating(false);
      setActiveBatchRows(new Set<number>());
      setProgress(null);
      setBatchStartedAt(null);
    }
  };

  const stopGeneration = async () => {
    try {
      await runtimeCancelBatch();
      setToast({ message: "Cancel requested. Current batch will stop safely.", variant: "info" });
    } catch (error) {
      setToast({
        message: `Failed to send cancel request: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  };

  const applyChanges = async () => {
    const selected = Array.from(selectedRows());
    if (selected.length === 0) {
      setToast({ message: "No selected rows to apply.", variant: "warning" });
      return;
    }

    const requests = selected
      .map((index) => {
        const item = files().find((f) => f.index === index);
        const result = results().get(index);
        if (!item || !result?.suggestedName) return null;

        return {
          oldPath: item.path,
          suggestedName: result.suggestedName,
        };
      })
      .filter((item): item is { oldPath: string; suggestedName: string } => Boolean(item));

    if (requests.length === 0) {
      setToast({ message: "Selected rows do not have generated names yet.", variant: "warning" });
      return;
    }

    try {
      const renamed = await applyRenames(requests);
      const renamedCount = renamed.filter((item) => item.status === "renamed").length;
      const skippedCount = renamed.filter((item) => item.status === "skipped").length;
      const errorCount = renamed.filter((item) => item.status === "error").length;

      setToast({
        message: `Renamed ${renamedCount}, skipped ${skippedCount}, errors ${errorCount}.`,
        variant: errorCount > 0 ? "warning" : "success",
      });
      const renamedByPath = new Map(renamed.map((item) => [item.oldPath.toLowerCase(), item]));
      const fileSnapshot = files();
      const finalizedIndices = new Set<number>();
      const errorByIndex = new Map<number, string>();

      for (const row of fileSnapshot) {
        const renameResult = renamedByPath.get(row.path.toLowerCase());
        if (!renameResult) continue;
        if (renameResult.status === "renamed") {
          finalizedIndices.add(row.index);
        } else if (renameResult.status === "skipped") {
          finalizedIndices.add(row.index);
        } else if (renameResult.status === "error" && renameResult.error) {
          errorByIndex.set(row.index, renameResult.error);
        }
      }

      setFiles((prev) => {
        return prev.map((row) => {
          const key = row.path.toLowerCase();
          const renameResult = renamedByPath.get(key);
          if (!renameResult || renameResult.status !== "renamed" || !renameResult.newPath) {
            return row;
          }

          const nextPath = renameResult.newPath;
          const nextName = fileNameFromPath(nextPath);
          return {
            ...row,
            path: nextPath,
            name: nextName,
            extension: getExtension(nextName),
            kind: getFileKind(nextName),
            filterType: getFilterType(nextName),
          };
        });
      });

      setResults((prev) => {
        const next = new Map(prev);
        for (const [rowIndex, result] of prev.entries()) {
          if (finalizedIndices.has(rowIndex)) {
            next.delete(rowIndex);
          } else if (errorByIndex.has(rowIndex)) {
            next.set(rowIndex, {
              ...result,
              error: errorByIndex.get(rowIndex) ?? result.error,
            });
          }
        }
        return next;
      });

      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const index of finalizedIndices) {
          next.delete(index);
        }
        return next;
      });
    } catch (error) {
      setToast({
        message: `Failed to apply rename operations: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  };

  createEffect(() => {
    const folder = normalizeFolderQuery(location.query.folder);
    if (!folder) {
      if (folderPath()) return;
      setFolderPath("");
      setFiles([]);
      setSelectedRows(new Set<number>());
      setResults(new Map());
      setProgress(null);
      return;
    }

    if (folder === folderPath()) return;

    setFolderPath(folder);
    void loadFolder(folder);
  });

  createEffect(() => {
    const page = currentPage();
    const max = totalPages();
    if (page > max) {
      setCurrentPage(max);
    }
  });

  createEffect(() => {
    searchTerm();
    typeFilter();
    setCurrentPage(1);
  });

  onMount(() => {
    if (quickAccess().length === 0) {
      void loadQuickAccess();
    }

    const initial = normalizeFolderQuery(location.query.folder);
    if (initial && initial !== folderPath()) {
      setFolderPath(initial);
      void loadFolder(initial);
    }

    let cleanup: (() => void) | undefined;

    void onRuntimeBatchProgress((payload: RuntimeBatchProgress) => {
      if (!generating()) return;
      if (!activeBatchRows().has(payload.result.ind)) return;
      setProgress({
        processed: payload.processed,
        total: payload.total,
        currentPath: payload.currentPath,
      });
      setResults((prev) => {
        const next = new Map(prev);
        next.set(payload.result.ind, payload.result);
        return next;
      });
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    onCleanup(() => {
      cleanup?.();
    });
  });

  onCleanup(() => {
    previewStateCache = {
      folderPath: folderPath(),
      files: files(),
      searchTerm: searchTerm(),
      typeFilter: typeFilter(),
      filenameStyle: filenameStyle(),
      currentPage: currentPage(),
      selectedRows: Array.from(selectedRows()),
      activeBatchRows: Array.from(activeBatchRows()),
      results: Array.from(results().entries()),
      progress: progress(),
      batchStartedAt: batchStartedAt(),
      lastRunSummary: lastRunSummary(),
      quickAccess: quickAccess(),
      subfolders: subfolders(),
    };
  });

  return (
    <section class="h-full overflow-auto xl:overflow-hidden p-3 md:p-4">
      {toast() && <Toast message={toast()!.message} variant={toast()!.variant} onClose={() => setToast(null)} />}

      <div class="h-full min-h-full grid grid-cols-1 xl:grid-cols-[240px_1fr] 2xl:grid-cols-[250px_1fr_320px] gap-3 items-start xl:items-stretch">
        <aside class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-3 flex flex-col gap-3 min-h-0 xl:h-full grain-surface">
          <div class="grid grid-cols-[1fr_40px] gap-2">
            <button
              class="h-10 rounded-lg border border-pink-300/45 bg-pink-400/15 text-pink-100 text-sm font-medium hover:bg-pink-400/25 flex items-center justify-center gap-2"
              onClick={() => void pickFolder()}
            >
              <FolderOpen size={15} /> Select Folder
            </button>
            <button
              class="h-10 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-50"
              onClick={() => void refreshCurrentFolder()}
              disabled={!folderPath() || loading() || generating()}
              title="Refresh current folder"
            >
              <RefreshCw size={15} class="mx-auto" />
            </button>
          </div>

          <div class="space-y-1 min-h-0">
            <div class="text-[11px] uppercase tracking-[0.18em] text-slate-400">Quick Access</div>
            <div class="max-h-36 sm:max-h-44 xl:max-h-56 overflow-auto space-y-1 pr-1">
              {quickAccess().map((item) => {
                const Icon = item.icon;
                const active = folderPath().toLowerCase() === item.path.toLowerCase();
                return (
                  <button
                    class={`w-full h-8 px-2 rounded-md border text-xs flex items-center gap-2 transition ${
                      active
                        ? "border-pink-300/50 bg-pink-400/15 text-pink-100"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                    }`}
                    onClick={() => setFolderQuery(item.path)}
                  >
                    <Icon size={12} />
                    <span class="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div class="space-y-1 min-h-0">
            <div class="text-[11px] uppercase tracking-[0.18em] text-slate-400">Subfolders</div>
            <div class="max-h-36 sm:max-h-44 xl:max-h-56 overflow-auto space-y-1 pr-1">
              {subfolders().length === 0 && <div class="text-xs text-slate-500 px-1 py-2">No subfolders</div>}
              {subfolders().map((path) => {
                const label = fileNameFromPath(path);
                const active = folderPath().toLowerCase() === path.toLowerCase();
                return (
                  <button
                    class={`w-full h-8 px-2 rounded-md border text-xs flex items-center gap-2 transition ${
                      active
                        ? "border-pink-300/50 bg-pink-400/15 text-pink-100"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                    }`}
                    onClick={() => setFolderQuery(path)}
                  >
                    <Folder size={12} />
                    <span class="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div class="mt-2 xl:mt-auto rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs space-y-1">
            <div class="flex justify-between"><span class="text-slate-400">Processed</span><strong>{processedCount()} / {files().length}</strong></div>
            <div class="flex justify-between"><span class="text-slate-400">Ready to Apply</span><strong>{readyCount()}</strong></div>
            <div class="flex justify-between"><span class="text-slate-400">Selected</span><strong>{selectedRows().size}</strong></div>
            <div class="seg-progress-wrap mt-2">
              <div class="seg-progress-track">
                {Array.from({ length: PROGRESS_SEGMENT_COUNT }).map((_, index) => (
                  <span class={`seg-progress-block ${index < Math.round(overallProgressRatio() * PROGRESS_SEGMENT_COUNT) ? "is-filled" : ""}`} />
                ))}
              </div>
              <div class="seg-progress-percent">{overallProgressPercent()}%</div>
            </div>
            <div class="text-[11px] text-slate-400">Overall completion</div>
          </div>
        </aside>

        <main class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-3 flex flex-col min-h-[380px] xl:min-h-0 xl:h-full grain-surface">
          <header class="grid grid-cols-1 lg:grid-cols-[1fr_240px_180px_220px] gap-2 mb-2">
            <div class="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 flex items-center gap-2 text-sm text-slate-300 min-w-0">
              <Folder size={14} class="shrink-0" />
              <span class="truncate font-mono text-xs">{folderPath() || "No folder selected"}</span>
            </div>

            <div class="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 flex items-center gap-2">
              <Search size={14} class="text-slate-400" />
              <input
                class="w-full bg-transparent border-0 outline-none text-sm"
                value={searchTerm()}
                onInput={(e) => setSearchTerm(e.currentTarget.value)}
                placeholder="Search files"
              />
            </div>

            <select
              class="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm outline-none"
              value={filenameStyle()}
              onChange={(e) => setFilenameStyle(e.currentTarget.value as "short" | "average" | "long")}
              title="Generated filename detail level"
            >
              <option value="short">Names: Short</option>
              <option value="average">Names: Average</option>
              <option value="long">Names: Long</option>
            </select>

            <select
              class="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm outline-none"
              value={typeFilter()}
              onChange={(e) => setTypeFilter(e.currentTarget.value as "all" | FileFilterType)}
            >
              <option value="all">All ({files().length})</option>
              <option value="image">Images ({counts().image})</option>
              <option value="video">Videos ({counts().video})</option>
              <option value="audio">Audio ({counts().audio})</option>
              <option value="text">Text ({counts().text})</option>
              <option value="other">Other ({counts().other})</option>
            </select>
          </header>

          <div class="min-h-0 flex-1 overflow-auto space-y-2 pr-1">
            {loading() && <div class="text-sm text-slate-400 p-4">Loading folder files...</div>}
            {!loading() && folderPath() === "" && (
              <div class="text-sm text-slate-400 p-6 text-center rounded-xl border border-dashed border-white/10 bg-white/[0.02]">
                Choose a folder to start building a rename queue.
              </div>
            )}

            {!loading() && paginated().map((item) => {
              const Icon = iconForFilterType(item.filterType);
              const selected = selectedRows().has(item.index);
              const result = results().get(item.index);

              return (
                <article class={`rounded-xl border p-2 grid grid-cols-[28px_64px_1fr_34px_1fr_34px] gap-2 items-center ${selected ? "border-pink-300/45 bg-pink-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
                  <button
                    class={`h-6 w-6 rounded border mx-auto ${selected ? "border-pink-300/70 bg-pink-300/20" : "border-white/20 bg-white/[0.02]"}`}
                    onClick={() => toggleRow(item.index)}
                  >
                    {selected && <Check size={12} class="mx-auto" />}
                  </button>

                  <div class="h-12 rounded-lg border border-white/10 bg-slate-950/70 overflow-hidden flex items-center justify-center">
                    {item.thumbnail ? <img src={item.thumbnail} alt={item.name} class="h-full w-full object-cover" /> : <Icon size={16} class="text-slate-400" />}
                  </div>

                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{item.name}</div>
                    <div class="text-[11px] text-slate-400 uppercase tracking-[0.1em] mt-0.5">{item.filterType} {item.extension || ""}</div>
                  </div>

                  <div class="text-pink-300 text-lg text-center">→</div>

                  <div class="min-w-0">
                    <div class="truncate text-sm">
                      {result?.suggestedName || (generating() && selected ? "Processing..." : "Pending")}
                    </div>
                    {result?.source && (
                      <div class="text-[11px] uppercase tracking-[0.1em] mt-0.5 text-slate-400">{result.source}</div>
                    )}
                  </div>

                  <button
                    class={`h-7 w-7 rounded-lg border ${selected ? "border-pink-300/70 bg-pink-300/20" : "border-white/20 bg-white/[0.02]"}`}
                    onClick={() => toggleRow(item.index, !selected)}
                  >
                    {selected ? <CheckCheck size={12} class="mx-auto" /> : <Check size={12} class="mx-auto text-slate-400" />}
                  </button>
                </article>
              );
            })}
          </div>

          <footer class="mt-2 rounded-xl border border-white/10 bg-slate-950/70 p-2.5 space-y-2">
            <div class="flex items-center justify-between gap-2 text-xs">
              <div class="text-slate-400 uppercase tracking-[0.14em]">{statusText()}</div>
              <div class="font-mono text-slate-300">
                {progress()
                  ? `${progress()!.processed}/${Math.max(progress()!.total, 1)}`
                  : `${selectedReadyCount()}/${selectedRows().size}`}
              </div>
            </div>

            <div class="seg-progress-wrap">
              <div class="seg-progress-track">
                {Array.from({ length: PROGRESS_SEGMENT_COUNT }).map((_, index) => (
                  <span class={`seg-progress-block ${index < Math.round(activeProgressRatio() * PROGRESS_SEGMENT_COUNT) ? "is-filled" : ""}`} />
                ))}
              </div>
              <div class="seg-progress-percent">{activeProgressPercent()}%</div>
            </div>

            <div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              {generating() && (
                <span class="inline-flex items-center gap-1">
                  <LoaderCircle size={12} class="animate-spin" />
                  {currentProgressPercent()}% · {activeCurrentFileName() || "working"}
                </span>
              )}
              {!generating() && lastRunSummary() && (
                <span class="inline-flex items-center gap-1">
                  <Timer size={12} />
                  Last run: {lastRunSummary()!.processed}/{lastRunSummary()!.total} in {Math.round(lastRunSummary()!.elapsedMs / 1000)}s
                </span>
              )}
              {!generating() && !lastRunSummary() && (
                <span>Select rows and generate to start.</span>
              )}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {generating() ? (
                <button
                  class="h-9 px-3 rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-100 text-sm flex items-center gap-1.5 hover:bg-amber-400/25"
                  onClick={() => void stopGeneration()}
                >
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button
                  class="h-9 px-3 rounded-lg border border-pink-300/45 bg-pink-400/15 text-pink-100 text-sm flex items-center gap-1.5 hover:bg-pink-400/25 disabled:opacity-50"
                  disabled={!canGenerate()}
                  onClick={() => void runGeneration()}
                >
                  <Play size={14} /> Generate Selected
                </button>
              )}

              <button
                class="h-9 px-3 rounded-lg border border-emerald-300/45 bg-emerald-400/15 text-emerald-100 text-sm flex items-center gap-1.5 hover:bg-emerald-400/25 disabled:opacity-50"
                disabled={!canApply()}
                onClick={() => void applyChanges()}
              >
                <CheckCheck size={14} /> Apply Changes
              </button>

              <button
                class="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] text-sm hover:bg-white/[0.08] flex items-center gap-1.5"
                onClick={() => void pickFolder()}
              >
                <ArrowLeft size={14} /> Folder
              </button>

              <button
                class="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] text-sm hover:bg-white/[0.08] flex items-center gap-1.5 disabled:opacity-50"
                disabled={!folderPath() || loading() || generating()}
                onClick={() => void refreshCurrentFolder()}
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </footer>
        </main>

        <aside class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-3 flex flex-col min-h-[320px] xl:col-span-2 2xl:col-span-1 xl:min-h-0 xl:h-full grain-surface">
          <div class="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            <h3 class="text-base font-semibold">Selection</h3>
            <button
              class="h-7 w-7 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08]"
              onClick={() => setSelectedRows(new Set<number>())}
              title="Clear selection"
            >
              <X size={12} class="mx-auto" />
            </button>
          </div>

          <div class="text-sm mt-3"><strong>{selectedReadyCount()}</strong> ready / <strong>{selectedPendingCount()}</strong> pending</div>
          <div class="text-xs text-slate-400">{visibleSelection()} selected on this page · {selectedRows().size} total selected</div>

          <button
            class="mt-3 h-8 rounded-md border border-pink-300/35 bg-pink-400/10 text-xs hover:bg-pink-400/20 disabled:opacity-50"
            disabled={filtered().length === 0}
            onClick={toggleSelectAllFiltered}
          >
            {allFilteredSelected() ? "Deselect All" : "Select All"}
          </button>

          <div class="mt-3 grid grid-cols-2 gap-1.5">
            <button class="h-8 rounded-md border border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.08]" onClick={selectAllVisible}>
              Select Page
            </button>
            <button class="h-8 rounded-md border border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.08]" onClick={selectReadyVisible}>
              Select Ready
            </button>
            <button class="h-8 rounded-md border border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.08]" onClick={invertVisibleSelection}>
              Invert Page
            </button>
            <button class="h-8 rounded-md border border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.08]" onClick={keepOnlyReadySelected}>
              Keep Ready
            </button>
          </div>

          <div class="mt-3 min-h-0 flex-1 overflow-auto space-y-1 pr-1">
            {Array.from(selectedRows()).length === 0 && <div class="text-xs text-slate-500">No rows selected.</div>}
            {selectedSorted()
              .map((index) => {
                const file = files().find((item) => item.index === index);
                if (!file) return null;

                const result = results().get(index);
                const ready = Boolean(result?.suggestedName);

                return (
                  <div class={`rounded-lg border px-2 py-1.5 text-xs ${ready ? "border-emerald-300/45 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]"}`}>
                    <div class="truncate font-mono">{file.name}</div>
                    <div class="mt-0.5 flex items-center justify-between gap-2">
                      <span class="truncate text-slate-300">{ready ? result!.suggestedName : "Pending"}</span>
                      <span class={`shrink-0 uppercase tracking-[0.12em] text-[10px] ${ready ? "text-emerald-200" : "text-amber-200"}`}>
                        {ready ? result?.source ?? "ready" : "pending"}
                      </span>
                    </div>
                    {result?.error && <div class="text-[10px] text-rose-200 mt-0.5 truncate">{result.error}</div>}
                  </div>
                );
              })}
          </div>

          <div class="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">Pagination</div>
              <button
                class="h-6 px-2 rounded border border-white/10 bg-white/[0.03] text-[10px] hover:bg-white/[0.08]"
                onClick={() => setCurrentPage(1)}
                title="Jump to first page"
              >
                <ChevronsUpDown size={10} class="inline rotate-90 mr-1" />
                First
              </button>
            </div>
            <div class="mt-2 flex items-center justify-between text-xs">
              <button
                class="h-8 w-8 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-50"
                disabled={currentPage() <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} class="mx-auto" />
              </button>
              <span>Page {currentPage()} / {totalPages()}</span>
              <button
                class="h-8 w-8 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-50"
                disabled={currentPage() >= totalPages()}
                onClick={() => setCurrentPage((p) => Math.min(totalPages(), p + 1))}
              >
                <ChevronRight size={14} class="mx-auto" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
