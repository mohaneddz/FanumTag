use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use image::imageops::FilterType;
use image::ImageFormat;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use zip::read::ZipArchive;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const RUNTIME_ALIAS: &str = "qwen2-vl-local";
const RUNTIME_PROGRESS_EVENT: &str = "runtime://batch-progress";
const RUNTIME_COMPLETE_EVENT: &str = "runtime://batch-complete";
const MAX_TITLE_WORDS: usize = 8;
const WHISPER_MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const WHISPER_RELEASE_ZIP_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip";
const FFMPEG_RELEASE_ZIP_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    host: String,
    port: u16,
    threads: u16,
    gpu_layers: i32,
    ctx_size: u32,
    request_timeout_sec: u64,
    auto_start: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        let cpu_count = num_cpus::get().max(1);
        Self {
            host: "127.0.0.1".to_string(),
            port: 32123,
            threads: (cpu_count.min(16)) as u16,
            gpu_layers: 99,
            ctx_size: 8192,
            request_timeout_sec: 120,
            auto_start: false,
        }
    }
}

#[derive(Debug, Clone)]
struct RuntimeAssets {
    exe_path: PathBuf,
    lib_dir: PathBuf,
    model_path: PathBuf,
    mmproj_path: PathBuf,
}

#[derive(Debug, Clone)]
struct WhisperAssets {
    whisper_cli_path: PathBuf,
    ffmpeg_path: PathBuf,
    model_path: PathBuf,
    lib_dir: PathBuf,
    weights_dir: PathBuf,
}

/// Optional helper binaries for a batch. ffmpeg alone is enough for animated
/// images and video frames; whisper is only needed to read speech.
#[derive(Debug, Clone, Default)]
struct MediaAssets {
    ffmpeg_path: Option<PathBuf>,
    whisper: Option<WhisperAssets>,
}

#[derive(Debug)]
struct RuntimeManager {
    config: RuntimeConfig,
    child: Option<Child>,
    busy: bool,
    cancel_requested: bool,
    force_stop_requested: bool,
    /// ffmpeg / whisper processes currently running for the active batch, so a
    /// force stop can kill work that is already mid-flight.
    aux_children: Vec<(u64, Child)>,
    next_aux_id: u64,
    last_error: Option<String>,
}

impl RuntimeManager {
    fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
            child: None,
            busy: false,
            cancel_requested: false,
            force_stop_requested: false,
            aux_children: Vec::new(),
            next_aux_id: 0,
            last_error: None,
        }
    }
}

