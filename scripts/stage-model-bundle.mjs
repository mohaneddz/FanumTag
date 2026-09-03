import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(projectRoot, "src-tauri", "weights");
const bundleDir = path.join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  "weights",
);

const modelFiles = [
  "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf",
  "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf",
  "mmproj-F16.gguf",
];

await mkdir(bundleDir, { recursive: true });

for (const filename of modelFiles) {
  const source = path.join(sourceDir, filename);
  const destination = path.join(bundleDir, filename);
  const sourceInfo = await stat(source);
  const destinationInfo = await stat(destination).catch(() => null);

  if (!destinationInfo || destinationInfo.size !== sourceInfo.size) {
    console.log(`Staging bundled model: ${filename}`);
    await copyFile(source, destination);
  }
}

console.log(`Bundled model sidecars are ready in ${bundleDir}`);
