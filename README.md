# FanumTag

FanumTag is a local-first desktop file rename workspace built with Tauri (Rust) + SolidJS (TypeScript).

## Runtime Architecture

- Rust owns a singleton local runtime manager.
- The manager starts one bundled `llama-server.exe` process from `src-tauri/lib`.
- Vision weights are loaded from `src-tauri/weights`:
  - `Qwen2-VL-2B-Instruct-IQ2_M.gguf`
  - `mmproj-Qwen2-VL-2B-Instruct-f16.gguf`
- Frontend communicates only through Tauri commands/events.

## Core Commands

- `runtime_get_status`
- `runtime_get_config`
- `runtime_update_config`
- `runtime_start`
- `runtime_stop`
- `runtime_cancel_batch`
- `runtime_generate_batch`
- `apply_renames`

## Features

- Folder queue preview with search/filter/pagination
- Batch suggestion generation (image/video/txt + deterministic fallback)
- Stop/cancel support during active batch
- Safe native renames with collision handling and Windows-name validation
- Tailwind-first UI with runtime operational settings

## Development

```bash
pnpm install
pnpm tauri dev
```

## Checks

```bash
pnpm exec tsc --noEmit
pnpm build
cd src-tauri && cargo check
```

## Notes

- Windows-first runtime packaging is currently assumed because the bundled binaries are Windows artifacts.
- No Python backend is used or required.