import { Show, createSignal, onCleanup } from "solid-js";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-solid";

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  onClose?: () => void;
}

const iconByVariant = {
  success: CircleCheck,
  error: CircleX,
  warning: CircleAlert,
  info: Info,
} satisfies Record<ToastVariant, typeof Info>;

const styleByVariant: Record<ToastVariant, string> = {
  success: "border-emerald-300/40 bg-emerald-500/15 text-emerald-100",
  error: "border-rose-300/40 bg-rose-500/15 text-rose-100",
  warning: "border-amber-300/40 bg-amber-500/15 text-amber-100",
  info: "border-cyan-300/40 bg-cyan-500/15 text-cyan-100",
};

export default function Toast(props: ToastProps) {
  const [visible, setVisible] = createSignal(true);
  const variant = props.variant ?? "info";
  const Icon = iconByVariant[variant];

  if (props.duration !== 0) {
    const timer = setTimeout(() => {
      setVisible(false);
      props.onClose?.();
    }, props.duration ?? 3200);
    onCleanup(() => clearTimeout(timer));
  }

  return (
    <Show when={visible()}>
      <div class={`fixed bottom-5 right-5 z-[9999] min-w-[260px] max-w-[480px] rounded-xl border px-4 py-3 shadow-2xl backdrop-blur ${styleByVariant[variant]}`}>
        <div class="flex items-start gap-2.5">
          <Icon size={16} class="mt-0.5 shrink-0" />
          <p class="text-sm leading-snug flex-1">{props.message}</p>
          <button
            class="h-6 w-6 rounded-md border border-white/20 text-xs hover:bg-white/10"
            onClick={() => {
              setVisible(false);
              props.onClose?.();
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  );
}