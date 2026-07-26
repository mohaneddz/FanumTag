import { createSignal, onCleanup, onMount } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Minus, Settings, Square, X, FolderSearch, Bug } from "lucide-solid";

import { runtimeHealth, type RuntimeHealth } from "@/services/runtime";

const navItems = [
  { href: "/", label: "Workspace", icon: FolderSearch },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/debug", label: "Debug", icon: Bug },
  { href: "/about", label: "About", icon: Info },
];

const HEALTH_POLL_MS = 4000;

type RuntimeIndicator = {
  label: string;
  dotClass: string;
  textClass: string;
  pulse: boolean;
};

function describeHealth(health: RuntimeHealth | null): RuntimeIndicator {
  if (!health) {
    return { label: "Checking model", dotClass: "bg-slate-400", textClass: "text-slate-400", pulse: true };
  }

  if (!health.running) {
    return { label: "Model stopped", dotClass: "bg-slate-500", textClass: "text-slate-400", pulse: false };
  }

  if (!health.responsive) {
    return { label: "Model not responding", dotClass: "bg-rose-400", textClass: "text-rose-200", pulse: true };
  }

  if (health.busy) {
    return { label: "Model working", dotClass: "bg-pink-400", textClass: "text-pink-200", pulse: true };
  }

  return { label: "Model ready", dotClass: "bg-emerald-400", textClass: "text-emerald-200", pulse: false };
}

export default function Titlebar() {
  const appWindow = getCurrentWindow();
  const location = useLocation();
  const [health, setHealth] = createSignal<RuntimeHealth | null>(null);

  onMount(() => {
    let active = true;

    const poll = async () => {
      try {
        const next = await runtimeHealth();
        if (active) setHealth(next);
      } catch {
        if (active) setHealth({ running: false, busy: false, responsive: false });
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), HEALTH_POLL_MS);

    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  return (
    <header class="relative border-b border-white/10 bg-slate-950/70 backdrop-blur-2xl grain-surface">
      <div class="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2 h-7">
        {(() => {
          const indicator = describeHealth(health());
          return (
            <>
              <span class="relative flex h-2 w-2">
                {indicator.pulse && (
                  <span class={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${indicator.dotClass}`} />
                )}
                <span class={`relative inline-flex h-2 w-2 rounded-full ${indicator.dotClass}`} />
              </span>
              <span class={`text-[10px] uppercase tracking-[0.14em] ${indicator.textClass}`}>{indicator.label}</span>
            </>
          );
        })()}
      </div>

      <div data-tauri-drag-region class="px-3 md:px-4 pt-4 pb-3 pl-40 sm:pl-44 pr-24 sm:pr-28 lg:pr-4 flex flex-col items-center gap-3">
        <div class="logo-banner">
          <img src="/fanum.png" alt="Fanum Tag" class="logo-banner-image" />
        </div>

        <nav class="flex flex-wrap items-center justify-center gap-2 max-w-full">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = () => (item.href === "/" ? location.pathname === "/" : location.pathname.startsWith(item.href));

            return (
              <A
                href={item.href}
                class={`h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition ${
                  active()
                    ? "border-pink-300/60 bg-pink-300/15 text-pink-100"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white"
                }`}
              >
                <Icon size={13} />
                {item.label}
              </A>
            );
          })}
        </nav>
      </div>

      <div class="absolute top-3 right-3 flex items-center gap-1.5 z-10">
        <button
          class="h-7 w-8 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/20"
          onClick={() => void appWindow.minimize()}
          title="Minimize"
        >
          <Minus size={14} class="mx-auto" />
        </button>
        <button
          class="h-7 w-8 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/20"
          onClick={() => void appWindow.toggleMaximize()}
          title="Maximize"
        >
          <Square size={11} class="mx-auto" />
        </button>
        <button
          class="h-7 w-8 rounded-md border border-red-300/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:border-red-300/40"
          onClick={() => void appWindow.close()}
          title="Close"
        >
          <X size={14} class="mx-auto" />
        </button>
      </div>
    </header>
  );
}