type SharedRuntime = Arc<Mutex<RuntimeManager>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    running: bool,
    busy: bool,
    cancel_requested: bool,
    pid: Option<u32>,
    last_error: Option<String>,
    binary_found: bool,
    model_found: bool,
    mmproj_found: bool,
    whisper_binary_found: bool,
    whisper_model_found: bool,
    ffmpeg_found: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBatchRequest {
    ind: usize,
    path: String,
    kind: String,
    video_frame_base64: Option<String>,
    filename_style: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBatchResult {
    ind: usize,
    suggested_name: Option<String>,
    error: Option<String>,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBatchProgress {
    processed: usize,
    total: usize,
    current_path: String,
    result: RuntimeBatchResult,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameRequest {
    old_path: String,
    suggested_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameResult {
    old_path: String,
    new_path: Option<String>,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProbeResult {
    response: String,
    elapsed_ms: u128,
}

fn normalize_runtime_config(mut config: RuntimeConfig) -> RuntimeConfig {
    config.host = "127.0.0.1".to_string();

    if config.port == 0 {
        config.port = 32123;
    }

    config.threads = config.threads.clamp(1, 64);
    config.gpu_layers = config.gpu_layers.clamp(-1, 200);
    config.ctx_size = config.ctx_size.clamp(2048, 65536);
    config.request_timeout_sec = config.request_timeout_sec.clamp(5, 900);

    config
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("runtime_config.json"))
}

fn load_runtime_config(app: &AppHandle) -> RuntimeConfig {
    let path = match config_file_path(app) {
        Ok(path) => path,
        Err(_) => return RuntimeConfig::default(),
    };

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return RuntimeConfig::default(),
    };

    serde_json::from_str::<RuntimeConfig>(&raw)
        .map(normalize_runtime_config)
        .unwrap_or_else(|_| RuntimeConfig::default())
}

fn save_runtime_config(app: &AppHandle, config: &RuntimeConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let normalized = normalize_runtime_config(config.clone());
    let raw = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn runtime_assets_candidates(app: &AppHandle) -> Vec<RuntimeAssets> {
    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = vec![RuntimeAssets {
        exe_path: manifest_root.join("lib").join("llama-server.exe"),
        lib_dir: manifest_root.join("lib"),
        model_path: manifest_root
            .join("weights")
            .join("Qwen2-VL-2B-Instruct-IQ2_M.gguf"),
        mmproj_path: manifest_root
            .join("weights")
            .join("mmproj-Qwen2-VL-2B-Instruct-f16.gguf"),
    }];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(RuntimeAssets {
            exe_path: resource_dir.join("lib").join("llama-server.exe"),
            lib_dir: resource_dir.join("lib"),
            model_path: resource_dir
                .join("weights")
                .join("Qwen2-VL-2B-Instruct-IQ2_M.gguf"),
            mmproj_path: resource_dir
                .join("weights")
                .join("mmproj-Qwen2-VL-2B-Instruct-f16.gguf"),
        });
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(RuntimeAssets {
            exe_path: cwd.join("src-tauri").join("lib").join("llama-server.exe"),
            lib_dir: cwd.join("src-tauri").join("lib"),
            model_path: cwd
                .join("src-tauri")
                .join("weights")
                .join("Qwen2-VL-2B-Instruct-IQ2_M.gguf"),
            mmproj_path: cwd
                .join("src-tauri")
                .join("weights")
                .join("mmproj-Qwen2-VL-2B-Instruct-f16.gguf"),
        });
    }

    candidates
}

fn base_path_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();

    if let Ok(app_local_data) = app.path().app_local_data_dir() {
        candidates.push(app_local_data.join("runtime-assets"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir);
    }

    candidates.push(manifest_root);

    candidates
}

fn whisper_assets_from_base(base: &Path) -> WhisperAssets {
    WhisperAssets {
        whisper_cli_path: base.join("lib").join("whisper-cli.exe"),
        ffmpeg_path: base.join("lib").join("ffmpeg.exe"),
        model_path: base.join("weights").join(WHISPER_MODEL_FILE),
        lib_dir: base.join("lib"),
        weights_dir: base.join("weights"),
    }
}

fn resolve_whisper_cli_path(lib_dir: &Path) -> Option<PathBuf> {
    let candidates = ["whisper-cli.exe", "main.exe", "whisper.exe"];
    candidates
        .iter()
        .map(|name| lib_dir.join(name))
        .find(|path| path.exists())
}

fn find_bundled_file(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    base_path_candidates(app)
        .into_iter()
        .map(|base| base.join(relative))
        .find(|candidate| candidate.exists())
}

fn resolve_whisper_assets(app: &AppHandle) -> Option<WhisperAssets> {
    for base in base_path_candidates(app) {
        let mut assets = whisper_assets_from_base(&base);
        let whisper_cli_path = match resolve_whisper_cli_path(&assets.lib_dir) {
            Some(path) => path,
            None => continue,
        };

        if assets.ffmpeg_path.exists() && assets.model_path.exists() {
            assets.whisper_cli_path = whisper_cli_path;
            return Some(assets);
        }
    }
    None
}

fn resolve_ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    base_path_candidates(app)
        .into_iter()
        .map(|base| base.join("lib").join("ffmpeg.exe"))
        .find(|candidate| candidate.exists())
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    match path.parent() {
        Some(parent) => fs::create_dir_all(parent).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

fn download_to_path(url: &str, destination: &Path) -> Result<(), String> {
    ensure_parent_dir(destination)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed ({}): {}", response.status(), url));
    }

    let mut output = File::create(destination).map_err(|e| e.to_string())?;
    response.copy_to(&mut output).map_err(|e| e.to_string())?;
    output.flush().map_err(|e| e.to_string())
}

fn unpack_zip_to_dir(zip_path: &Path, output_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for idx in 0..archive.len() {
        let mut entry = archive.by_index(idx).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.ends_with('/') {
            continue;
        }

        let leaf_name = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if leaf_name.is_empty() {
            continue;
        }
        let lower = leaf_name.to_ascii_lowercase();
        if !lower.ends_with(".exe") && !lower.ends_with(".dll") {
            continue;
        }

        let out_path = output_dir.join(leaf_name);
        let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Ensures ffmpeg alone is available. Frame extraction for animated images and
/// video only needs ffmpeg, not the much larger whisper speech model.
fn ensure_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(existing) = resolve_ffmpeg_path(app) {
        return Ok(existing);
    }

    let lib_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime-assets")
        .join("lib");
    fs::create_dir_all(&lib_dir).map_err(|e| e.to_string())?;

    let zip_path = lib_dir.join("ffmpeg-bin-x64.zip");
    download_to_path(FFMPEG_RELEASE_ZIP_URL, &zip_path)?;
    unpack_zip_to_dir(&zip_path, &lib_dir)?;
    let _ = fs::remove_file(&zip_path);

    let ffmpeg_path = lib_dir.join("ffmpeg.exe");
    if ffmpeg_path.exists() {
        Ok(ffmpeg_path)
    } else {
        Err("ffmpeg bootstrap finished but ffmpeg.exe was not found.".to_string())
    }
}

fn bootstrap_whisper_assets(app: &AppHandle) -> Result<WhisperAssets, String> {
    if let Some(existing) = resolve_whisper_assets(app) {
        return Ok(existing);
    }

    let writable_base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime-assets");

    let assets = whisper_assets_from_base(&writable_base);
    fs::create_dir_all(&assets.lib_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&assets.weights_dir).map_err(|e| e.to_string())?;

    if resolve_whisper_cli_path(&assets.lib_dir).is_none() {
        if let Some(bundled_zip) = find_bundled_file(app, "lib/whisper-bin-x64.zip") {
            unpack_zip_to_dir(&bundled_zip, &assets.lib_dir)?;
        } else {
            let zip_path = writable_base.join("lib").join("whisper-bin-x64.zip");
            download_to_path(WHISPER_RELEASE_ZIP_URL, &zip_path)?;
            unpack_zip_to_dir(&zip_path, &assets.lib_dir)?;
            let _ = fs::remove_file(&zip_path);
        }
    }

    let ffmpeg_path = ensure_ffmpeg(app)?;

    if !assets.model_path.exists() {
        download_to_path(WHISPER_MODEL_URL, &assets.model_path)?;
    }

    let whisper_cli_path = resolve_whisper_cli_path(&assets.lib_dir).ok_or_else(|| {
        "Whisper bootstrap finished but no whisper executable was found (expected whisper-cli.exe, main.exe, or whisper.exe).".to_string()
    })?;

    if !assets.model_path.exists() {
        return Err("Whisper bootstrap finished but the speech model is still missing.".to_string());
    }

    Ok(WhisperAssets {
        whisper_cli_path,
        ffmpeg_path,
        model_path: assets.model_path,
        lib_dir: assets.lib_dir,
        weights_dir: assets.weights_dir,
    })
}

fn resolve_runtime_assets(app: &AppHandle) -> Result<RuntimeAssets, String> {
    for candidate in runtime_assets_candidates(app) {
        if candidate.exe_path.exists()
            && candidate.lib_dir.exists()
            && candidate.model_path.exists()
            && candidate.mmproj_path.exists()
        {
            return Ok(candidate);
        }
    }

    Err("Could not resolve llama runtime assets (llama-server.exe, model, mmproj).".to_string())
}

fn prepend_path(lib_dir: &Path) -> Result<OsString, String> {
    let existing = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![lib_dir.to_path_buf()];
    paths.extend(std::env::split_paths(&existing));
    std::env::join_paths(paths).map_err(|e| e.to_string())
}

fn configure_process_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn spawn_runtime_process(assets: &RuntimeAssets, config: &RuntimeConfig) -> Result<Child, String> {
    let mut cmd = Command::new(&assets.exe_path);
    configure_process_command(&mut cmd);
    cmd.arg("--model")
        .arg(&assets.model_path)
        .arg("--mmproj")
        .arg(&assets.mmproj_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(config.port.to_string())
        .arg("--threads")
        .arg(config.threads.to_string())
        .arg("--ctx-size")
        .arg(config.ctx_size.to_string())
        .arg("--n-gpu-layers")
        .arg(config.gpu_layers.to_string())
        .arg("--alias")
        .arg(RUNTIME_ALIAS)
        .arg("--jinja")
        .arg("--no-webui")
        .arg("--no-warmup")
        .arg("--flash-attn")
        .current_dir(&assets.lib_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("PATH", prepend_path(&assets.lib_dir)?);

    cmd.spawn().map_err(|e| e.to_string())
}

fn runtime_health_url(config: &RuntimeConfig) -> String {
    format!("http://{}:{}/health", config.host, config.port)
}

fn runtime_models_url(config: &RuntimeConfig) -> String {
    format!("http://{}:{}/v1/models", config.host, config.port)
}

fn runtime_completion_url(config: &RuntimeConfig) -> String {
    format!("http://{}:{}/v1/chat/completions", config.host, config.port)
}

fn wait_for_runtime_health(config: &RuntimeConfig, timeout: Duration) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = Instant::now() + timeout;
    let health_url = runtime_health_url(config);
    let models_url = runtime_models_url(config);

    while Instant::now() < deadline {
        if let Ok(resp) = client.get(&health_url).send() {
            if resp.status().is_success() {
                return Ok(());
            }
        }

        if let Ok(resp) = client.get(&models_url).send() {
            if resp.status().is_success() {
                return Ok(());
            }
        }

        thread::sleep(Duration::from_millis(350));
    }

    Err("Timed out waiting for local runtime health.".to_string())
}

fn refresh_child_state(manager: &mut RuntimeManager) {
    let mut runtime_exited = None;

    if let Some(child) = manager.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                runtime_exited = Some(format!("Runtime exited with status {:?}", status.code()));
            }
            Ok(None) => {}
            Err(error) => {
                runtime_exited = Some(format!("Runtime process check failed: {}", error));
            }
        }
    }

    if let Some(error) = runtime_exited {
        manager.child = None;
        manager.busy = false;
        manager.cancel_requested = false;
        manager.last_error = Some(error);
    }
}

fn is_runtime_running_locked(manager: &mut RuntimeManager) -> bool {
    refresh_child_state(manager);
    manager.child.is_some()
}

fn stop_runtime_internal(shared: &SharedRuntime) -> Result<(), String> {
    let mut manager = shared.lock().map_err(|_| "Runtime lock poisoned".to_string())?;
    manager.cancel_requested = true;
    manager.busy = false;

    if let Some(mut child) = manager.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    manager.cancel_requested = false;
    Ok(())
}

/// Runs an auxiliary process (ffmpeg / whisper) while keeping its handle in the
/// manager, so a force stop can kill it instead of waiting for it to finish.
fn run_tracked_command(shared: &SharedRuntime, command: &mut Command) -> Result<bool, String> {
    let child = command.spawn().map_err(|e| e.to_string())?;

    let id = {
        let mut manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        let id = manager.next_aux_id;
        manager.next_aux_id = manager.next_aux_id.wrapping_add(1);
        manager.aux_children.push((id, child));
        id
    };

    loop {
        {
            let mut manager = shared
                .lock()
                .map_err(|_| "Runtime lock poisoned".to_string())?;

            let position = manager.aux_children.iter().position(|(cid, _)| *cid == id);

            let Some(position) = position else {
                // A force stop already reaped this child.
                return Err("Cancelled by user.".to_string());
            };

            if manager.force_stop_requested {
                let (_, mut child) = manager.aux_children.remove(position);
                let _ = child.kill();
                let _ = child.wait();
                return Err("Cancelled by user.".to_string());
            }

            match manager.aux_children[position].1.try_wait() {
                Ok(Some(status)) => {
                    manager.aux_children.remove(position);
                    return Ok(status.success());
                }
                Ok(None) => {}
                Err(error) => {
                    manager.aux_children.remove(position);
                    return Err(error.to_string());
                }
            }
        }

        thread::sleep(Duration::from_millis(80));
    }
}

fn force_stop_internal(shared: &SharedRuntime) -> Result<(), String> {
    let (mut aux_children, main_child) = {
        let mut manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.cancel_requested = true;
        manager.force_stop_requested = true;
        (
            std::mem::take(&mut manager.aux_children),
            manager.child.take(),
        )
    };

    for (_, child) in aux_children.iter_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }

    if let Some(mut child) = main_child {
        let _ = child.kill();
        let _ = child.wait();
    }

    let mut manager = shared
        .lock()
        .map_err(|_| "Runtime lock poisoned".to_string())?;
    manager.busy = false;
    manager.last_error = Some("Runtime was force stopped.".to_string());
    Ok(())
}

fn start_runtime_if_needed(app: &AppHandle, shared: &SharedRuntime) -> Result<(), String> {
    let config = {
        let mut manager = shared.lock().map_err(|_| "Runtime lock poisoned".to_string())?;
        if is_runtime_running_locked(&mut manager) {
            return Ok(());
        }

        manager.config.clone()
    };

    let assets = resolve_runtime_assets(app)?;
    let child = spawn_runtime_process(&assets, &config)?;

    {
        let mut manager = shared.lock().map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.child = Some(child);
        manager.last_error = None;
    }

    if let Err(error) = wait_for_runtime_health(&config, Duration::from_secs(45)) {
        let _ = stop_runtime_internal(shared);
        let mut manager = shared.lock().map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.last_error = Some(error.clone());
        return Err(error);
    }

    Ok(())
}

fn runtime_status_snapshot(app: &AppHandle, shared: &SharedRuntime) -> Result<RuntimeStatus, String> {
    let (running, busy, cancel_requested, pid, last_error) = {
        let mut manager = shared.lock().map_err(|_| "Runtime lock poisoned".to_string())?;
        refresh_child_state(&mut manager);

        (
            manager.child.is_some(),
            manager.busy,
            manager.cancel_requested,
            manager.child.as_ref().map(Child::id),
            manager.last_error.clone(),
        )
    };

    let assets = resolve_runtime_assets(app).ok();
    let whisper_assets = resolve_whisper_assets(app);

    Ok(RuntimeStatus {
        running,
        busy,
        cancel_requested,
        pid,
        last_error,
        binary_found: assets.as_ref().map(|a| a.exe_path.exists()).unwrap_or(false),
        model_found: assets.as_ref().map(|a| a.model_path.exists()).unwrap_or(false),
        mmproj_found: assets
            .as_ref()
            .map(|a| a.mmproj_path.exists())
            .unwrap_or(false),
        whisper_binary_found: whisper_assets
            .as_ref()
            .map(|a| a.whisper_cli_path.exists())
            .unwrap_or(false),
        whisper_model_found: whisper_assets
            .as_ref()
            .map(|a| a.model_path.exists())
            .unwrap_or(false),
        ffmpeg_found: whisper_assets
            .as_ref()
            .map(|a| a.ffmpeg_path.exists())
            .unwrap_or(false),
    })
}

fn build_client(timeout_sec: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_sec))
        .build()
        .map_err(|e| e.to_string())
}

