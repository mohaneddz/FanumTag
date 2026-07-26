import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Activity, ArrowLeft, Play, Save, Square, RefreshCw } from "lucide-solid";

import Toast from "@/components/Toast";
import {
  runtimeGetConfig,
  runtimeGetStatus,
  runtimeStart,
  runtimeStop,
  runtimeUpdateConfig,
  type RuntimeConfig,
  type RuntimeStatus,
} from "@/services/runtime";

type RuntimeForm = {
  host: string;
  port: string;
  threads: string;
  gpuLayers: string;
  ctxSize: string;
  requestTimeoutSec: string;
  autoStart: boolean;
};

function toForm(config: RuntimeConfig): RuntimeForm {
  return {
    host: config.host,
    port: String(config.port),
    threads: String(config.threads),
    gpuLayers: String(config.gpuLayers),
    ctxSize: String(config.ctxSize),
    requestTimeoutSec: String(config.requestTimeoutSec),
    autoStart: config.autoStart,
  };
}

function toConfig(form: RuntimeForm): RuntimeConfig {
  return {
    host: form.host.trim() || "127.0.0.1",
    port: Number(form.port) || 32123,
    threads: Number(form.threads) || 4,
    gpuLayers: Number(form.gpuLayers) || 99,
    ctxSize: Number(form.ctxSize) || 8192,
    requestTimeoutSec: Number(form.requestTimeoutSec) || 120,
    autoStart: form.autoStart,
  };
}

export default function Settings() {
  const navigate = useNavigate();
  const [status, setStatus] = createSignal<RuntimeStatus | null>(null);
  const [form, setForm] = createSignal<RuntimeForm | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [toast, setToast] = createSignal<{ message: string; variant: "success" | "error" | "warning" | "info" } | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const [nextStatus, config] = await Promise.all([runtimeGetStatus(), runtimeGetConfig()]);
      setStatus(nextStatus);
      setForm(toForm(config));
    } catch (error) {
      setToast({
        message: `Could not read runtime state: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const startRuntime = async () => {
    setBusy(true);
    try {
      const next = await runtimeStart();
      setStatus(next);
      setToast({ message: "Runtime started.", variant: "success" });
    } catch (error) {
      setToast({
        message: `Failed to start runtime: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const stopRuntime = async () => {
    setBusy(true);
    try {
      const next = await runtimeStop();
      setStatus(next);
      setToast({ message: "Runtime stopped.", variant: "info" });
    } catch (error) {
      setToast({
        message: `Failed to stop runtime: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    const current = form();
    if (!current) return;

    setBusy(true);
    try {
      const updated = await runtimeUpdateConfig(toConfig(current));
      setForm(toForm(updated));
      const nextStatus = await runtimeGetStatus();
      setStatus(nextStatus);
      setToast({ message: "Runtime configuration saved.", variant: "success" });
    } catch (error) {
      setToast({
        message: `Failed to save runtime config: ${error instanceof Error ? error.message : String(error)}`,
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
      <Show when={toast()}>{(item) => <Toast message={item().message} variant={item().variant} onClose={() => setToast(null)} />}</Show>

      <div class="mx-auto max-w-6xl grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <article class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 md:p-6">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Runtime Control</div>
              <h1 class="mt-1 text-2xl md:text-3xl font-bold">Settings</h1>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] text-sm flex items-center gap-1.5 hover:bg-white/[0.08] disabled:opacity-50"
                onClick={() => void refresh()}
                disabled={busy()}
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                class="h-9 px-3 rounded-lg border border-pink-300/40 bg-pink-400/15 text-pink-100 text-sm flex items-center gap-1.5 hover:bg-pink-400/25 disabled:opacity-50"
                onClick={() => void saveConfig()}
                disabled={busy() || !form()}
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">Host</span>
              <input
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.host ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, host: e.currentTarget.value } : prev))}
              />
            </label>

            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">Port</span>
              <input
                type="number"
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.port ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, port: e.currentTarget.value } : prev))}
              />
            </label>

            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">Threads</span>
              <input
                type="number"
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.threads ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, threads: e.currentTarget.value } : prev))}
              />
            </label>

            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">GPU Layers</span>
              <input
                type="number"
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.gpuLayers ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, gpuLayers: e.currentTarget.value } : prev))}
              />
            </label>

            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">Context Size</span>
              <input
                type="number"
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.ctxSize ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, ctxSize: e.currentTarget.value } : prev))}
              />
            </label>

            <label class="space-y-1">
              <span class="text-xs text-slate-400 uppercase tracking-[0.16em]">Request Timeout (sec)</span>
              <input
                type="number"
                class="w-full h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"
                value={form()?.requestTimeoutSec ?? ""}
                onInput={(e) => setForm((prev) => (prev ? { ...prev, requestTimeoutSec: e.currentTarget.value } : prev))}
              />
            </label>
          </div>

          <label class="mt-4 inline-flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={form()?.autoStart ?? false}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, autoStart: e.currentTarget.checked } : prev))}
              class="h-4 w-4 accent-cyan-400"
            />
            Auto-start runtime on app launch
          </label>

          <div class="mt-6 flex flex-wrap gap-2">
            <button
              class="h-9 px-3 rounded-lg border border-emerald-300/35 bg-emerald-400/15 text-emerald-100 text-sm flex items-center gap-1.5 hover:bg-emerald-400/25 disabled:opacity-50"
              onClick={() => void startRuntime()}
              disabled={busy()}
            >
              <Play size={14} /> Start Runtime
            </button>
            <button
              class="h-9 px-3 rounded-lg border border-rose-300/35 bg-rose-400/15 text-rose-100 text-sm flex items-center gap-1.5 hover:bg-rose-400/25 disabled:opacity-50"
              onClick={() => void stopRuntime()}
              disabled={busy()}
            >
              <Square size={14} /> Stop Runtime
            </button>
          </div>
        </article>

        <aside class="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-4 flex flex-col gap-3">
          <div>
            <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Status</div>
            <h2 class="mt-1 text-xl font-semibold">Runtime Health</h2>
          </div>

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

          <Show when={status()?.lastError}>
            {(error) => (
              <div class="rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-xs text-rose-100 leading-relaxed">
                {error()}
              </div>
            )}
          </Show>

          <button
            class="mt-auto h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-sm flex items-center justify-center gap-1.5"
            onClick={() => navigate("/")}
          >
            <ArrowLeft size={14} /> Back to Workspace
          </button>

          <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Activity size={12} /> Host is normalized to localhost for safety.
          </div>
        </aside>
      </div>
    </section>
  );
}
