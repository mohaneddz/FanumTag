import Button from "@/components/Button";
import { useNavigate } from "@solidjs/router";
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Info, Settings, Sparkles } from "lucide-solid";
import { createSignal, onMount } from "solid-js";

export default function Home() {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = createSignal(false);

  onMount(() => {
    setTimeout(() => setIsLoaded(true), 100);
    console.log(`HOME URL : ${window.location.href}`);
  });

  const learnAbout = () => {
    navigate("/about");
  }

  const goToSettings = () => {
    navigate("/settings");
  }

  const getFile = async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Select Folder",
    });

    if (typeof selected === 'string') {
      // navigate("/", { replace: true });
      setTimeout(() => {
        console.log(`Selected folder: ${selected}`);
        navigate(`/preview?folder=${encodeURIComponent(selected)}`);
      }, 0);
    }
  }

  return (
    <main class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background-light-1 to-background-dark-2">
      <div class="w-full max-w-md">
        {/* Main card */}
        <div class={`relative group transition-all duration-500 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          {/* Outer glow */}
          <div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-primary/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-300"></div>

          {/* Card container */}
          <div class="relative bg-background-light-1/80 backdrop-blur-xl rounded-3xl border border-background-light-2/30 p-8 shadow-2xl">
            {/* Header */}
            <div class="text-center mb-8">
              <div class={`relative inline-block mb-4 transition-all duration-700 delay-100 ${isLoaded() ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                <div class="absolute inset-0 bg-gradient-to-r from-primary to-accent rounded-2xl blur-lg"></div>
                <div class="relative w-20 h-20 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg">
                  <Sparkles size={32} class="text-white" />
                </div>
              </div>
              <h1 class={`text-3xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent mb-2 transition-all duration-700 delay-200 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                Welcome Back
              </h1>
              <p class={`text-text-dark-1 text-sm transition-all duration-700 delay-300 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                Choose an action to get started
              </p>
            </div>

            {/* Action buttons */}
            <div class="space-y-4">
              {/* Select Folder Button */}
              <div class={`relative group/button transition-all duration-700 delay-400 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                <div class="absolute inset-0 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 rounded-2xl blur-md group-hover/button:blur-lg transition-all duration-300"></div>
                <Button
                  onClick={getFile}
                  variant="primary"
                  class="w-full relative group/inner"
                  size="lg"
                >
                  <div class="flex items-center justify-center gap-3">
                    <FolderOpen size={20} class="group-hover/inner:scale-110 group-hover/inner:-rotate-10 transition-transform duration-300" />
                    <span>Select Folder</span>
                  </div>
                </Button>
              </div>

              {/* Settings Button */}
              <div class={`relative group/button transition-all duration-700 delay-500 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                <div class="absolute inset-0 bg-gradient-to-r from-info/20 via-info-light-1/20 to-info/20 rounded-2xl blur-md group-hover/button:blur-lg transition-all duration-300"></div>
                <Button
                  variant="info"
                  class="w-full relative group/inner"
                  size="lg"
                  onClick={goToSettings}
                >
                  <div class="flex items-center justify-center gap-3">
                    <Settings size={20} class="group-hover/inner:-rotate-40 transition-transform duration-300" />
                    <span>Settings</span>
                  </div>
                </Button>
              </div>

              {/* Back to Splash Button */}
              <div class={`relative group/button transition-all duration-700 delay-600 ${isLoaded() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                <div class="absolute inset-0 bg-gradient-to-r from-background-light-2/20 via-background-light-3/20 to-background-light-2/20 rounded-2xl blur-md group-hover/button:blur-lg transition-all duration-300"></div>
                <Button
                  onClick={learnAbout}
                  variant="ghost"
                  class="w-full relative group/inner border-2 border-background-light-2/30 hover:border-primary/30"
                  size="lg"
                >
                  <div class="flex items-center justify-center gap-3">
                    <Info size={20} class="group-hover/inner:scale-110 group-hover/inner:-rotate-10 transition-transform duration-300" />
                    <span>Learn About</span>
                  </div>
                </Button>
              </div>
            </div>

            {/* Footer decoration */}
            <div class={`mt-8 pt-6 border-t border-background-light-2/30 transition-all duration-700 delay-700 ${isLoaded() ? 'opacity-100' : 'opacity-0'}`}>
              <div class="flex items-center justify-center gap-2">
                <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span class="text-xs text-text-dark-2">Ready to clean up the messes :)</span>
                <div class="w-2 h-2 bg-accent rounded-full animate-pulse" style="animation-delay: 0.5s"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating action hints */}
        {/* Removed for performance. If you want, you can keep minimal decorations here. */}
      </div>
    </main>
  );
};