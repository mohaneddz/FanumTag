import { Show, createSignal, onCleanup } from "solid-js";
import { Info, XCircle, TriangleAlert, CheckCircle } from "lucide-solid";

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number; // ms
  onClose?: () => void;
}

const variantStyles: Record<ToastVariant, string> = {
  success: "from-success to-success-light-1 border-success",
  error: "from-error to-error-light-1 border-error",
  warning: "from-warning to-warning-light-1 border-warning",
  info: "from-info to-info-light-1 border-info",
};

export default function Toast(props: ToastProps) {
  const [visible, setVisible] = createSignal(true);

  // Auto-hide after duration
  if (props.duration !== 0) {
    const timer = setTimeout(() => {
      setVisible(false);
      props.onClose?.();
    }, props.duration ?? 3000);
    onCleanup(() => clearTimeout(timer));
  }

  return (
    <Show when={visible()}>
      <div
        class={`fixed bottom-6 right-6 z-[9999] min-w-[220px] max-w-xs px-5 py-3 rounded-2xl shadow-2xl border-2 bg-gradient-to-r ${variantStyles[props.variant ?? "info"]} text-white font-semibold flex items-center gap-3 transition-all animate-fade-in`}
        style="backdrop-filter: blur(8px);"
      >
        {/* Icon */}
        <span class="text-white/80">
          {props.variant === "success" && <CheckCircle size={20} color="#FFFFFF" />}
          {props.variant === "error" && <XCircle size={20} color="#FFFFFF" />}
          {props.variant === "warning" && <TriangleAlert size={26} color="#FFFFFF" class="border-white border-1 p-1 rounded-full" />}
          {props.variant === "info" && <Info size={20} color="#FFFFFF" />}
        </span>
        {/* Message */}
        <span class="flex-1">{props.message}</span>
        {/* Close button */}
        <button
          class="ml-2 text-white/80 hover:text-white transition"
          style="background: none; border: none; font-size: 1.2em; cursor: pointer;"
          onClick={() => {
            setVisible(false);
            props.onClose?.();
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </Show>
  );
}
