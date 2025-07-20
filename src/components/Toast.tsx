import { Show, createSignal, onCleanup } from "solid-js";

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
        <span>
          {props.variant === "success" && (
            <svg
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 20 20"
            >
              <circle cx="10" cy="10" r="10" fill="#6A5ACD" />
              <path
                d="M6 10.5l2.5 2.5L14 7.5"
                stroke="#fff"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          )}
          {props.variant === "error" && (
            <svg
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 20 20"
            >
              <circle cx="10" cy="10" r="10" fill="#D6336B" />
              <path
                d="M7 7l6 6M13 7l-6 6"
                stroke="#fff"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          )}
          {props.variant === "warning" && (
            <svg
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 20 20"
            >
              <circle cx="10" cy="10" r="10" fill="#C71585" />
              <path
                d="M10 6v5M10 13h.01"
                stroke="#fff"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          )}
          {props.variant === "info" && (
            <svg
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 20 20"
            >
              <circle cx="10" cy="10" r="10" fill="#7B68EE" />
              <path
                d="M10 7h.01M10 9v4"
                stroke="#fff"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          )}
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
