export default function PreviewingSkeleton() {
    return (
      <div class="flex-1 space-y-1">
        <div class="h-3 bg-gradient-to-r from-background-light-2/50 to-background-light-3/50 rounded-lg animate-pulse" style={{ width: "70%" }}></div>
        <div class="grid grid-cols-2 gap-2">
          <div class="h-5 bg-gradient-to-r from-warning/20 to-warning/30 rounded-lg animate-pulse"></div>
          <div class="h-5 bg-gradient-to-r from-success/20 to-success/30 rounded-lg animate-pulse"></div>
        </div>
      </div>
    );
}