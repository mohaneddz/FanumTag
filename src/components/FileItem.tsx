import PreviewingSkeleton from "@/components/PreviewingSkeleton";
import { useFileItem } from "@/hooks/useFileItem";
import Checkbox from "@/components/Checkbox";

interface FileItemProps {
  fileName: string;
  folderPath: string;
  key?: string; 
  state: "normal" | "previewing" | "compared" | "captioned";
  thumbnail?: string;
  captionResult?: string; // New prop for server caption results
  isSelected?: boolean;
  onSelectionChange?: (fileName: string, selected: boolean) => void;
}

export default function FileItem({ fileName, state, folderPath,  thumbnail, captionResult, isSelected, onSelectionChange }: FileItemProps) {

  // if state changed to normal, deselect the file
  if (state === "normal" && isSelected) {
    onSelectionChange?.(fileName, false);
  }

  const { getFileIconDisplay } = useFileItem();

  if (state === "previewing") {
    return (
      <div class="group relative">
        <div class="absolute inset-0 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-xl blur-lg group-hover:blur-xl transition-all duration-300"></div>
        <div class="relative bg-background-light-2/40 backdrop-blur-sm rounded-xl p-2 border border-background-light-2/30 flex items-center gap-2">
          {/* Checkbox */}
          <Checkbox
            checked={isSelected || false}
            onChange={(checked) => onSelectionChange?.(fileName, checked)}
          />
          <div class="w-8 h-8 flex items-center justify-center">
            {getFileIconDisplay(fileName, folderPath, thumbnail)}
          </div>
          <PreviewingSkeleton />
        </div>
      </div>
    );
  }

  if (state === "captioned" && captionResult) {
    return (
      <div class="group relative">
        <div class="absolute inset-0 bg-gradient-to-r from-success/10 via-primary/10 to-success/10 rounded-xl blur-lg group-hover:blur-xl transition-all duration-300"></div>
        <div class="relative bg-background-light-2/40 backdrop-blur-sm rounded-xl p-3 border border-background-light-2/30 hover:border-primary/30 transition-all duration-300 flex items-start gap-2">
          {/* Checkbox */}
          <Checkbox
            checked={isSelected || false}
            onChange={(checked) => onSelectionChange?.(fileName, checked)}
          />
          <div class="w-8 h-8 flex items-center justify-center flex-shrink-0">
            {getFileIconDisplay(fileName, folderPath, thumbnail)}
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-1 mb-2">
              <span class="font-mono text-text text-xs font-semibold">{fileName}</span>
              <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
            </div>
            <div class="relative group/after">
              <div class="absolute inset-0 bg-gradient-to-br from-success/20 to-success/30 rounded-lg blur-sm group-hover/after:blur-md transition-all duration-300"></div>
              <div class="relative bg-background-light-2/60 backdrop-blur-sm rounded-lg p-2 border border-success/30">
                <div class="flex items-center gap-1 mb-1">
                  <div class="w-2 h-2 bg-success rounded-full"></div>
                  <span class="text-xs font-bold text-success uppercase tracking-wide">Caption Generated</span>
                </div>
                <div class="text-xs text-text-dark-1 font-mono leading-relaxed">
                  {captionResult}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal state
  return (
    <div class="group relative">
      <div class="absolute inset-0 bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 rounded-xl blur-lg group-hover:blur-xl transition-all duration-300"></div>
      <div class="relative bg-background-light-2/40 backdrop-blur-sm rounded-xl p-2 border border-background-light-2/30 hover:border-primary/30 transition-all duration-300 transform flex items-center gap-2">
        <div class="w-8 h-8 flex items-center justify-center">
          {getFileIconDisplay(fileName, folderPath, thumbnail)}
        </div>
        <div class="flex-1">
          <span class="font-mono text-text text-xs font-semibold">{fileName}</span>
          <div class="text-xs text-text-dark-2 mt-1">Ready for preview</div>
        </div>
        <div class="w-2 h-2 bg-accent rounded-full animate-pulse"></div>
      </div>
    </div>
  );
}