fn deterministic_title_from_path(path: &Path, fallback: &str) -> String {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| fallback.to_string());

    let cleaned = sanitize_filename_base(&stem, fallback);
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

/// Connectives that read as truncation artifacts when the word limit cuts a
/// title mid-phrase ("Review Meeting Database Migration Timeline and").
const TRAILING_FILLER_WORDS: &[&str] = &[
    "and", "or", "the", "a", "an", "of", "for", "to", "in", "on", "with", "at", "by", "from", "as",
    "that", "this", "is", "are", "was", "were", "its", "their",
];

fn sanitize_filename_base_with_limit(raw: &str, fallback: &str, max_words: usize) -> String {
    let mut cleaned = raw
        .replace(['\r', '\n', '\t'], " ")
        .replace(['"', '\'', '`'], " ")
        .replace(['\\', '/', ':', '*', '?', '<', '>', '|'], " ");

    let mut words = cleaned
        .split_whitespace()
        .take(max_words.max(1))
        .collect::<Vec<_>>();

    while words.len() > 1 {
        let last = words[words.len() - 1]
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase();
        if TRAILING_FILLER_WORDS.contains(&last.as_str()) {
            words.pop();
        } else {
            break;
        }
    }

    cleaned = words.join(" ");
    cleaned = cleaned.trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        cleaned = fallback.to_string();
    }

    if is_windows_reserved_name(&cleaned) {
        cleaned.push_str(" file");
    }

    cleaned
}

