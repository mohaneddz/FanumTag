import Button from "@/components/Button";
import PreviewHeader from "@/components/PreviewHeader";
import { ArrowLeft, Search, RefreshCw } from "lucide-solid";
import { usePreview } from "@/hooks/usePreview";
import Toast from "@/components/Toast";

import FileSkeleton from "@/components/FileSkeleton";
import EnhancedFileItem from "@/components/FileItem";
import PaginationControls from "@/components/PaginationControls";
import SearchAndFilters from "@/components/SearchAndFilters";
import { createSignal, onMount } from "solid-js";
import { sendFilesToServer } from "@/utils/image_caption_utils";
import { getPreviewButton, getStopButton, getApplyButton } from "@/tools/getButton";


export default function Preview() {
    const {
        loading,
        files,
        folderPath,
        searchTerm,
        typeFilter,
        currentPage,
        setSearchTerm,
        sortBy,
        sortDirection,
        setTypeFilter,
        setCurrentPage,
        availableTypes,
        filteredFiles,
        paginatedFiles,
        totalPages,
        handleApply,
        handleBack,
        handleSortChange,
        itemsPerPage,
        refreshFiles,
        captionProgress,
        setCaptionProgress,
        captionResults,
        setCaptionResults,
        selectedFiles,
        setSelectedFiles,
        toast,
        setToast,
        stopRequested,
        setStopRequested,
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
                                    setStopRequested(true);
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

                                {loading() ?

                                    (
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
                                    ) :

                                    (
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
                                                                // Only select files that have a caption result (processed)
                                                                const processedFileNames = new Set(
                                                                    filteredFiles()
                                                                        .filter(f => {
                                                                            const idx = files().findIndex(file => file.name === f.name);
                                                                            return captionResults().has(idx);
                                                                        })
                                                                        .map(f => f.name)
                                                                );
                                                                setSelectedFiles(processedFileNames);
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

                                        {/* Back button */}
                                        <Button
                                            variant="ghost"
                                            size="lg"
                                            onClick={handleBack}
                                            class="relative bg-gradient-to-r bg-transparent text-text-dark-1 font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
                                        >
                                            <span class="flex items-center gap-2 w-full justify-center">
                                                <ArrowLeft size={18} />
                                                <span class="inline-block w-50 text-center">Back</span>
                                            </span>
                                        </Button>

                                        {/* Generate Preview button (normal state) */}
                                        {!captionProgress() && captionResults().size === 0 && (
                                            getPreviewButton({
                                                setStopRequested, setCaptionProgress, setCaptionResults, setSelectedFiles, sendFilesToServer, folderPath, files, stopRequested, refreshFiles, setToast, captionProgress, loading, filteredFiles,
                                            })
                                        )}

                                        {/* Stop button (while processing) */}
                                        {captionProgress() && (
                                            getStopButton({ setStopRequested, captionProgress, setCaptionProgress, setToast, stopRequested })
                                        )}

                                        {/* Apply button (on success) */}
                                        {captionResults().size > 0 && !captionProgress() && (
                                            getApplyButton({ handleApply, selectedFiles, files, captionResults })
                                        )}
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