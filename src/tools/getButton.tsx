import Button from '@/components/Button';
import { GitCompare, Sparkles } from 'lucide-solid';

export function getPreviewButton(props: any) {

    return (
        <Button
            variant="primary"
            size="lg"
            onClick={async () => {
                props.setStopRequested(false);
                try {
                    props.setCaptionProgress({ processed: 0, total: props.files().length });
                    props.setCaptionResults(new Map());
                    props.setSelectedFiles(new Set<string>());
                    const filePaths = props.files().map((f: { name: string }) => props.folderPath() + '/' + f.name).sort((a:string, b:string) => a.localeCompare(b));
                    await props.sendFilesToServer(filePaths, (progressData: any) => {
                        if (props.stopRequested()) return;
                        props.setCaptionProgress({
                            processed: progressData.processed,
                            total: progressData.total,
                            currentFile: progressData.fileName
                        });
                        if ((progressData.caption || progressData.name) && typeof progressData.ind === 'number') {
                            props.setCaptionResults((prev: Map<number, string>) => {
                                const newMap = new Map(prev);
                                newMap.set(progressData.ind, progressData.caption || progressData.name);
                                return newMap;
                            });
                        }
                    });
                    props.setCaptionProgress(null);
                    props.refreshFiles && props.refreshFiles();
                } catch (error) {
                    props.setCaptionProgress(null);
                    props.setToast({
                        message: "Could not reach the server. Please check your connection and try again.",
                        variant: "error",
                        duration: 5000
                    });
                    props.refreshFiles && props.refreshFiles();
                }
            }}
            disabled={props.captionProgress() !== null || (!props.loading() && props.filteredFiles().length === 0)}
            class="relative bg-gradient-to-r from-primary to-accent hover:from-primary-light-1 hover:to-accent-light-1 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <span class="flex items-center gap-2 w-full justify-center">
                <GitCompare size={18} />
                <span class="inline-block w-50 text-center">Generate Preview</span>
            </span>
        </Button>
    );
};

export function getStopButton(props: any) {

    return (
        <Button
            variant="warning"
            size="lg"
            onClick={async () => {
                props.setStopRequested(true);
                props.setCaptionProgress(null);
                console.log(props.captionProgress());
                await fetch("http://localhost:5000/stop", { method: "POST" });
                props.setToast({
                    message: "Caption generation stopd. You can now apply changes to processed files.",
                    variant: "info",
                    duration: 3000
                });
            }}
            disabled={props.captionProgress() === null}
            class="relative bg-gradient-to-r from-accent to-primary hover:from-accent-light-1 hover:to-primary-light-1 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <span class="flex items-center gap-2 w-full justify-center">
                <GitCompare size={18} />
                <span class="inline-block w-50 text-center">Stop</span>
            </span>
        </Button>
    );
};

export function getApplyButton(props: any) {

    return (
        <Button
            variant="success"
            size="lg"
            onClick={props.handleApply}
            disabled={props.selectedFiles().size === 0}
            class="relative bg-gradient-to-r from-success to-accent hover:from-success/80 hover:to-accent/80 text-white font-bold py-3 px-6 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <span class="flex items-center gap-2 w-full justify-center">
                <Sparkles size={18} />
                <span class="inline-block w-50 text-center">
                    Apply to {Array.from(props.selectedFiles()).filter(fileName => {
                        const idx = props.files().findIndex((f: { name: string }) => f.name === fileName);
                        return props.captionResults().has(idx);
                    }).length} file{Array.from(props.selectedFiles()).filter(fileName => {
                        const idx = props.files().findIndex((f: { name: string }) => f.name === fileName);
                        return props.captionResults().has(idx);
                    }).length !== 1 ? 's' : ''}
                </span>
            </span>
        </Button>
    );
};