fn sanitize_filename_base(raw: &str, fallback: &str) -> String {
    sanitize_filename_base_with_limit(raw, fallback, MAX_TITLE_WORDS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilenameStyle {
    Short,
    Average,
    Long,
}

impl FilenameStyle {
    fn from_input(input: Option<&str>) -> Self {
        match input.unwrap_or("average").trim().to_ascii_lowercase().as_str() {
            "short" => Self::Short,
            "long" => Self::Long,
            _ => Self::Average,
        }
    }

    fn max_words(self) -> usize {
        match self {
            Self::Short => 4,
            Self::Average => 8,
            Self::Long => 14,
        }
    }

    fn max_tokens(self) -> u16 {
        match self {
            Self::Short => 48,
            Self::Average => 80,
            Self::Long => 112,
        }
    }

    /// `subject` names the medium being described ("image", "video", ...) so the
    /// instruction reads correctly for whichever branch is calling it.
    fn prompt_instruction_for(self, subject: &str) -> String {
        let limit = match self {
            Self::Short => "a short filename title (max 4 words)",
            Self::Average => "a concise filename title (max 8 words)",
            Self::Long => "a detailed filename title (max 14 words)",
        };
        format!(
            "Generate {limit} that names the main subject and action or context of this {subject}. \
             Use plain descriptive words a person would use to file this. \
             Do not include phrases like 'image of', 'a recording of', or similar preambles. \
             Do not include a file extension. Return the title only, nothing else."
        )
    }

    fn prompt_instruction(self) -> String {
        self.prompt_instruction_for("image")
    }
}

fn is_windows_reserved_name(name: &str) -> bool {
    let upper = name.trim().to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Drops reasoning blocks entirely. Removing only the tags would leave the
/// model's private reasoning behind, and that text would become the filename.
fn strip_thinking_blocks(raw: &str) -> String {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";

    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;

    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + OPEN.len()..];

        match after_open.find(CLOSE) {
            Some(end) => rest = &after_open[end + CLOSE.len()..],
            // Unterminated block: everything that follows is reasoning.
            None => return out,
        }
    }

    out.push_str(rest);
    out
}

fn normalize_response_text(raw: &str, fallback: &str, max_words: usize) -> String {
    // A stray closing tag can appear without an opener when output is truncated.
    let cleaned = strip_thinking_blocks(raw).replace("</think>", " ").replace('"', " ");

    sanitize_filename_base_with_limit(&cleaned, fallback, max_words)
}

fn extract_openai_content(value: &Value) -> Option<String> {
    let content = value
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?;

    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    if let Some(items) = content.as_array() {
        let joined = items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" ");

        if joined.is_empty() {
            None
        } else {
            Some(joined)
        }
    } else {
        None
    }
}

fn chat_completion(client: &Client, config: &RuntimeConfig, messages: Value, max_tokens: u16) -> Result<String, String> {
    let request_payload = json!({
        "model": RUNTIME_ALIAS,
        "stream": false,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "messages": messages,
    });
    const MAX_LOADING_RETRIES: usize = 8;

    for attempt in 0..MAX_LOADING_RETRIES {
        let response = client
            .post(runtime_completion_url(config))
            .json(&request_payload)
            .send()
            .map_err(|e| e.to_string())?;

        if response.status().is_success() {
            let payload = response.json::<Value>().map_err(|e| e.to_string())?;
            return extract_openai_content(&payload)
                .ok_or_else(|| "Runtime returned an empty response.".to_string());
        }

        let status = response.status();
        let body = response.text().unwrap_or_default();
        let body_normalized = body.to_ascii_lowercase();
        let is_model_loading = status.as_u16() == 503
            && (body_normalized.contains("loading model")
                || body_normalized.contains("unavailable_error"));

        if is_model_loading && attempt + 1 < MAX_LOADING_RETRIES {
            let backoff_ms = 400_u64 + (attempt as u64 * 600_u64);
            thread::sleep(Duration::from_millis(backoff_ms.min(4_000)));
            continue;
        }

        let body_text = if body.trim().is_empty() {
            "<empty response body>".to_string()
        } else {
            body
        };
        return Err(format!("Runtime generation failed ({}): {}", status, body_text));
    }

    Err("Runtime generation failed after retrying model warmup.".to_string())
}

fn generate_title_from_image(
    client: &Client,
    config: &RuntimeConfig,
    image_base64: &str,
    style: FilenameStyle,
) -> Result<String, String> {
    generate_title_from_image_data_url(client, config, "image/jpeg", image_base64, style)
}

fn generate_title_from_image_data_url(
    client: &Client,
    config: &RuntimeConfig,
    mime: &str,
    image_base64: &str,
    style: FilenameStyle,
) -> Result<String, String> {
    chat_completion(
        client,
        config,
        json!([
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": style.prompt_instruction()
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", mime, image_base64)
                        }
                    }
                ]
            }
        ]),
        style.max_tokens(),
    )
}

fn encode_image_file_to_jpeg_base64(path: &Path) -> Result<String, String> {
    let image = image::open(path).map_err(|e| format!("Unsupported image format: {}", e))?;
    let mut rgb = image.to_rgb8();

    let (width, height) = rgb.dimensions();
    const MAX_DIM: u32 = 896;
    if width > MAX_DIM || height > MAX_DIM {
        let scale = (MAX_DIM as f32 / width as f32).min(MAX_DIM as f32 / height as f32);
        let next_w = ((width as f32 * scale).round() as u32).max(1);
        let next_h = ((height as f32 * scale).round() as u32).max(1);
        rgb = image::imageops::resize(&rgb, next_w, next_h, FilterType::Lanczos3);
    }

    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(rgb)
        .write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode image: {}", e))?;

    Ok(BASE64.encode(out))
}

fn encode_image_file_to_jpeg_base64_via_ffmpeg(
    shared: &SharedRuntime,
    path: &Path,
    ffmpeg_path: &Path,
) -> Result<String, String> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let frame_path = std::env::temp_dir().join(format!(
        "fanumtag-image-{}-{}.jpg",
        std::process::id(),
        now_nanos
    ));

    let mut command = Command::new(ffmpeg_path);
    configure_process_command(&mut command);
    command
        .arg("-y")
        .arg("-i")
        .arg(path)
        .arg("-vf")
        .arg("scale='min(896,iw)':-2")
        .arg("-frames:v")
        .arg("1")
        .arg(&frame_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let success = run_tracked_command(shared, &mut command)?;

    if !success || !frame_path.exists() {
        let _ = fs::remove_file(&frame_path);
        return Err("ffmpeg image conversion failed.".to_string());
    }

    let bytes = fs::read(&frame_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&frame_path);
    Ok(BASE64.encode(bytes))
}

fn path_has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            extensions
                .iter()
                .any(|candidate| value.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

/// Formats that carry animation and should be sampled by ffmpeg rather than
/// decoded as a single still frame.
fn image_is_animated_container(path: &Path) -> bool {
    path_has_extension(path, &["gif", "webp", "apng", "avif"])
}

fn generate_title_from_text(
    client: &Client,
    config: &RuntimeConfig,
    text: &str,
    style: FilenameStyle,
) -> Result<String, String> {
    let snippet = text.chars().take(5000).collect::<String>();
    let max_words = style.max_words();
    chat_completion(
        client,
        config,
        json!([
            {
                "role": "user",
                "content": format!(
                    "Generate a filename title (max {} words) for this text content. Keep it informative and natural, using plain descriptive words a person would use to file this. Do not include a file extension or phrases like 'text about'. Return the title only.\\n\\n{}",
                    max_words, snippet
                )
            }
        ]),
        style.max_tokens(),
    )
}

fn generate_title_from_video_context(
    client: &Client,
    config: &RuntimeConfig,
    frame_base64: &str,
    transcript: Option<&str>,
    style: FilenameStyle,
) -> Result<String, String> {
    let context_text = match transcript.map(str::trim).filter(|v| !v.is_empty()) {
        Some(text) => format!(
            "{} Use both the visual scene and speech transcript to produce the filename title.\nTranscript:\n{}",
            style.prompt_instruction_for("video"),
            text.chars().take(5000).collect::<String>()
        ),
        None => format!(
            "{} Use visual scene details to produce the filename title.",
            style.prompt_instruction_for("video")
        ),
    };

    chat_completion(
        client,
        config,
        json!([
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": context_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/jpeg;base64,{}", frame_base64)
                        }
                    }
                ]
            }
        ]),
        style.max_tokens(),
    )
}

