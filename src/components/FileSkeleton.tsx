export default function FileSkeleton() {
    return (
        <div class="group relative">
            <div class="absolute inset-0 bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 rounded-xl blur-lg"></div>
            <div class="relative bg-background-light-2/40 backdrop-blur-sm rounded-xl p-3 border border-background-light-2/30 flex items-center gap-3">
                {/* Thumbnail skeleton */}
                <div class="w-12 h-12 bg-gradient-to-br from-background-light-2 to-background-light-3 rounded-lg animate-pulse"></div>

                {/* Content skeleton */}
                <div class="flex-1 space-y-2">
                    <div class="h-4 bg-gradient-to-r from-background-light-2 to-background-light-3 rounded animate-pulse" style={{ width: "60%" }}></div>
                    <div class="h-3 bg-gradient-to-r from-background-light-2/60 to-background-light-3/60 rounded animate-pulse" style={{ width: "40%" }}></div>
                </div>

                {/* Status dot skeleton */}
                <div class="w-3 h-3 bg-gradient-to-r from-accent/50 to-accent/70 rounded-full animate-pulse"></div>
            </div>
        </div>
    );
}