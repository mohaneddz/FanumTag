import { useNavigate } from "@solidjs/router";
import { ArrowLeft, ShieldCheck, FileSearch, Sparkles } from "lucide-solid";

export default function About() {
  const navigate = useNavigate();

  return (
    <section class="h-full overflow-auto p-4 md:p-6">
      <article class="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
        <div class="text-xs tracking-[0.2em] uppercase text-slate-400">About</div>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold text-slate-100">FanumTag</h1>
        <p class="mt-4 text-sm md:text-base text-slate-300 max-w-3xl leading-relaxed">
          FanumTag is a local-first file naming workspace for large media and document folders. It now runs on a Rust-managed runtime singleton with local Qwen vision inference and safe native rename execution.
        </p>

        <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <FileSearch size={16} class="text-cyan-300" />
            <h3 class="mt-2 text-sm font-semibold">Preview Before Rename</h3>
            <p class="mt-1 text-xs text-slate-400">Inspect each proposed name before any disk mutation.</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <ShieldCheck size={16} class="text-emerald-300" />
            <h3 class="mt-2 text-sm font-semibold">Safety by Default</h3>
            <p class="mt-1 text-xs text-slate-400">Validation, collision suffixing, and reserved-name handling are applied in Rust.</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <Sparkles size={16} class="text-amber-300" />
            <h3 class="mt-2 text-sm font-semibold">Local Runtime</h3>
            <p class="mt-1 text-xs text-slate-400">No cloud dependency: vision model, queueing, and rename pipeline run locally.</p>
          </div>
        </div>

        <div class="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">
          Workflow: select folder {">"} select rows {">"} generate suggestions {">"} apply renames.
        </div>

        <div class="mt-6 flex justify-end">
          <button
            class="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-sm flex items-center gap-1.5"
            onClick={() => navigate("/")}
          >
            <ArrowLeft size={14} /> Back to Workspace
          </button>
        </div>
      </article>
    </section>
  );
}