fn generate_title_from_audio_transcript(
    client: &Client,
    config: &RuntimeConfig,
    transcript: &str,
    style: FilenameStyle,
) -> Result<String, String> {
    let snippet = transcript.chars().take(5000).collect::<String>();
    chat_completion(
        client,
        config,
        json!([
            {
                "role": "user",
                "content": format!(
                    "{} Use this transcript to produce an informative filename title. Return title only.\n\n{}",
                    style.prompt_instruction_for("audio recording"),
                    snippet
                )
            }
        ]),
        style.max_tokens(),
    )
}

fn extract_audio_wav(
    shared: &SharedRuntime,
    media_path: &Path,
    ffmpeg_path: &Path,
    output_wav: &Path,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg_path);
    configure_process_command(&mut command);
    command
        .arg("-y")
        .arg("-i")
        .arg(media_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("wav")
        .arg(output_wav)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let success = run_tracked_command(shared, &mut command)?;

    if success && output_wav.exists() {
        Ok(())
    } else {
        Err("ffmpeg audio extraction failed.".to_string())
    }
}

/// Picks a representative frame from any animated source (video or animated
/// GIF/WebP) rather than the first frame, which is very often black or a fade-in.
fn extract_representative_frame_base64(
    shared: &SharedRuntime,
    media_path: &Path,
    ffmpeg_path: &Path,
) -> Result<String, String> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let frame_path = std::env::temp_dir().join(format!(
        "fanumtag-frame-{}-{}.jpg",
        std::process::id(),
        now_nanos
    ));

    let mut command = Command::new(ffmpeg_path);
    configure_process_command(&mut command);
    command
        .arg("-y")
        .arg("-i")
        .arg(media_path)
        .arg("-an")
        .arg("-sn")
        .arg("-vf")
        .arg("thumbnail=300,scale='min(896,iw)':-2")
        .arg("-frames:v")
        .arg("1")
        .arg(&frame_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let success = run_tracked_command(shared, &mut command)?;

    if !success || !frame_path.exists() {
        let _ = fs::remove_file(&frame_path);
        return Err("ffmpeg frame extraction failed.".to_string());
    }

    let bytes = fs::read(&frame_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&frame_path);
    Ok(BASE64.encode(bytes))
}

fn transcribe_media_with_whisper(
    shared: &SharedRuntime,
    media_path: &Path,
    whisper: &WhisperAssets,
) -> Result<String, String> {
    let temp_root = std::env::temp_dir();
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let stamp = format!(
        "fanumtag-whisper-{}-{}",
        std::process::id(),
        now_nanos
    );
    let wav_path = temp_root.join(format!("{}.wav", stamp));
    let out_prefix = temp_root.join(stamp);
    let out_txt = out_prefix.with_extension("txt");

    extract_audio_wav(shared, media_path, &whisper.ffmpeg_path, &wav_path)?;

    let run_whisper = |args: &[&str]| -> Result<bool, String> {
        let mut command = Command::new(&whisper.whisper_cli_path);
        configure_process_command(&mut command);
        command
            .arg("-m")
            .arg(&whisper.model_path)
            .arg("-f")
            .arg(&wav_path);
        for arg in args {
            command.arg(arg);
        }
        command
            .arg("-l")
            .arg("auto")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .current_dir(&whisper.lib_dir);

        run_tracked_command(shared, &mut command)
    };

    let primary_ok = run_whisper(&["--output-txt", "--output-file", out_prefix.to_string_lossy().as_ref(), "-nt"])?;
    let secondary_ok = if primary_ok {
        false
    } else {
        run_whisper(&["-otxt", "-of", out_prefix.to_string_lossy().as_ref(), "-nt"])?
    };
    let tertiary_ok = if primary_ok || secondary_ok {
        false
    } else {
        run_whisper(&["-otxt", "-of", out_prefix.to_string_lossy().as_ref()])?
    };

    let _ = fs::remove_file(&wav_path);

    if !(primary_ok || secondary_ok || tertiary_ok) || !out_txt.exists() {
        let _ = fs::remove_file(&out_txt);
        return Err("whisper-cli transcription failed.".to_string());
    }

    let transcript = fs::read_to_string(&out_txt).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&out_txt);

    let cleaned = transcript.trim().to_string();
    if cleaned.is_empty() {
        Err("whisper transcription is empty.".to_string())
    } else {
        Ok(cleaned)
    }
}

fn process_batch_item(
    shared: &SharedRuntime,
    client: &Client,
    config: &RuntimeConfig,
    media: &MediaAssets,
    request: &RuntimeBatchRequest,
) -> RuntimeBatchResult {
    let path = PathBuf::from(&request.path);
    if request.path.trim().is_empty() {
        return RuntimeBatchResult {
            ind: request.ind,
            suggested_name: None,
            error: Some("Missing path".to_string()),
            source: "skipped".to_string(),
        };
    }

    if !path.exists() {
        return RuntimeBatchResult {
            ind: request.ind,
            suggested_name: None,
            error: Some("File not found".to_string()),
            source: "skipped".to_string(),
        };
    }

    let fallback = deterministic_title_from_path(&path, "File");
    let kind = request.kind.trim().to_ascii_lowercase();
    let style = FilenameStyle::from_input(request.filename_style.as_deref());

    let model_result = match kind.as_str() {
        "image" => {
            let ffmpeg = media.ffmpeg_path.as_deref();

            // Animated sources (GIF and friends) get a representative frame from
            // ffmpeg; decoding them as a still yields frame 1, which is often blank.
            let animated_frame = if image_is_animated_container(&path) {
                ffmpeg.and_then(|ffmpeg_path| {
                    extract_representative_frame_base64(shared, &path, ffmpeg_path).ok()
                })
            } else {
                None
            };

            match animated_frame {
                Some(base64) => generate_title_from_image(client, config, &base64, style),
                None => match encode_image_file_to_jpeg_base64(&path) {
                    Ok(base64) => generate_title_from_image(client, config, &base64, style),
                    Err(primary_error) => match ffmpeg {
                        Some(ffmpeg_path) => {
                            match encode_image_file_to_jpeg_base64_via_ffmpeg(shared, &path, ffmpeg_path) {
                                Ok(base64) => generate_title_from_image(client, config, &base64, style),
                                Err(ffmpeg_error) => Err(format!(
                                    "{}; ffmpeg fallback failed: {}",
                                    primary_error, ffmpeg_error
                                )),
                            }
                        }
                        None => Err(format!(
                            "{}; ffmpeg is unavailable for conversion fallback",
                            primary_error
                        )),
                    },
                },
            }
        }
        "video" => {
            let ffmpeg_path = match media.ffmpeg_path.as_deref() {
                Some(path) => path,
                None => return RuntimeBatchResult {
                    ind: request.ind,
                    suggested_name: Some(fallback),
                    error: Some("ffmpeg is missing for video processing".to_string()),
                    source: "fallback".to_string(),
                },
            };

            // Speech is optional: a video still names well from its visuals alone.
            let transcript = media
                .whisper
                .as_ref()
                .and_then(|whisper| transcribe_media_with_whisper(shared, &path, whisper).ok());

            let frame = extract_representative_frame_base64(shared, &path, ffmpeg_path)
                .or_else(|_| {
                    request
                        .video_frame_base64
                        .clone()
                        .ok_or_else(|| "Missing extracted video frame".to_string())
                });

            match (frame, transcript.as_deref()) {
                (Ok(frame_base64), maybe_text) => generate_title_from_video_context(
                    client,
                    config,
                    &frame_base64,
                    maybe_text,
                    style,
                ),
                (Err(_), Some(text)) => generate_title_from_audio_transcript(client, config, text, style),
                (Err(error), None) => Err(error),
            }
        }
        "audio" => {
            let whisper = match media.whisper.as_ref() {
                Some(assets) => assets,
                None => return RuntimeBatchResult {
                    ind: request.ind,
                    suggested_name: Some(fallback),
                    error: Some("Speech model is missing for audio processing".to_string()),
                    source: "fallback".to_string(),
                },
            };

            transcribe_media_with_whisper(shared, &path, whisper)
                .and_then(|text| generate_title_from_audio_transcript(client, config, &text, style))
        }
        "txt" => fs::read_to_string(&path)
            .or_else(|_| {
                fs::read(&path).map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            })
            .map_err(|e| e.to_string())
            .and_then(|text| {
                if text.trim().is_empty() {
                    Err("Text file is empty".to_string())
                } else {
                    generate_title_from_text(client, config, &text, style)
                }
            }),
        _ => Err("Fallback-only file kind".to_string()),
    };

    match model_result {
        Ok(raw_name) => {
            let cleaned = normalize_response_text(&raw_name, &fallback, style.max_words());
            RuntimeBatchResult {
                ind: request.ind,
                suggested_name: Some(cleaned),
                error: None,
                source: "model".to_string(),
            }
        }
        Err(error) => RuntimeBatchResult {
            ind: request.ind,
            suggested_name: Some(fallback),
            error: if kind == "fallback" {
                None
            } else {
                Some(error)
            },
            source: "fallback".to_string(),
        },
    }
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
}

