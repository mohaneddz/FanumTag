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
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use zip::read::ZipArchive;

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

#[derive(Debug)]
struct RuntimeManager {
    config: RuntimeConfig,
    child: Option<Child>,
    busy: bool,
    cancel_requested: bool,
    last_error: Option<String>,
}

impl RuntimeManager {
    fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
            child: None,
            busy: false,
            cancel_requested: false,
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
        let zip_path = writable_base.join("lib").join("whisper-bin-x64.zip");
        download_to_path(WHISPER_RELEASE_ZIP_URL, &zip_path)?;
        unpack_zip_to_dir(&zip_path, &assets.lib_dir)?;
        let _ = fs::remove_file(&zip_path);
    }

    if !assets.ffmpeg_path.exists() {
        let zip_path = writable_base.join("lib").join("ffmpeg-bin-x64.zip");
        download_to_path(FFMPEG_RELEASE_ZIP_URL, &zip_path)?;
        unpack_zip_to_dir(&zip_path, &assets.lib_dir)?;
        let _ = fs::remove_file(&zip_path);
    }

    if !assets.model_path.exists() {
        download_to_path(WHISPER_MODEL_URL, &assets.model_path)?;
    }

    let whisper_cli_path = resolve_whisper_cli_path(&assets.lib_dir).ok_or_else(|| {
        "Whisper bootstrap finished but no whisper executable was found (expected whisper-cli.exe, main.exe, or whisper.exe).".to_string()
    })?;

    if !assets.ffmpeg_path.exists() || !assets.model_path.exists() {
        return Err("Whisper bootstrap finished but required files are still missing (ffmpeg.exe / model).".to_string());
    }

    Ok(WhisperAssets {
        whisper_cli_path,
        ffmpeg_path: assets.ffmpeg_path,
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

fn spawn_runtime_process(assets: &RuntimeAssets, config: &RuntimeConfig) -> Result<Child, String> {
    let mut cmd = Command::new(&assets.exe_path);
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

fn sanitize_filename_base_with_limit(raw: &str, fallback: &str, max_words: usize) -> String {
    let mut cleaned = raw
        .replace(['\r', '\n', '\t'], " ")
        .replace(['"', '\'', '`'], " ")
        .replace(['\\', '/', ':', '*', '?', '<', '>', '|'], " ");

    cleaned = cleaned
        .split_whitespace()
        .take(max_words.max(1))
        .collect::<Vec<_>>()
        .join(" ");

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

    fn prompt_instruction(self) -> String {
        match self {
            Self::Short => "Generate a short filename title (max 4 words). Return title only.".to_string(),
            Self::Average => "Generate a concise filename title (max 8 words). Return title only.".to_string(),
            Self::Long => "Generate a detailed filename title (max 14 words). Return title only.".to_string(),
        }
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

fn normalize_response_text(raw: &str, fallback: &str, max_words: usize) -> String {
    let without_thinking = raw
        .replace("<think>", "")
        .replace("</think>", "")
        .replace("\"", " ");

    sanitize_filename_base_with_limit(&without_thinking, fallback, max_words)
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

fn encode_image_file_to_jpeg_base64_via_ffmpeg(path: &Path, ffmpeg_path: &Path) -> Result<String, String> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let frame_path = std::env::temp_dir().join(format!(
        "fanumtag-image-{}-{}.jpg",
        std::process::id(),
        now_nanos
    ));

    let status = Command::new(ffmpeg_path)
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
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ffmpeg for image conversion: {}", e))?;

    if !status.success() || !frame_path.exists() {
        return Err("ffmpeg image conversion failed.".to_string());
    }

    let bytes = fs::read(&frame_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&frame_path);
    Ok(BASE64.encode(bytes))
}

fn image_is_probably_webp(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("webp"))
        .unwrap_or(false)
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
                    "Generate a filename title (max {} words) for this text content. Keep it informative and natural. Return title only.\\n\\n{}",
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
            style.prompt_instruction(),
            text.chars().take(5000).collect::<String>()
        ),
        None => format!(
            "{} Use visual scene details to produce the filename title.",
            style.prompt_instruction()
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
                    style.prompt_instruction(),
                    snippet
                )
            }
        ]),
        style.max_tokens(),
    )
}

