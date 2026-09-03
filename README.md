![Fanum Tag](screenshots/cover.avif)

<h1 style="font-family: Arial, sans-serif; font-size: 36px; color: #77B3FF; display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #77B3FF; padding-bottom: 8px;">
  <img src="src-tauri/icons/128x128.png" alt="FanumTag Icon" style="height: 55px; width: 55px; object-fit: contain; border-radius: 8px;">
  FanumTag - Local-First AI File Renamer
</h1>

FanumTag is a local-first desktop rename workspace built with **Tauri (Rust) + SolidJS (TypeScript)**.
It scans a folder into a visual queue, uses local AI to suggest descriptive filenames, and applies safe bulk renames without uploading your files.

---

## Installation

FanumTag is currently distributed for 64-bit Windows. A complete packaged download
has this layout:

```text
FanumTag-windows-x64/
├── fanumtag_1.2.0_x64-setup.exe
└── weights/
    ├── Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf
    ├── Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf
    └── mmproj-F16.gguf
```

1. Download the complete Windows package and extract it if it is archived.
2. Keep `fanumtag_1.2.0_x64-setup.exe` beside the `weights` directory.
3. Run the installer. It verifies all three model files and copies them into the
   installed application automatically.
4. Open **Settings → Runtime Settings** and leave **Qwen Model Path** and
   **MMProj Model Path** empty to use the bundled defaults.
5. Start the runtime. The first Qwen shard automatically discovers the second
   shard in the same directory.

Do not run a detached copy of the installer: installation stops with a clear error
if its `weights` directory is missing. The complete package requires approximately
3.44 GiB of disk space before installation. A release without a Windows package
contains source code only and must be built using the development instructions below.

### Using custom weights

In **Settings → Runtime Settings**, use **Browse** to select another compatible
`.gguf` Qwen model or multimodal projector, then click **Save Configuration**. For
a sharded model, select the first shard and keep every shard together. Clear a path
and save to return to the bundled default. FanumTag checks that both selected files
exist when the runtime starts and reports the missing path if either cannot be found.

---

## Runtime Architecture

- Rust owns a singleton local runtime manager.
- The manager starts one bundled `llama-server.exe` process from `src-tauri/lib`.
- Vision weights are loaded from `src-tauri/weights`:
  - `Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf`
  - `Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf`
  - `mmproj-F16.gguf`
- Windows releases include the installer and a `weights` sidecar directory. The
  installer verifies and copies the model shards and projector into the installed
  app by default; keep the release folder together when distributing it. Users can
  override either installed path from Runtime Settings when they want another
  compatible model or projector. For a sharded custom model, select its first shard;
  llama.cpp discovers the remaining shards automatically.
- Frontend communicates through Tauri commands/events.

---

## Core Commands

- `runtime_get_status`
- `runtime_get_config`
- `runtime_update_config`
- `runtime_start`
- `runtime_stop`
- `runtime_cancel_batch`
- `runtime_generate_batch`
- `apply_renames`

---

## Features

- Workspace queue with folder quick access, subfolder browsing, thumbnails, search, sorting, filtering, and pagination
- Batch suggestions for images, videos, and text files, with deterministic fallback handling
- Live generation progress with per-file status, ready/pending counts, and a Stop control
- Selection tools for selecting all, selecting a page, selecting ready items, inverting a page, and keeping ready items
- Safe native renames with collision handling and Windows-name validation
- Runtime settings for host, port, threads, GPU layers, context size, request timeout, and auto-start
- Runtime health checks for bundled inference, Whisper, and FFmpeg dependencies

---

## Screenshots

### Empty workspace

Start by selecting a folder. The workspace provides quick access to common folders and keeps the selection and pagination panels ready for the queue.

<img src="screenshots/home.png" alt="FanumTag empty workspace" width="88%"/>

### Loaded queue

Review thumbnails and pending files before generating suggestions. The queue supports search, sorting, file-type filtering, subfolders, and page navigation.

<img src="screenshots/ready.png" alt="FanumTag loaded file queue" width="88%"/>

### Generating suggestions

Generation progress is shown in the workspace footer and in the per-file status column. You can stop an active batch at any time.

<img src="screenshots/working.png" alt="FanumTag generating rename suggestions" width="88%"/>

### Runtime settings

Configure the local runtime and check the health of its bundled dependencies from the Settings view.

<img src="screenshots/settings.png" alt="FanumTag runtime settings" width="88%"/>

---

## Development

```bash
pnpm install
pnpm tauri dev
```

Development expects the llama.cpp runtime files under `src-tauri/lib` and the three
GGUF files shown above under `src-tauri/weights`. These large local assets are ignored
by Git and are not included in GitHub's automatic source archives.

## Checks

```bash
pnpm build
pnpm serve
```

## Notes

- Keep runtime and model paths local for privacy.
- No cloud dependency is required for default workflow.