fn path_extension(path: &Path) -> String {
    match path.extension().map(|ext| ext.to_string_lossy().to_string()) {
        Some(ext) if !ext.is_empty() => format!(".{}", ext),
        _ => String::new(),
    }
}

fn unique_target_path(
    directory: &Path,
    base_name: &str,
    extension: &str,
    source_path: &Path,
    booked: &HashSet<String>,
) -> PathBuf {
    let mut counter = 0_u32;

    loop {
        let suffix = if counter == 0 {
            String::new()
        } else {
            format!("_{}", counter)
        };

        let candidate = directory.join(format!("{}{}{}", base_name, suffix, extension));

        if normalize_path_key(&candidate) == normalize_path_key(source_path) {
            return candidate;
        }

        if !candidate.exists() && !booked.contains(&normalize_path_key(&candidate)) {
            return candidate;
        }

        counter += 1;
    }
}

fn apply_rename_items(requests: Vec<RenameRequest>) -> Vec<RenameResult> {
    let mut booked_paths: HashSet<String> = HashSet::new();
    let mut results = Vec::with_capacity(requests.len());

    for request in requests {
        let source_path = PathBuf::from(&request.old_path);

        if !source_path.exists() {
            results.push(RenameResult {
                old_path: request.old_path,
                new_path: None,
                status: "error".to_string(),
                error: Some("Source file was not found".to_string()),
            });
            continue;
        }

        let directory = match source_path.parent() {
            Some(path) => path,
            None => {
                results.push(RenameResult {
                    old_path: request.old_path,
                    new_path: None,
                    status: "error".to_string(),
                    error: Some("Could not resolve source directory".to_string()),
                });
                continue;
            }
        };

        let extension = path_extension(&source_path);
        let source_stem = source_path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let mut requested = request.suggested_name.trim().to_string();
        if !extension.is_empty() && requested.to_ascii_lowercase().ends_with(&extension.to_ascii_lowercase()) {
            requested = requested[..requested.len() - extension.len()].to_string();
        }

        let base_name = sanitize_filename_base(&requested, &source_stem);
        let target_path = unique_target_path(directory, &base_name, &extension, &source_path, &booked_paths);

        if normalize_path_key(&target_path) == normalize_path_key(&source_path) {
            results.push(RenameResult {
                old_path: request.old_path,
                new_path: Some(target_path.to_string_lossy().to_string()),
                status: "skipped".to_string(),
                error: None,
            });
            continue;
        }

        match fs::rename(&source_path, &target_path) {
            Ok(_) => {
                booked_paths.insert(normalize_path_key(&target_path));
                results.push(RenameResult {
                    old_path: request.old_path,
                    new_path: Some(target_path.to_string_lossy().to_string()),
                    status: "renamed".to_string(),
                    error: None,
                });
            }
            Err(error) => {
                results.push(RenameResult {
                    old_path: request.old_path,
                    new_path: None,
                    status: "error".to_string(),
                    error: Some(error.to_string()),
                });
            }
        }
    }

    results
}

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "bmp", "gif", "tiff", "webp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "avi", "mov", "mkv", "webm", "wmv", "flv", "m4v"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "opus"];
const TEXT_EXTENSIONS: &[&str] = &["txt"];

const THUMBNAIL_MAX_WIDTH: u32 = 320;
const THUMBNAIL_MAX_HEIGHT: u32 = 192;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderEntry {
    name: String,
    path: String,
    extension: String,
    kind: String,
    filter_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderListing {
    files: Vec<FolderEntry>,
    subfolders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailResult {
    path: String,
    data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHealth {
    running: bool,
    busy: bool,
    responsive: bool,
    last_error: Option<String>,
}

fn classify_extension(extension: &str) -> (&'static str, &'static str) {
    let lower = extension.to_ascii_lowercase();
    let lower = lower.trim_start_matches('.');

    if IMAGE_EXTENSIONS.contains(&lower) {
        ("image", "image")
    } else if VIDEO_EXTENSIONS.contains(&lower) {
        ("video", "video")
    } else if AUDIO_EXTENSIONS.contains(&lower) {
        ("audio", "audio")
    } else if TEXT_EXTENSIONS.contains(&lower) {
        ("txt", "text")
    } else {
        ("fallback", "other")
    }
}

/// Lists a folder natively. Doing this in Rust keeps folders with thousands of
/// files responsive: nothing but names crosses the IPC boundary.
#[tauri::command]
fn list_folder(app: AppHandle, path: String) -> Result<FolderListing, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", path));
    }
    // The webview can only stream media from folders the user has opened.
    // This keeps the asset protocol scoped while allowing modal playback.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|error| error.to_string())?;

    let mut files: Vec<FolderEntry> = Vec::new();
    let mut subfolders: Vec<String> = Vec::new();

    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() {
            continue;
        }

        if file_type.is_dir() {
            subfolders.push(entry_path.to_string_lossy().to_string());
            continue;
        }

        let extension = entry_path
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy().to_ascii_lowercase()))
            .unwrap_or_default();
        let (kind, filter_type) = classify_extension(&extension);

        files.push(FolderEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            extension,
            kind: kind.to_string(),
            filter_type: filter_type.to_string(),
        });
    }

    files.sort_by_key(|entry| entry.name.to_lowercase());
    subfolders.sort_by_key(|entry| entry.to_lowercase());

    Ok(FolderListing { files, subfolders })
}

