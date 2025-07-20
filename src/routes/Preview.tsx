import Button from "@/components/Button";
import PreviewHeader from "@/components/PreviewHeader";
import { Sparkles, GitCompare, ArrowLeft, Search, RefreshCw } from "lucide-solid";
import { usePreview } from "@/hooks/usePreview";
import { sendFilesToServer } from "@/utils/image_caption_utils";
import Toast from "@/components/Toast";

import FileSkeleton from "@/components/FileSkeleton";
import EnhancedFileItem from "@/components/FileItem";
import PaginationControls from "@/components/PaginationControls";
import SearchAndFilters from "@/components/SearchAndFilters";
import { createSignal, onMount } from "solid-js";

export default function Preview() {
    const {
        loading,
        comparisons,
        folderPath,
        searchTerm,
        sortBy,
        sortDirection,
        typeFilter,
        currentPage,
        setSearchTerm,
        setTypeFilter,
        setCurrentPage,
        availableTypes,
        filteredFiles,
        paginatedFiles,
        totalPages,
        handleApplyRenames,
        handleBack,
        handleSortChange,
        itemsPerPage,
        files,
        refreshFiles,
        captionProgress,
        setCaptionProgress,
        captionResults,
        setCaptionResults,
        selectedFiles,
        setSelectedFiles,
        toast,
        setToast,
        cancelRequested,
        setCancelRequested,
    } = usePreview(20);

    const [isLoaded, setIsLoaded] = createSignal(false);

    onMount(() => {
        setTimeout(() => setIsLoaded(true), 100);
    });

    return (
        <>
            {/* Toast notification */}
            {toast() && (
                <Toast
                    message={toast()!.message}
                    variant={toast()!.variant}
                    duration={toast()!.duration ?? 3000}
                    onClose={() => setToast(null)}
                />
            )}
            <div class="h-screen bg-gradient-to-br from-background via-background-light-1 to-background-dark-2">
                <div class="flex flex-col h-screen w-screen overflow-hidden">
                    <div class={`flex flex-col gap-4 items-stretch justify-center w-full max-w-5xl mx-auto py-8 md:py-12 h-screen max-h-screen overflow-visible transition-all duration-500 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                        {/* Always show header */}
                        <div class={`mb-4 flex-1 relative transition-all duration-700 delay-100 ${isLoaded() ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                            <PreviewHeader
                                folder={folderPath}
                                loading={loading}
                                fileCount={() => filteredFiles().length}
                            />

                            {/* Top right refresh button inside header */}
                            <button
                                class="absolute top-10 right-4 z-50 bg-background-light-2/80 text-gray-400 border border-background-light-2 rounded-full p-2 shadow active:scale-95 active:brightness-90 hover:scale-110 hover:brightness-105 transition duration-100"
                                title="Refresh files"
                                onClick={() => {
                                    setCancelRequested(true);
                                    setCaptionProgress(null);
                                    setCaptionResults(new Map());
                                    setSelectedFiles(new Set<string>());
                                    refreshFiles && refreshFiles();
                                }}
                            >
                                <RefreshCw size={18} />
                            </button>
                        </div>

                        {/* Main Content */}
                        <div class={`flex-6 relative flex flex-col overflow-hidden transition-all duration-700 delay-200 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                            <div class="relative bg-background-light-1/60 backdrop-blur-xl rounded-3xl border border-background-light-2/30 overflow-hidden h-full flex flex-col">
                                {loading() ? (
                                    // Show loading screen only for initial file loading
                                    <div class={`p-8 flex-1 flex flex-col transition-all duration-700 delay-300 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                                        <div class="flex flex-col items-center gap-6">
                                            <div class="relative">
                                                <div class="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                                <div class="absolute inset-2 w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin [animation-direction:reverse]"></div>
                                            </div>
                                            <div class="text-center">
                                                <div class="text-lg font-semibold text-text-dark-1 mb-2">Loading files...</div>
                                                <div class="w-48 h-2 bg-background-light-2 rounded-full overflow-hidden">
                                                    <div class="w-full h-full bg-gradient-to-r from-primary via-accent to-primary animate-[shimmer_2s_infinite]"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="mt-8 space-y-4">
                                            {[...Array(6)].map(() => (
                                                <FileSkeleton />
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    // Show file list (always visible when files are loaded)
                                    <div class={`flex flex-col h-full overflow-y-auto transition-all duration-700 delay-400 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                                        {/* Caption Generation Progress Banner */}
                                        {captionProgress() && (
                                            <div class="bg-gradient-to-r from-primary/10 to-accent/10 border-b border-primary/20 p-4">
                                                <div class="flex items-center justify-between">
                                                    <div class="flex items-center gap-3">
                                                        <div class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                                        <div>
                                                            <div class="text-sm font-semibold text-text-dark-1">
                                                                Generating captions... {captionProgress()!.processed}/{captionProgress()!.total}
                                                            </div>
                                                            {captionProgress()!.currentFile && (
                                                                <div class="text-xs text-text-dark-2">
                                                                    📝 {captionProgress()!.currentFile}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div class="w-32 h-2 bg-background-light-2 rounded-full overflow-hidden">
                                                        <div
                                                            class="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                                                            style={{ width: `${(captionProgress()!.processed / captionProgress()!.total) * 100}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div class="p-6 md:p-8 flex-shrink-0 overflow-y-auto">
                                            <div class="flex flex-col md:flex-row gap-4 md:items-center md:justify-between mb-4">
                                                {/* Selection Controls */}
                                                <div class="flex items-center gap-3">
                                                    <button
                                                        onClick={() => {
                                                            // Select all files from all pages, not just current page
                                                            const allFileNames = new Set(filteredFiles().map(f => f.name));
                                                            setSelectedFiles(allFileNames);
                                                        }}
                                                        class="px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg transition-colors"
                                                    >
                                                        Select All
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedFiles(new Set())}
                                                        class="px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors"
                                                    >
                                                        Deselect All
                                                    </button>
                                                    <div class="text-xs text-text-dark-2">
                                                        {selectedFiles().size} of {filteredFiles().length} selected
                                                    </div>
                                                </div>

                                                {/* Search and Filters */}
                                                <div class="flex-1">
                                                    <SearchAndFilters
                                                        searchTerm={searchTerm()}
                                                        onSearchChange={setSearchTerm}
                                                        sortBy={sortBy()}
                                                        sortDirection={sortDirection()}
                                                        onSortChange={handleSortChange}
                                                        typeFilter={typeFilter()}
                                                        onTypeFilterChange={setTypeFilter}
                                                        availableTypes={availableTypes()}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Files List */}
                                        <div class="flex-1 overflow-y-auto px-6 md:px-8">
                                            <div class="grid gap-3 pb-6">
                                                {paginatedFiles().length === 0 ? (
                                                    <div class="text-center py-12">
                                                        <Search size={48} class="mx-auto text-text-dark-2 mb-4" />
                                                        <p class="text-text-dark-2 text-lg">No files match your search criteria</p>
                                                    </div>
                                                ) : (
                                                    paginatedFiles().map((file) => {
                                                        // Find the actual index of this file in the complete files array
                                                        const actualIndex = files().findIndex(f => f.name === file.name);

                                                        // Determine state based on current conditions
                                                        let state: "previewing" | "compared" | "captioned" | "normal" = "normal";
                                                        const hasCaptionResult = captionResults().has(actualIndex);

                                                        if (captionProgress() && !hasCaptionResult) {
                                                            state = "previewing";
                                                        } else if (hasCaptionResult) {
                                                            state = "captioned";
                                                        } else if (comparisons().length > 0) {
                                                            state = "compared";
                                                        }

                                                        const captionResult = hasCaptionResult ? captionResults().get(actualIndex) : undefined;

                                                        // Selection handlers
                                                        const isSelected = selectedFiles().has(file.name);
                                                        const handleSelectionChange = (fileName: string, selected: boolean) => {
                                                            setSelectedFiles(prev => {
                                                                const newSet = new Set(prev);
                                                                if (selected) {
                                                                    newSet.add(fileName);
                                                                } else {
                                                                    newSet.delete(fileName);
                                                                }
                                                                return newSet;
                                                            });
                                                        };

                                                        return (
                                                            <div
                                                                tabIndex={-1}
                                                                class="hover:scale-102 transition-transform duration-200"
                                                                style={{ "will-change": "transform" }}
                                                                onMouseDown={e => e.preventDefault()}
                                                            >
                                                                <EnhancedFileItem
                                                                    key={file.name}
                                                                    fileName={file.name}
                                                                    state={state}
                                                                    folderPath={folderPath()}
                                                                    thumbnail={file.thumbnail}
                                                                    captionResult={captionResult}
                                                                    isSelected={isSelected}
                                                                    onSelectionChange={handleSelectionChange}
                                                                />
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>

                                        {/* Pagination */}
                                        <div class="flex-shrink-0 px-6 md:px-8 pb-6">
                                            {totalPages() > 1 && (
                                                <PaginationControls
                                                    currentPage={currentPage}
                                                    totalPages={totalPages}
                                                    onPageChange={setCurrentPage}
                                                    totalItems={filteredFiles().length}
                                                    itemsPerPage={itemsPerPage}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div class={`z-50 flex justify-center pointer-events-none w-full left-1/2 px-6 md:px-8 pb-6 transition-all duration-700 delay-500 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                                    <div class="relative group pointer-events-auto w-full flex justify-center gap-4">
                                        <Button
                                            variant="ghost"
                                            size="lg"
                                            onClick={handleBack}
                                            class="flex items-center gap-2 px-4 py-2 rounded-2xl border border-background-light-2/30 bg-background-light-1/60 hover:border-primary/30 text-text-dark-1 font-semibold"
                                        >
                                            <ArrowLeft size={18} />
                                            Back
                                        </Button>
                                        {/* Show Pause button only while captionProgress is active */}
                                        {!comparisons().length && captionProgress() ? (
                                            <Button
                                                variant="warning"
                                                size="lg"
                                                onClick={async () => {
                                                    setCancelRequested(true);
                                                    setCaptionProgress(null);
                                                    await fetch("http://localhost:5000/pause", { method: "POST" });
                                                    setToast({
                                                        message: "Caption generation paused. You can now apply changes to processed files.",
                                                        variant: "info",
                                                        duration: 3000
                                                    });
                                                }}
                                                disabled={captionProgress() === null}
                                                class="relative bg-gradient-to-r from-accent to-primary hover:from-accent-light-1 hover:to-primary-light-1 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <span class="flex items-center gap-2 w-full justify-center">
                                                    <GitCompare size={18} />
                                                    <span class="inline-block w-50 text-center">Pause</span>
                                                </span>
                                            </Button>
                                        ) : null}
                                        {!comparisons().length && captionResults().size === 0 ? (
                                            <Button
                                                variant="primary"
                                                size="lg"
                                                onClick={async () => {
                                                    setCancelRequested(false); // reset cancel flag
                                                    try {
                                                        setCaptionProgress({ processed: 0, total: files().length });
                                                        setCaptionResults(new Map());
                                                        setSelectedFiles(new Set<string>());
                                                        // Don't call handlePreview() here - let files update individually

                                                        const filePaths = files().map(f => folderPath() + '/' + f.name);
                                                        await sendFilesToServer(filePaths, (progressData) => {
                                                            if (cancelRequested()) return; // stop progress updates if cancelled
                                                            setCaptionProgress({
                                                                processed: progressData.processed,
                                                                total: progressData.total,
                                                                currentFile: progressData.fileName
                                                            });

                                                            // Store caption result for this file using the index from server
                                                            if ((progressData.caption || progressData.name) && typeof progressData.ind === 'number') {
                                                                setCaptionResults(prev => {
                                                                    const newMap = new Map(prev);
                                                                    newMap.set(progressData.ind, progressData.caption || progressData.name);
                                                                    return newMap;
                                                                });
                                                            }
                                                        });

                                                        setCaptionProgress(null);
                                                        refreshFiles && refreshFiles(); 
                                                    } catch (error) {
                                                        setCaptionProgress(null);
                                                        setToast({
                                                            message: "Could not reach the server. Please check your connection and try again.",
                                                            variant: "error",
                                                            duration: 5000
                                                        });
                                                        refreshFiles && refreshFiles();
                                                    }
                                                }}
                                                disabled={captionProgress() !== null || (!loading() && filteredFiles().length === 0)}
                                                class="relative bg-gradient-to-r from-primary to-accent hover:from-primary-light-1 hover:to-accent-light-1 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <span class="flex items-center gap-2 w-full justify-center">
                                                    {captionProgress() ? (
                                                        <>
                                                            <GitCompare size={18} />
                                                            <span class="inline-block w-50 text-center">
                                                                Processing {captionProgress()!.processed}/{captionProgress()!.total}...
                                                            </span>
                                                            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin ml-2"></div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <GitCompare size={18} />
                                                            <span class="inline-block w-50 text-center">Generate Preview</span>
                                                        </>
                                                    )}
                                                </span>
                                            </Button>
                                        ) : captionResults().size > 0 ? (
                                            <>
                                                <Button
                                                    variant="success"
                                                    size="lg"
                                                    onClick={async () => {
                                                        // Only apply to selected files that have a caption ("AFTER")
                                                        const filesToApply = Array.from(selectedFiles()).filter(fileName => {
                                                            const idx = files().findIndex(f => f.name === fileName);
                                                            return captionResults().has(idx);
                                                        });
                                                        if (filesToApply.length === 0) {
                                                            setToast({
                                                                message: "No selected files have generated captions to apply.",
                                                                variant: "warning",
                                                                duration: 3000
                                                            });
                                                            return;
                                                        }
                                                        // If handleApplyRenames expects no arguments, set selectedFiles to only those with captions
                                                        setSelectedFiles(new Set(filesToApply));
                                                        await handleApplyRenames();
                                                        setSelectedFiles(new Set<string>());
                                                        setCaptionResults(new Map());
                                                        setCaptionProgress(null);
                                                        refreshFiles && refreshFiles();
                                                    }}
                                                    disabled={selectedFiles().size === 0}
                                                    class="relative bg-gradient-to-r from-success to-accent hover:from-success/80 hover:to-accent/80 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <span class="flex items-center gap-2 w-full justify-center">
                                                        <Sparkles size={18} />
                                                        <span class="inline-block w-50 text-center">
                                                            Apply to {Array.from(selectedFiles()).filter(fileName => {
                                                                const idx = files().findIndex(f => f.name === fileName);
                                                                return captionResults().has(idx);
                                                            }).length} file{Array.from(selectedFiles()).filter(fileName => {
                                                                const idx = files().findIndex(f => f.name === fileName);
                                                                return captionResults().has(idx);
                                                            }).length !== 1 ? 's' : ''}
                                                        </span>
                                                    </span>
                                                </Button>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
}