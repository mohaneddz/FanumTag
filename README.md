<h1 style="font-family: Arial, sans-serif; font-size: 36px; color: #77B3FF; display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #77B3FF; padding-bottom: 8px;">
  <img src="src-tauri/icons/128x128.png" alt="FanumTag Icon" style="height: 55px; width: 55px; object-fit: contain; border-radius: 8px;">
  FanumTag - Local-First AI File Renamer
</h1>

FanumTag is a local-first desktop rename workspace built with **Tauri (Rust) + SolidJS (TypeScript)**.
It runs local inference, generates structured rename suggestions, and applies safe bulk renames.

---

## Runtime Architecture

- Rust owns a singleton local runtime manager.
- The manager starts one bundled `llama-server.exe` process from `src-tauri/lib`.
- Vision weights are loaded from `src-tauri/weights`:
  - `Qwen2-VL-2B-Instruct-IQ2_M.gguf`
  - `mmproj-Qwen2-VL-2B-Instruct-f16.gguf`
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

- Folder queue preview with search/filter/pagination
- Batch suggestion generation (image/video/txt + deterministic fallback)
- Cancel support during active generation
- Safe native renames with collision handling and Windows-name validation

---

## Screenshots

<img src="screenshots/home.png" alt="FanumTag Home" width="88%"/>

<img src="screenshots/progress.png" alt="FanumTag Progress" width="88%"/>

<img src="screenshots/result.png" alt="FanumTag Results" width="88%"/>

---

## Development

```bash
pnpm install
pnpm tauri dev
```

## Checks

```bash
pnpm build
pnpm serve
```

## Notes

- Keep runtime and model paths local for privacy.
- No cloud dependency is required for default workflow.
