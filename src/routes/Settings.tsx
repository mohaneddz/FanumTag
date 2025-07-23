import { createSignal, onMount } from "solid-js";
import { ArrowLeft, Cog, Download, Trash2 } from "lucide-solid";
import { useNavigate } from "@solidjs/router";
import Button from "@/components/Button";
import Dropdown from "@/components/Dropdown";
import Checkbox from "@/components/Checkbox";

export default function Settings() {
  const navigate = useNavigate();
  const [autoOCR, setAutoOCR] = createSignal(true);
  const [ocrLang, setOcrLang] = createSignal("auto");
  const [captionLang, setCaptionLang] = createSignal("en");
  const [models, setModels] = createSignal([
    { name: "OCR", value: "ocr", downloaded: false },
    { name: "Vision", value: "vision", downloaded: false },
    { name: "Document", value: "document", downloaded: false },
  ]);
  const [isLoaded, setIsLoaded] = createSignal(false);

  onMount(() => {
    setTimeout(() => setIsLoaded(true), 100);
  });

  // Download handler for a specific model
  const handleModelDownload = (idx: number) => {
    setModels((models) =>
      models.map((m, i) => (i === idx ? { ...m, downloaded: true } : m))
    );
    // Trigger backend download logic here
  };

  // Delete handler for a specific model
  const handleModelDelete = (idx: number) => {
    setModels((models) =>
      models.map((m, i) => (i === idx ? { ...m, downloaded: false } : m))
    );
    // Trigger backend delete logic here
  };

  const backToHome = () => {
    navigate("/");
  };

  return (
    <main class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background-light-1 to-background-dark-2">
      <div class="w-full max-w-md">
        <div
          class={`relative group transition-all duration-500 ${
            isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >

          <div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-primary/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-300"></div>
          <div class="relative bg-background-light-1/80 backdrop-blur-xl rounded-3xl border border-background-light-2/30 p-8 shadow-2xl">

            <div class="text-center mb-8">
              <div
                class={`relative inline-block mb-4 transition-all duration-700 delay-100 ${
                  isLoaded() ? "opacity-100 scale-100" : "opacity-0 scale-90"
                }`}
              >
                <div class="absolute inset-0 bg-gradient-to-r from-primary to-accent rounded-2xl blur-lg"></div>
                <div class="relative w-20 h-20 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg">
                  <span class="text-white text-2xl font-black"><Cog size={32} class="text-white"/></span>
                </div>
              </div>
              <h1
                class={`text-3xl font-black bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent mb-2 transition-all duration-700 delay-200 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
              >
                Settings
              </h1>
              <p
                class={`text-text-dark-1 text-sm transition-all duration-700 delay-300 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
              >
                Configure your preferences
              </p>
            </div>

            <form class="space-y-6">
              <div
                class={`transition-all duration-700 delay-400 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
              >
                <Checkbox
                  checked={autoOCR()}
                  onChange={setAutoOCR}
                  label="Automatic OCR Detection"
                />
              </div>

              {/* OCR Language Dropdown with custom arrow */}
              <div
                class={`transition-all duration-700 delay-500 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
              >
                <div class="relative">
                  <Dropdown
                    value={ocrLang()}
                    onChange={setOcrLang}
                    label="OCR Language"
                    options={[
                      { value: "auto", label: "Auto Detect" },
                      { value: "en", label: "English" },
                      { value: "ar", label: "Arabic" },
                    ]}
                  />
                  <span class="pointer-events-none absolute right-4 top-1/2 transform  text-text-dark-2">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </div>
              </div>

              {/* Caption Output Language Dropdown with custom arrow */}
              <div
                class={`transition-all duration-700 delay-600 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
              >
                <div class="relative">
                  <Dropdown
                    value={captionLang()}
                    onChange={setCaptionLang}
                    label="Caption Output Language"
                    options={[
                      { value: "en", label: "English" },
                    ]}
                  />
                  <span class="pointer-events-none absolute right-4 top-1/2 transform  text-text-dark-2">
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                      <path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </div>
              </div>

              {/* Model list */}
              <div
                class={`space-y-4 transition-all duration-700 delay-700 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
              >
                <div class="font-semibold text-lg mb-2">Models</div>
                {models().map((model, idx) => (
                  <div class="flex items-center justify-between bg-background-light-2/40 rounded-xl px-4 py-2">
                    <span class="font-medium">{model.name}</span>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class={`p-2 rounded-full hover:bg-primary/10 transition ${
                          model.downloaded
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        disabled={model.downloaded}
                        aria-label="Download"
                        onClick={() => handleModelDownload(idx)}
                      >
                        <Download size={18} />
                      </button>
                      <button
                        type="button"
                        class={`p-2 rounded-full hover:bg-accent/10 transition ${
                          !model.downloaded
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        disabled={!model.downloaded}
                        aria-label="Delete"
                        onClick={() => handleModelDelete(idx)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <span
                      class={`ml-4 text-xs ${
                        model.downloaded
                          ? "text-success"
                          : "text-text-dark-2"
                      }`}
                    >
                      {model.downloaded ? "Downloaded" : "Not downloaded"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Footer decoration */}
              <div
                class={`mt-8 pt-6 border-t border-background-light-2/30 transition-all duration-700 delay-800 ${
                  isLoaded() ? "opacity-100" : "opacity-0"
                }`}
              >
                <div class="flex items-center justify-center gap-2">
                  <span class="text-xs text-text-dark-2">
                    Settings page no work lul, if I see ppl need the product then I'll make it
                  </span>
                  <div
                    style="animation-delay: 0.5s"
                  ></div>
                </div>
              </div>

              {/* Back button */}
              <div
                class={`mt-6 flex justify-center w-full transition-all duration-700 delay-900 ${
                  isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                }`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  class="flex flex-nowrap items-center gap-2 px-4 py-2 rounded-xl border border-background-light-2/30 bg-background-light-1/60 hover:border-primary/30 text-text-dark-1 font-semibold"
                  onClick={backToHome}
                >
                  <ArrowLeft size={18} />
                  Back to Home
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
