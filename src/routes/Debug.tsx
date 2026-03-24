import { createSignal, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Play, Square, Wrench, Image, FileText } from "lucide-solid";

import Toast from "@/components/Toast";
import {
  runtimeGetStatus,
  runtimeStart,
  runtimeStop,
  runtimeProbe,
  runtimeGenerateBatch,
  type RuntimeStatus,
} from "@/services/runtime";
import { getFileKind } from "@/utils/files";

export default function Debug() {
  const [status, setStatus] = createSignal<RuntimeStatus | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [probePrompt, setProbePrompt] = createSignal("Reply with exactly: VLLM_OK");
  const [probeOutput, setProbeOutput] = createSignal("");
  const [toast, setToast] = createSignal<{ message: string; variant: "success" | "error" | "warning" | "info" } | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await runtimeGetStatus();
      setStatus(next);
    } catch (error) {
      setToast({
        message: `Status fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const next = await runtimeStart();
      setStatus(next);
      setToast({ message: "Runtime started.", variant: "success" });
    } catch (error) {
      setToast({
        message: `Start failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const next = await runtimeStop();
      setStatus(next);
      setToast({ message: "Runtime stopped.", variant: "info" });
    } catch (error) {
      setToast({
        message: `Stop failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runProbe = async () => {
    setBusy(true);
    try {
      const result = await runtimeProbe(probePrompt());
      setProbeOutput(`${result.response}\n\nElapsed: ${result.elapsedMs} ms`);
      setToast({ message: "Probe request succeeded.", variant: "success" });
      await refresh();
    } catch (error) {
      setProbeOutput("");
      setToast({
        message: `Probe failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const testSingleFile = async () => {
  const selected = await open({
    title: "Pick a file to test",
    multiple: false,
    directory: false,
  });

    if (typeof selected !== "string") return;

    const kind = getFileKind(selected);
    const payload: { ind: number; path: string; kind: "image" | "video" | "audio" | "txt" | "fallback"; videoFrameBase64?: string } = {
      ind: 0,
      path: selected,
      kind,
    };

    setBusy(true);
    try {
      const result = await runtimeGenerateBatch([payload]);
      const item = result[0];
      if (!item) {
        setProbeOutput("No result returned from runtime.");
      } else {
        setProbeOutput(`Source: ${item.source}\nSuggested: ${item.suggestedName ?? "<none>"}\nError: ${item.error ?? "<none>"}`);
      }
      setToast({ message: "Single-file batch test completed.", variant: "success" });
      await refresh();
    } catch (error) {
      setToast({
        message: `Batch test failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    void refresh();
  });

  return (
    <section class="h-full overflow-auto p-4 md:p-6">
      {toast() && <Toast message={toast()!.message} variant={toast()!.variant} onClose={() => setToast(null)} />}

      <div class="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <article class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 space-y-4">
          <div>
            <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Runtime Test Ground</div>
            <h1 class="mt-1 text-2xl font-bold">Debug</h1>
          </div>

          <div class="flex flex-wrap gap-2">
            <button class="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] text-sm flex items-center gap-1.5" onClick={() => void refresh()} disabled={busy()}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button class="h-9 px-3 rounded-lg border border-emerald-300/35 bg-emerald-400/15 text-sm flex items-center gap-1.5" onClick={() => void start()} disabled={busy()}>
              <Play size={14} /> Start
            </button>
            <button class="h-9 px-3 rounded-lg border border-rose-300/35 bg-rose-400/15 text-sm flex items-center gap-1.5" onClick={() => void stop()} disabled={busy()}>
              <Square size={14} /> Stop
            </button>
            <button class="h-9 px-3 rounded-lg border border-cyan-300/35 bg-cyan-400/15 text-sm flex items-center gap-1.5" onClick={() => void testSingleFile()} disabled={busy()}>
              <Image size={14} /> Test File
            </button>
            <button
              class="h-9 px-3 rounded-lg border border-amber-300/35 bg-amber-400/15 text-sm flex items-center gap-1.5"
              onClick={() => {
                const windowRef = getCurrentWindow() as unknown as { openDevtools?: () => void };
                windowRef.openDevtools?.();
              }}
            >
              <Wrench size={14} /> DevTools
            </button>
          </div>

          <div class="space-y-2">
            <label class="text-xs uppercase tracking-[0.14em] text-slate-400">Probe Prompt</label>
            <textarea
              class="w-full min-h-28 rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm outline-none"
              value={probePrompt()}
              onInput={(e) => setProbePrompt(e.currentTarget.value)}
            />
            <button class="h-9 px-3 rounded-lg border border-violet-300/35 bg-violet-400/15 text-sm flex items-center gap-1.5" onClick={() => void runProbe()} disabled={busy()}>
              <FileText size={14} /> Run Probe
            </button>
          </div>

          <div class="rounded-xl border border-white/10 bg-slate-950/60 p-3 min-h-28">
            <div class="text-xs uppercase tracking-[0.14em] text-slate-400 mb-2">Output</div>
            <pre class="text-xs whitespace-pre-wrap break-words text-slate-200">{probeOutput() || "No output yet."}</pre>
          </div>
        </article>

        <aside class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-4 space-y-2 h-fit">
          <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Runtime Status</div>
          <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm space-y-1">
            <div class="flex items-center justify-between"><span class="text-slate-400">Running</span><strong>{status()?.running ? "Yes" : "No"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">Busy</span><strong>{status()?.busy ? "Yes" : "No"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">PID</span><strong class="font-mono">{status()?.pid ?? "-"}</strong></div>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm space-y-1">
            <div class="flex items-center justify-between"><span class="text-slate-400">llama-server.exe</span><strong>{status()?.binaryFound ? "Found" : "Missing"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">Qwen Weights</span><strong>{status()?.modelFound ? "Found" : "Missing"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">MMProj</span><strong>{status()?.mmprojFound ? "Found" : "Missing"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">whisper-cli.exe</span><strong>{status()?.whisperBinaryFound ? "Found" : "Missing"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">Whisper Turbo Model</span><strong>{status()?.whisperModelFound ? "Found" : "Missing"}</strong></div>
            <div class="flex items-center justify-between"><span class="text-slate-400">ffmpeg.exe</span><strong>{status()?.ffmpegFound ? "Found" : "Missing"}</strong></div>
          </div>
          {status()?.lastError && (
            <div class="rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-xs text-rose-100">{status()!.lastError}</div>
          )}
        </aside>
      </div>
    </section>
  );
}
