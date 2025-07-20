import { Eye, Sparkles } from "lucide-solid";

interface PreviewHeaderProps {
    folder: string | (() => string);
    loading: boolean | (() => boolean);
    fileCount: number | (() => number);
}

export default function PreviewHeader({ folder, loading, fileCount }: PreviewHeaderProps) {
    const getLoading = typeof loading === "function" ? loading : () => loading;
    const getFileCount = typeof fileCount === "function" ? fileCount : () => fileCount;
    const getFolder = typeof folder === "function" ? folder : () => folder;

    return (
        <div class="relative my-8 h-[40%]">
            <div class="absolute inset-0 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 rounded-3xl blur-xl"></div>
            <div class="relative bg-background-light-1/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 border border-background-light-2/30">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div class="flex items-center gap-4">
                        <div class="relative">
                            <div class="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg">
                                <Eye size={28} class="text-white" />
                            </div>
                            <div class="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center">
                                <Sparkles size={12} class="text-white" />
                            </div>
                        </div>
                        <div>
                            <h1 class="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                                Preview Changes
                            </h1>
                            <div class="flex items-center gap-2 mt-1">
                                <div class={`w-2 h-2 ${getLoading() ? "bg-warning animate-pulse" : "bg-success"} rounded-full`}></div>
                                <span class="text-sm text-text-dark-1">Folder:</span>
                                <span class="font-mono text-accent font-semibold px-2 py-1 bg-accent/10 rounded-lg">
                                    {getLoading()
                                        ? "Loading..."
                                        : folder
                                            ? getFolder().split(/[\\/]/).filter(Boolean).pop()
                                            : "No folder"}
                                </span>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Path Card */}
                <div class="mt-6">
                    <div class="px-4 py-2 rounded-lg light-2/40  flex items-center justify-between gap-2 font-mono text-sm text-text-dark-2 overflow-x-auto">
                        <div class="">

                            <span class="font-semibold text-primary">Path&nbsp;:&nbsp;</span>
                            <span>{getFolder() || "No folder selected"}</span>
                        </div>

                        <div class="flex items-center gap-3">
                            <div class="px-4 py-2 bg-gradient-to-r from-background-light-2/50 to-background-light-3/50 rounded-full backdrop-blur-sm border border-background-light-2/30">
                                <div class="flex items-center gap-2">
                                    <div class={`w-2 h-2 ${getLoading() ? "bg-warning animate-pulse" : "bg-primary animate-pulse"} rounded-full`}></div>
                                    <span class="text-xs font-semibold text-text-dark-1">
                                        {getLoading() ? "Loading..." : `${getFileCount()} file${getFileCount() !== 1 ? "s" : ""}`}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
