# FanumTag Project Documentation (Rust + TypeScript)

## Overview

FanumTag is a local desktop rename workspace. The app scans a folder, generates suggested names, lets users review, and safely applies renames.

## Stack

- Frontend: SolidJS + TypeScript + Tailwind
- Desktop shell: Tauri v2
- Backend runtime orchestration: Rust (`src-tauri/src/lib.rs`)

## Runtime Design

- Rust stores a singleton `RuntimeManager` in Tauri state (`Arc<Mutex<...>>`).
- Exactly one local `llama-server.exe` process is controlled by that manager.
- Runtime assets:
  - binaries: `src-tauri/lib`
  - model weights: `src-tauri/weights`
- Frontend does not call local HTTP directly; it invokes Tauri commands.

## Commands

- `runtime_get_status`
- `runtime_get_config`
- `runtime_update_config`
- `runtime_start`
- `runtime_stop`
- `runtime_cancel_batch`
- `runtime_generate_batch`
- `apply_renames`

## Batch Contract

Input:
- `{ ind, path, kind, videoFrameBase64? }`
- `kind`: `image | video | txt | fallback`

Output:
- `{ ind, suggestedName?, error?, source }`
- `source`: `model | fallback | skipped`

Progress event:
- `runtime://batch-progress`

## UI Routes

- `/` : Preview workspace
- `/settings` : runtime config + runtime operational controls
- `/about` : product summary

## Safety Guarantees

- One active batch at a time (`busy` guard)
- Cancel requests checked during batch processing
- Renames validated in Rust
- Collision-safe rename suffixing
- Windows reserved/invalid filename sanitization