fn extract_audio_wav(media_path: &Path, ffmpeg_path: &Path, output_wav: &Path) -> Result<(), String> {
    let status = Command::new(ffmpeg_path)
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
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ffmpeg for audio extraction: {}", e))?;

    if status.success() && output_wav.exists() {
        Ok(())
    } else {
        Err("ffmpeg audio extraction failed.".to_string())
    }
}

fn extract_video_frame_base64(media_path: &Path, ffmpeg_path: &Path) -> Result<String, String> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let frame_path = std::env::temp_dir().join(format!(
        "fanumtag-frame-{}-{}.jpg",
        std::process::id(),
        now_nanos
    ));

    let status = Command::new(ffmpeg_path)
        .arg("-y")
        .arg("-i")
        .arg(media_path)
        .arg("-vf")
        .arg("thumbnail,scale=960:-1")
        .arg("-frames:v")
        .arg("1")
        .arg(&frame_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ffmpeg for frame extraction: {}", e))?;

    if !status.success() || !frame_path.exists() {
        return Err("ffmpeg frame extraction failed.".to_string());
    }

    let bytes = fs::read(&frame_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&frame_path);
    Ok(BASE64.encode(bytes))
}

fn transcribe_media_with_whisper(media_path: &Path, whisper: &WhisperAssets) -> Result<String, String> {
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

    extract_audio_wav(media_path, &whisper.ffmpeg_path, &wav_path)?;

    let run_whisper = |args: &[&str]| -> Result<bool, String> {
        let mut command = Command::new(&whisper.whisper_cli_path);
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

        let status = command
            .status()
            .map_err(|e| format!("Failed to run whisper executable: {}", e))?;
        Ok(status.success())
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
    client: &Client,
    config: &RuntimeConfig,
    whisper_assets: Option<&WhisperAssets>,
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
            match encode_image_file_to_jpeg_base64(&path) {
                Ok(base64) => generate_title_from_image(client, config, &base64, style),
                Err(primary_error) => {
                    if let Some(whisper) = whisper_assets {
                        match encode_image_file_to_jpeg_base64_via_ffmpeg(&path, &whisper.ffmpeg_path) {
                            Ok(base64) => generate_title_from_image(client, config, &base64, style),
                            Err(ffmpeg_error) => Err(format!("{}; ffmpeg fallback failed: {}", primary_error, ffmpeg_error)),
                        }
                    } else if image_is_probably_webp(&path) {
                        Err(format!("{}; ffmpeg is unavailable for webp conversion fallback", primary_error))
                    } else {
                        Err(primary_error)
                    }
                }
            }
        }
        "video" => {
            let whisper = match whisper_assets {
                Some(assets) => assets,
                None => return RuntimeBatchResult {
                    ind: request.ind,
                    suggested_name: Some(fallback),
                    error: Some("Whisper/ffmpeg assets are missing for video processing".to_string()),
                    source: "fallback".to_string(),
                },
            };

            let transcript = transcribe_media_with_whisper(&path, whisper).ok();
            let frame = extract_video_frame_base64(&path, &whisper.ffmpeg_path)
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
            let whisper = match whisper_assets {
                Some(assets) => assets,
                None => return RuntimeBatchResult {
                    ind: request.ind,
                    suggested_name: Some(fallback),
                    error: Some("Whisper/ffmpeg assets are missing for audio processing".to_string()),
                    source: "fallback".to_string(),
                },
            };

            transcribe_media_with_whisper(&path, whisper)
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
        let needs_whisper = requests
            .iter()
            .any(|request| {
                let kind = request.kind.trim().to_ascii_lowercase();
                if matches!(kind.as_str(), "audio" | "video") {
                    return true;
                }
                kind == "image"
                    && Path::new(&request.path)
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("webp"))
                        .unwrap_or(false)
            });
        let whisper_assets = if needs_whisper {
            Some(bootstrap_whisper_assets(&app_handle)?)
        } else {
            None
        };
        let total = requests.len();
        let mut processed = 0;
        let mut results = Vec::with_capacity(total);

        for request in requests {
            let is_cancelled = {
                let manager = shared_for_task
                    .lock()
                    .map_err(|_| "Runtime lock poisoned".to_string())?;
                manager.cancel_requested
            };

            if is_cancelled {
                break;
            }

            let result = process_batch_item(&client, &config, whisper_assets.as_ref(), &request);

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
            runtime_generate_batch,
            apply_renames,
            runtime_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
