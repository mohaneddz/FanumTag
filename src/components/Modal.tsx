import { JSX } from "solid-js";
import { X } from "lucide-solid";

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children?: JSX.Element;
  title?: string;
}

export default function Modal(props: ModalProps) {
  if (!props.open) return null;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose?.();
    }
  };

  return (
    <div 
      class="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
    >
      {/* Animated background overlay */}
      <div class="absolute inset-0 bg-gradient-to-br from-background/80 via-background-dark-1/90 to-background/80"></div>
      
      {/* Modal container with multiple blur layers */}
      <div class="relative max-w-2xl w-full max-h-[90vh] overflow-hidden animate-modal-in">
        {/* Outer glow */}
        <div class="absolute inset-0 bg-gradient-to-br from-primary/20 via-accent/20 to-primary/20 rounded-3xl blur-xl"></div>
        
        {/* Main modal */}
        <div class="relative bg-background-light-1/80 backdrop-blur-xl rounded-3xl border border-background-light-2/30 shadow-2xl overflow-hidden">
          {/* Header */}
          {props.title && (
            <div class="relative">
              <div class="absolute inset-0 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 blur-lg"></div>
              <div class="relative px-6 py-4 border-b border-background-light-2/30">
                <h2 class="text-2xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                  {props.title}
                </h2>
              </div>
            </div>
          )}
          
          {/* Close button */}
          <button
            class="absolute top-4 right-4 z-10 group"
            onClick={props.onClose}
            aria-label="Close modal"
          >
            <div class="absolute inset-0 bg-gradient-to-r from-error/20 to-error/30 rounded-full blur-md group-hover:blur-lg transition-all duration-300"></div>
            <div class="relative w-10 h-10 bg-background-light-2/60 hover:bg-error/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-background-light-2/30 hover:border-error/30 transition-all duration-300 transform hover:scale-110 active:scale-95">
              <X size={20} class="text-text hover:text-error transition-colors duration-300" />
            </div>
          </button>
          
          {/* Content */}
          <div class="px-6 py-6 max-h-[calc(90vh-8rem)] overflow-y-auto custom-scrollbar">
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Add custom styles */
const style = document.createElement('style');
style.textContent = `
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  
  @keyframes modal-in {
    from {
      opacity: 0;
      transform: scale(0.9) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  
  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }
  
  .animate-modal-in {
    animation: modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  
  .custom-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: var(--color-background-light-2);
    border-radius: 10px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: linear-gradient(to bottom, var(--color-primary), var(--color-accent));
    border-radius: 10px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(to bottom, var(--color-primary-light-1), var(--color-accent-light-1));
  }
`;
document.head.appendChild(style);