fn generate_thumbnail_data_url(path: &Path) -> Result<String, String> {
    let image = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;

    let thumbnail = image.thumbnail(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT);

    let mut buffer = Vec::new();
    image::DynamicImage::ImageRgb8(thumbnail.to_rgb8())
        .write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(buffer)))
}

fn generate_video_thumbnail_data_url(path: &Path, ffmpeg_path: &Path) -> Result<String, String> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let frame_path = std::env::temp_dir().join(format!(
        "fanumtag-thumbnail-{}-{}.jpg",
        std::process::id(),
        now_nanos
    ));

    let mut command = Command::new(ffmpeg_path);
    configure_process_command(&mut command);
    command
        .arg("-y")
        .arg("-i")
        .arg(path)
        .arg("-an")
        .arg("-sn")
        .arg("-vf")
        .arg("thumbnail=120,scale=320:-2:force_original_aspect_ratio=decrease")
        .arg("-frames:v")
        .arg("1")
        .arg(&frame_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let result = command.status().map_err(|error| error.to_string());
    if !matches!(result, Ok(status) if status.success()) || !frame_path.exists() {
        let _ = fs::remove_file(&frame_path);
        return Err("ffmpeg thumbnail extraction failed.".to_string());
    }

    let thumbnail = generate_thumbnail_data_url(&frame_path);
    let _ = fs::remove_file(&frame_path);
    thumbnail
}

