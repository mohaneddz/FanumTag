import { createSignal, onMount } from "solid-js";
import { ArrowLeft, Info } from "lucide-solid";
import Button from "@/components/Button";
import { useNavigate } from "@solidjs/router";

export default function About() {

  const [isLoaded, setIsLoaded] = createSignal(false);

  const navigate = useNavigate();

  onMount(() => {
    setTimeout(() => setIsLoaded(true), 100);
  });

  const backToHome = () => {
    navigate("/");
  };

  return (
    <main class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background-light-1 to-background-dark-2">
      <div class="w-full max-w-xl">
        <div
          class={`relative group transition-all duration-500 ${isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
        >
          <div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/10 to-primary/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-300"></div>

          <div class="relative bg-background-light-1/80 backdrop-blur-xl rounded-3xl border border-background-light-2/30 p-8 shadow-2xl">
            <div class="text-center mb-8">
              <div
                class={`relative inline-block mb-4 transition-all duration-700 delay-100 ${isLoaded() ? "opacity-100 scale-100" : "opacity-0 scale-90"
                  }`}
              >
                <div class="absolute inset-0 bg-gradient-to-r from-primary to-accent rounded-2xl blur-lg"></div>
                <div class="relative w-20 h-20 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg">
                  <span class="text-white text-2xl font-bold"><Info size={32} class="text-white" /></span>
                </div>
              </div>
              <h1
                class={`text-3xl font-black bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent mb-2 transition-all duration-700 delay-200 ${isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
              >
                About FanumTag
              </h1>
              <p
                class={`text-text-dark-1 text-sm transition-all duration-700 delay-300 ${isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
              >
                More Manual and information about the project.
              </p>

              <h1 class="text-2xl font-black mt-8 text-accent">WHY??</h1>
              <p class="text-text-dark-1 text-sm transition-all duration-700 delay-300">
                FanumTag was created to simplify the process of extracting text from images and documents, making it accessible to everyone.
                I have always struggled to find THAT exact MEM-, I mean, document, and I thought, why not create a tool that can help with that?
              </p>

              <h1 class="text-2xl font-black mt-8 text-accent">HOW!!</h1>
              <p class="text-text-dark-1 text-sm transition-all duration-700 delay-300">
                FanumTag uses advanced OCR and VLM models to analyze images and extract text if found. as well as KeyBERT for document captioning.
                It supports multiple languages and can handle various image formats, making it versatile for different use cases.
              </p>

              <h1 class="text-2xl font-black mt-8 text-accent">WHO?!</h1>
              <p class="text-text-dark-1 text-sm transition-all duration-700 delay-300">
                asked?<br />
                <a href="https://github.com/mohaneddz" class="underline font-bold"> &nbsp;I did &nbsp;</a> 
              </p>

            </div>


            {/* Footer decoration */}
            <div
              class={`mt-2 pt-2 border-t border-background-light-2/30 transition-all duration-700 delay-800 ${isLoaded() ? "opacity-100" : "opacity-0"
                }`}
            >
              <div class="flex items-center justify-center gap-2">
                <span class="text-xs text-text-dark-2">
                  This project was made as a joke obviously (not really)
                </span>
                <div
                  style="animation-delay: 0.5s"
                ></div>
              </div>
            </div>

            {/* Back button */}
            <div
              class={`mt-6 flex justify-center w-full transition-all duration-700 delay-900 ${isLoaded() ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
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
          </div>
        </div>
      </div>
    </main>
  );
}
