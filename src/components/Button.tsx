import { JSX } from "solid-js";

const variants = [
    "primary", "secondary", "accent", "ghost", "link", "info", "success", "warning", "error"
] as const;

interface Props {
    variant?: typeof variants[number];
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    children?: JSX.Element | string;
    onClick?: any;
    type?: "button" | "submit" | "reset";
    class?: string;
    icon?: JSX.Element;
}

export default function Button(props: Props) {
    const variant = props.variant || "primary";
    const size = props.size || "md";

    const getVariantClasses = () => {
        switch (variant) {
            case "primary":
                return "bg-gradient-to-r from-primary to-accent hover:from-primary-light-1 hover:to-accent-light-1 text-white font-bold shadow-lg shadow-primary/25 border border-primary/20";
            case "secondary":
                return "bg-gradient-to-r from-secondary to-secondary-light-1 hover:from-secondary-light-1 hover:to-secondary-light-2 text-white font-bold shadow-lg shadow-secondary/25 border border-secondary/20";
            case "accent":
                return "bg-gradient-to-r from-accent to-accent-light-1 hover:from-accent-light-1 hover:to-accent-light-2 text-white font-bold shadow-lg shadow-accent/25 border border-accent/20";
            case "ghost":
                return "bg-background-light-1/40 hover:bg-background-light-2/60 backdrop-blur-sm text-text hover:text-text-light-1 font-semibold border border-background-light-2/30 hover:border-primary/30";
            case "link":
                return "bg-transparent hover:bg-primary/10 text-primary hover:text-primary-light-1 font-semibold border border-transparent hover:border-primary/20 underline-offset-4 hover:underline";
            case "info":
                return "bg-gradient-to-r from-info to-info-light-1 hover:from-info-light-1 hover:to-info-light-2 text-white font-bold shadow-lg shadow-info/25 border border-info/20";
            case "success":
                return "bg-gradient-to-r from-success to-success-light-1 hover:from-success-light-1 hover:to-success-light-2 text-white font-bold shadow-lg shadow-success/25 border border-success/20";
            case "warning":
                return "bg-gradient-to-r from-warning to-warning-light-1 hover:from-warning-light-1 hover:to-warning-light-2 text-white font-bold shadow-lg shadow-warning/25 border border-warning/20";
            case "error":
                return "bg-gradient-to-r from-error to-error-light-1 hover:from-error-light-1 hover:to-error-light-2 text-white font-bold shadow-lg shadow-error/25 border border-error/20";
            default:
                return "";
        }
    }

    const getSizeClasses = () => {
        switch (size) {
            case "sm":
                return "px-4 py-2 text-sm rounded-xl";
            case "md":
                return "px-6 py-3 text-base rounded-xl";
            case "lg":
                return "px-8 py-4 text-lg rounded-2xl";
            default:
                return "px-6 py-3 text-base rounded-xl";
        }
    }

    const getDisabledClasses = () => {
        if (props.disabled) {
            return "opacity-50 cursor-not-allowed transform-none hover:transform-none";
        }
        return "hover:scale-105 active:scale-95 cursor-pointer";
    }

    return (
        <div class="relative group">
            {/* Glow effect background */}
            <div class={`absolute inset-0 ${getVariantClasses()} ${getSizeClasses()} blur-lg opacity-30 group-hover:opacity-50 transition-all duration-300`}></div>

            {/* Main button */}
            <button
                type={props.type || "button"}
                class={`
                    relative  z-10
                    ${getVariantClasses()}
                    ${getSizeClasses()}
                    ${getDisabledClasses()}
                    transition-all duration-300 ease-out
                    transform
                    backdrop-blur-sm
                    ${props.class || ""}
                `}
                disabled={props.disabled}
                onClick={props.onClick}
            >
                {props.children}
            </button>
        </div>
    );
}