/// Decodes thumbnails in parallel on native threads. The frontend only asks for
/// the page it is showing, so this stays bounded no matter how large the folder is.
#[tauri::command]
async fn generate_thumbnails(app: AppHandle, paths: Vec<String>) -> Result<Vec<ThumbnailResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Provision ffmpeg once when this page contains video files, then let
        // the workers extract their frame previews in parallel.
        let ffmpeg_path = if paths.iter().any(|path| {
            let extension = Path::new(path)
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy().to_ascii_lowercase()))
                .unwrap_or_default();
            classify_extension(&extension).0 == "video"
        }) {
            ensure_ffmpeg(&app).ok()
        } else {
            None
        };
        let slots: Vec<Mutex<Option<String>>> = paths.iter().map(|_| Mutex::new(None)).collect();
        let cursor = AtomicUsize::new(0);
        let workers = num_cpus::get().clamp(1, 8).min(paths.len().max(1));

        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| loop {
                    let index = cursor.fetch_add(1, Ordering::Relaxed);
                    if index >= paths.len() {
                        break;
                    }

                    let path = Path::new(&paths[index]);
                    let extension = path
                        .extension()
                        .map(|value| format!(".{}", value.to_string_lossy().to_ascii_lowercase()))
                        .unwrap_or_default();
                    let value = if classify_extension(&extension).0 == "video" {
                        ffmpeg_path
                            .as_deref()
                            .and_then(|ffmpeg| generate_video_thumbnail_data_url(path, ffmpeg).ok())
                    } else {
                        generate_thumbnail_data_url(path).ok()
                    };
                    if let Ok(mut slot) = slots[index].lock() {
                        *slot = value;
                    }
                });
            }
        });

        paths
            .into_iter()
            .zip(slots)
            .map(|(path, slot)| ThumbnailResult {
                path,
                data_url: slot.into_inner().unwrap_or(None),
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// Reports whether the model server is up and actually answering, which backs
/// the status dot in the title bar.
#[tauri::command]
async fn runtime_health(state: State<'_, SharedRuntime>) -> Result<RuntimeHealth, String> {
    let shared = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let (running, busy, last_error, config) = {
            let mut manager = shared
                .lock()
                .map_err(|_| "Runtime lock poisoned".to_string())?;
            refresh_child_state(&mut manager);
            (
                manager.child.is_some(),
                manager.busy,
                manager.last_error.clone(),
                manager.config.clone(),
            )
        };

        let responsive = running
            && Client::builder()
                .timeout(Duration::from_millis(1500))
                .build()
                .ok()
                .and_then(|client| client.get(runtime_health_url(&config)).send().ok())
                .map(|response| response.status().is_success())
                .unwrap_or(false);

        Ok(RuntimeHealth {
            running,
            busy,
            responsive,
            last_error,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn runtime_force_stop(app: AppHandle, state: State<'_, SharedRuntime>) -> Result<RuntimeStatus, String> {
    force_stop_internal(state.inner())?;
    runtime_status_snapshot(&app, state.inner())
}

#[tauri::command]
fn runtime_get_status(app: AppHandle, state: State<'_, SharedRuntime>) -> Result<RuntimeStatus, String> {
    runtime_status_snapshot(&app, state.inner())
}

#[tauri::command]
fn runtime_get_config(state: State<'_, SharedRuntime>) -> Result<RuntimeConfig, String> {
    let manager = state
        .lock()
        .map_err(|_| "Runtime lock poisoned".to_string())?;
    Ok(manager.config.clone())
}

#[tauri::command]
fn runtime_update_config(
    app: AppHandle,
    state: State<'_, SharedRuntime>,
    config: RuntimeConfig,
) -> Result<RuntimeConfig, String> {
    let shared = state.inner().clone();
    let normalized = normalize_runtime_config(config);

    let was_running = {
        let mut manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        refresh_child_state(&mut manager);
        manager.config = normalized.clone();
        save_runtime_config(&app, &manager.config)?;
        manager.child.is_some()
    };

    if was_running {
        stop_runtime_internal(&shared)?;
        start_runtime_if_needed(&app, &shared)?;
    }

    Ok(normalized)
}

#[tauri::command]
fn runtime_start(app: AppHandle, state: State<'_, SharedRuntime>) -> Result<RuntimeStatus, String> {
    start_runtime_if_needed(&app, state.inner())?;
    runtime_status_snapshot(&app, state.inner())
}

#[tauri::command]
fn runtime_stop(app: AppHandle, state: State<'_, SharedRuntime>) -> Result<RuntimeStatus, String> {
    stop_runtime_internal(state.inner())?;
    runtime_status_snapshot(&app, state.inner())
}

#[tauri::command]
fn runtime_cancel_batch(app: AppHandle, state: State<'_, SharedRuntime>) -> Result<RuntimeStatus, String> {
    {
        let mut manager = state
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.cancel_requested = true;
    }

    runtime_status_snapshot(&app, state.inner())
}

#[tauri::command]
async fn runtime_generate_batch(
    app: AppHandle,
    state: State<'_, SharedRuntime>,
    requests: Vec<RuntimeBatchRequest>,
) -> Result<Vec<RuntimeBatchResult>, String> {
    if requests.is_empty() {
        return Ok(Vec::new());
    }

    let shared = state.inner().clone();

    {
        let mut manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        refresh_child_state(&mut manager);

        if manager.busy {
            return Err("Runtime is busy with another batch request.".to_string());
        }

        manager.busy = true;
        manager.cancel_requested = false;
        manager.force_stop_requested = false;
        manager.last_error = None;
    }

    let app_handle = app.clone();
    let shared_for_task = shared.clone();

    let batch_result: Result<Vec<RuntimeBatchResult>, String> = tauri::async_runtime::spawn_blocking(move || {
        start_runtime_if_needed(&app_handle, &shared_for_task)?;

        let config = {
            let manager = shared_for_task
                .lock()
                .map_err(|_| "Runtime lock poisoned".to_string())?;
            manager.config.clone()
        };

        let client = build_client(config.request_timeout_sec)?;

        // Speech transcription is only worth its large model download when there
        // is actually audio to read.
        let needs_whisper = requests.iter().any(|request| {
            matches!(
                request.kind.trim().to_ascii_lowercase().as_str(),
                "audio" | "video"
            )
        });
        let needs_ffmpeg = needs_whisper
            || requests.iter().any(|request| {
                request.kind.trim().eq_ignore_ascii_case("image")
                    && image_is_animated_container(Path::new(&request.path))
            });

        // A missing helper degrades individual files to a fallback name rather
        // than failing the whole batch.
        let whisper = if needs_whisper {
            bootstrap_whisper_assets(&app_handle).ok()
        } else {
            None
        };
        let ffmpeg_path = match whisper.as_ref() {
            Some(assets) => Some(assets.ffmpeg_path.clone()),
            None if needs_ffmpeg => ensure_ffmpeg(&app_handle).ok(),
            None => None,
        };
        let media = MediaAssets {
            ffmpeg_path,
            whisper,
        };
        let total = requests.len();
        let mut processed = 0;
        let mut results = Vec::with_capacity(total);

        for request in requests {
            let is_cancelled = {
                let manager = shared_for_task
                    .lock()
                    .map_err(|_| "Runtime lock poisoned".to_string())?;
                manager.cancel_requested || manager.force_stop_requested
            };

            if is_cancelled {
                break;
            }

            let result = process_batch_item(&shared_for_task, &client, &config, &media, &request);

            processed += 1;

            let progress = RuntimeBatchProgress {
                processed,
                total,
                current_path: request.path.clone(),
                result: result.clone(),
            };

            let _ = app_handle.emit(RUNTIME_PROGRESS_EVENT, progress);
            results.push(result);
        }

        let _ = app_handle.emit(RUNTIME_COMPLETE_EVENT, results.clone());
        Ok(results)
    })
    .await
    .map_err(|error| error.to_string())?;

    {
        let mut manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.busy = false;
        manager.cancel_requested = false;
        if let Err(error) = &batch_result {
            manager.last_error = Some(error.clone());
        }
    }

    batch_result
}

#[tauri::command]
fn apply_renames(requests: Vec<RenameRequest>) -> Result<Vec<RenameResult>, String> {
    Ok(apply_rename_items(requests))
}

#[tauri::command]
fn runtime_probe(
    app: AppHandle,
    state: State<'_, SharedRuntime>,
    prompt: Option<String>,
) -> Result<RuntimeProbeResult, String> {
    let shared = state.inner().clone();
    start_runtime_if_needed(&app, &shared)?;

    let config = {
        let manager = shared
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        manager.config.clone()
    };

    let client = build_client(config.request_timeout_sec)?;
    let probe_prompt = prompt.unwrap_or_else(|| "Reply with exactly: VLLM_OK".to_string());
    let start = Instant::now();
    let response = chat_completion(
        &client,
        &config,
        json!([
            {
                "role": "user",
                "content": probe_prompt
            }
        ]),
        64,
    )?;

    Ok(RuntimeProbeResult {
        response,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

fn initialize_runtime(app: &AppHandle) -> SharedRuntime {
    Arc::new(Mutex::new(RuntimeManager::new(load_runtime_config(app))))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let shared = initialize_runtime(&app.app_handle());
            let auto_start = shared
                .lock()
                .map(|manager| manager.config.auto_start)
                .unwrap_or(false);

            app.manage(shared.clone());

            if auto_start {
                let app_handle = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = start_runtime_if_needed(&app_handle, &shared);
                });
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            runtime_get_status,
            runtime_get_config,
            runtime_update_config,
            runtime_start,
            runtime_stop,
            runtime_cancel_batch,
            runtime_force_stop,
            runtime_generate_batch,
            runtime_health,
            list_folder,
            generate_thumbnails,
            apply_renames,
            runtime_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_connectives_left_dangling_by_the_word_limit() {
        let raw = "Quarterly Engineering Review Meeting Database Migration Timeline and Authentication";
        assert_eq!(
            sanitize_filename_base_with_limit(raw, "File", 8),
            "Quarterly Engineering Review Meeting Database Migration Timeline"
        );
    }

    #[test]
    fn keeps_a_single_word_even_if_it_is_a_connective() {
        assert_eq!(sanitize_filename_base_with_limit("the", "File", 8), "the");
    }

    #[test]
    fn enforces_the_word_limit_per_style() {
        let raw = "one two three four five six seven eight nine ten";
        assert_eq!(
            sanitize_filename_base_with_limit(raw, "File", 4),
            "one two three four"
        );
    }

    #[test]
    fn strips_characters_windows_rejects_in_filenames() {
        let cleaned = sanitize_filename_base_with_limit("re:port <v2>/final", "File", 8);
        assert!(!cleaned.contains([':', '<', '>', '/', '*', '?', '|']));
        assert!(!cleaned.contains('\\'));
    }

    #[test]
    fn falls_back_when_the_model_returns_nothing_usable() {
        assert_eq!(sanitize_filename_base_with_limit("   ", "File", 8), "File");
    }

    #[test]
    fn escapes_reserved_device_names() {
        assert_eq!(sanitize_filename_base_with_limit("CON", "File", 8), "CON file");
        assert!(is_windows_reserved_name("nul"));
    }

    #[test]
    fn quoted_model_output_is_unwrapped() {
        assert_eq!(
            normalize_response_text("\"Pixel Art Game\"", "File", 8),
            "Pixel Art Game"
        );
    }

    #[test]
    fn reasoning_blocks_never_leak_into_the_filename() {
        assert_eq!(
            normalize_response_text(
                "<think>The user wants a short name so I will pick</think>Sunset Over Harbor",
                "File",
                8
            ),
            "Sunset Over Harbor"
        );
    }

    #[test]
    fn unterminated_reasoning_block_discards_the_remainder() {
        assert_eq!(
            normalize_response_text("Sunset Over Harbor<think>now let me reconsider", "File", 8),
            "Sunset Over Harbor"
        );
    }

    #[test]
    fn stray_closing_tag_is_dropped() {
        assert_eq!(
            normalize_response_text("Sunset Over Harbor</think>", "File", 8),
            "Sunset Over Harbor"
        );
    }

    #[test]
    fn classifies_extensions_for_the_folder_listing() {
        assert_eq!(classify_extension(".GIF"), ("image", "image"));
        assert_eq!(classify_extension(".mp4"), ("video", "video"));
        assert_eq!(classify_extension(".flac"), ("audio", "audio"));
        assert_eq!(classify_extension(".txt"), ("txt", "text"));
        assert_eq!(classify_extension(".zip"), ("fallback", "other"));
        assert_eq!(classify_extension(""), ("fallback", "other"));
    }

    #[test]
    fn animated_containers_are_routed_to_ffmpeg() {
        assert!(image_is_animated_container(Path::new("a/b/clip.gif")));
        assert!(image_is_animated_container(Path::new("clip.WEBP")));
        assert!(!image_is_animated_container(Path::new("photo.jpg")));
    }
}
