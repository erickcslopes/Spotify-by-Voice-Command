use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const KEYRING_SERVICE: &str = "com.spotifyvoiceassistant.app";
const KEYRING_ACCOUNT: &str = "xai_api_key";
const TOKENS_REL: [&str; 2] = [".spotify-voice-assistant", "tokens.json"];
const CALLBACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub general: GeneralSettings,
    pub voice: VoiceSettings,
    pub whisper: WhisperSettings,
    pub ai: AiSettings,
    pub spotify: SpotifySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralSettings {
    pub start_minimized: bool,
    pub minimize_to_tray: bool,
    pub start_with_windows: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        GeneralSettings {
            start_minimized: false,
            minimize_to_tray: true,
            start_with_windows: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VoiceSettings {
    pub hotkey: String,
    pub volume_step: i64,
    pub minimum_recording_ms: i64,
    pub device: String,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        VoiceSettings {
            hotkey: "Ctrl+Alt+Space".into(),
            volume_step: 10,
            minimum_recording_ms: 300,
            device: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WhisperSettings {
    pub binary_path: String,
    pub model_path: String,
    pub timeout_ms: i64,
}

impl Default for WhisperSettings {
    fn default() -> Self {
        WhisperSettings {
            binary_path: String::new(),
            model_path: String::new(),
            timeout_ms: 60_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiSettings {
    pub enabled: bool,
    pub model: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            enabled: true,
            model: "grok-3-mini".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SpotifySettings {
    pub client_id: String,
    pub redirect_uri: String,
}

impl Default for SpotifySettings {
    fn default() -> Self {
        SpotifySettings {
            client_id: String::new(),
            redirect_uri: "http://127.0.0.1:1421/callback".into(),
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            general: GeneralSettings::default(),
            voice: VoiceSettings::default(),
            whisper: WhisperSettings::default(),
            ai: AiSettings::default(),
            spotify: SpotifySettings::default(),
        }
    }
}

/// Configuração persistente (settings.json). Campos ausentes em arquivos
/// antigos caem nos defaults; JSON inválido também recua para defaults.
pub struct SettingsService {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl SettingsService {
    pub fn load(path: PathBuf) -> Self {
        let settings = read_settings_file(&path).unwrap_or_default();
        SettingsService {
            path,
            inner: Mutex::new(settings),
        }
    }

    pub fn current(&self) -> Settings {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn save(&self, settings: Settings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Falha ao serializar settings: {e}"))?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Falha ao criar diretório de settings: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("Falha ao salvar settings: {e}"))?;
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| format!("Falha ao salvar settings: {e}"))?;
        if let Ok(mut guard) = self.inner.lock() {
            *guard = settings;
        }
        Ok(())
    }
}

fn read_settings_file(path: &Path) -> Option<Settings> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Settings>(&content).ok()
}

#[tauri::command]
pub fn get_settings(state: State<SettingsService>) -> Settings {
    state.current()
}

#[tauri::command]
pub fn save_settings(state: State<SettingsService>, settings: Settings) -> Result<(), String> {
    state.save(settings)
}

// ---------------------------------------------------------------------------
// API key do Grok (keyring do sistema; fallback para variável de ambiente)
// ---------------------------------------------------------------------------

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring indisponível: {e}"))
}

#[tauri::command]
pub fn ai_get_api_key() -> String {
    keyring_entry()
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|key| !key.is_empty())
        .or_else(|| std::env::var("XAI_API_KEY").ok().filter(|k| !k.is_empty()))
        .unwrap_or_default()
}

#[tauri::command]
pub fn ai_has_api_key() -> bool {
    !ai_get_api_key().is_empty()
}

#[tauri::command]
pub fn ai_set_api_key(key: String) -> Result<(), String> {
    let entry = keyring_entry()?;
    if key.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry
        .set_password(&key)
        .map_err(|e| format!("Não foi possível salvar a chave: {e}"))
}

#[tauri::command]
pub fn ai_clear_api_key() -> Result<(), String> {
    let entry = keyring_entry()?;
    entry
        .delete_credential()
        .map_err(|e| format!("Falha ao remover a chave: {e}"))
}

// ---------------------------------------------------------------------------
// Tokens do Spotify (mesmo arquivo do modo texto, para compatibilidade)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
}

fn tokens_path(app: &AppHandle) -> PathBuf {
    let mut base = app.path().home_dir().unwrap_or_default();
    for part in TOKENS_REL {
        base.push(part);
    }
    base
}

#[tauri::command]
pub fn token_load(app: AppHandle) -> Option<TokenPair> {
    let path = tokens_path(&app);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<TokenPair>(&content).ok()
}

#[tauri::command]
pub fn token_save(app: AppHandle, tokens: TokenPair) -> Result<(), String> {
    let path = tokens_path(&app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Falha ao salvar tokens: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&tokens)
        .map_err(|e| format!("Falha ao serializar tokens: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Falha ao salvar tokens: {e}"))
}

#[tauri::command]
pub fn token_clear(app: AppHandle) -> Result<(), String> {
    let path = tokens_path(&app);
    std::fs::remove_file(path).ok();
    Ok(())
}

// ---------------------------------------------------------------------------
// Validação do Whisper (configuração sem transcrição real)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct WhisperValidation {
    pub ok: bool,
    pub message: String,
}

fn run_with_timeout(bin: &str, args: &[&str], timeout: std::time::Duration) -> Result<bool, String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Falha ao executar o binário: {e}"))?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.success()),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err("O binário não respondeu dentro do tempo limite.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Falha ao executar o binário: {e}")),
        }
    }
}

#[tauri::command]
pub fn validate_whisper(state: State<SettingsService>) -> WhisperValidation {
    let settings = state.current();
    let bin = settings.whisper.binary_path.trim().to_string();
    let model = settings.whisper.model_path.trim().to_string();

    if bin.is_empty() {
        return WhisperValidation {
            ok: false,
            message: "Binário do Whisper não configurado.".into(),
        };
    }
    if is_path_like(&bin) && !Path::new(&bin).exists() {
        return WhisperValidation {
            ok: false,
            message: format!("Binário não encontrado: {bin}"),
        };
    }
    match run_with_timeout(&bin, &["--help"], std::time::Duration::from_secs(10)) {
        Ok(true) => {}
        Ok(false) => {
            return WhisperValidation {
                ok: false,
                message: "O binário não respondeu como esperado (código de saída diferente de 0)."
                    .into(),
            };
        }
        Err(msg) => {
            return WhisperValidation {
                ok: false,
                message: msg,
            };
        }
    }
    if !model.is_empty() && is_path_like(&model) && !Path::new(&model).exists() {
        return WhisperValidation {
            ok: false,
            message: format!("Modelo não encontrado: {model}"),
        };
    }
    let message = if model.is_empty() {
        "Whisper: pronto (modelo padrão será usado).".to_string()
    } else {
        "Whisper: pronto".to_string()
    };
    WhisperValidation { ok: true, message }
}

pub(crate) fn is_path_like(value: &str) -> bool {
    value.contains('/') || value.contains('\\') || value.to_lowercase().ends_with(".exe")
}

// ---------------------------------------------------------------------------
// OAuth: callback local (servidor HTTP mínimo) + abertura do navegador
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AuthCallback {
    pub code: Option<String>,
}

#[tauri::command]
pub async fn auth_open_callback_server(
    port: u16,
    state: Option<String>,
) -> Result<AuthCallback, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        listen_for_spotify_code(port, state)
    })
    .await
    .map_err(|e| format!("Falha no servidor de callback: {e}"))?;
    result
}

fn listen_for_spotify_code(port: u16, expected_state: Option<String>) -> Result<AuthCallback, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener =
        TcpListener::bind(("127.0.0.1", port)).map_err(|e| {
            format!(
                "Não foi possível escutar a porta {port} ({e}). Verifique o Redirect URI/configuração."
            )
        })?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Erro de configuração do callback: {e}"))?;

    let deadline = std::time::Instant::now() + CALLBACK_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .ok();
                let mut request = Vec::new();
                let mut chunk = [0u8; 1024];
                let mut read_any = false;
                while let Ok(n) = stream.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..n]);
                    read_any = true;
                    if request.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                if !read_any {
                    continue;
                }
                let request = String::from_utf8_lossy(&request);
                let code = extract_query_param(&request, "code");
                let state_matches = match expected_state.as_deref() {
                    None => true,
                    Some(expected) if expected.trim().is_empty() => true,
                    Some(expected) => {
                        extract_query_param(&request, "state").as_deref() == Some(expected)
                    }
                };
                let (html, status) = match (&code, state_matches) {
                    (Some(_), true) => (
                        "<h1>Autenticado! Você já pode fechar esta janela.</h1>",
                        "200 OK",
                    ),
                    _ => ("<h1>Falha na autenticação.</h1>", "400 Bad Request"),
                };
                let body = format!(
                    "<!doctype html><html><body style=\"font-family:system-ui;padding:40px\">{html}</body></html>"
                );
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                );
                let _ = stream.flush();
                if state_matches {
                    return Ok(AuthCallback { code });
                }
                return Err("State do OAuth não confere (possível CSRF).".into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("Tempo limite aguardando o callback do Spotify.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Falha no servidor de callback: {e}")),
        }
    }
}

fn extract_query_param(request: &str, key: &str) -> Option<String> {
    let line = request.lines().next()?;
    let target = line.split_whitespace().nth(1)?;
    let query = target.split('?').nth(1)?;
    for pair in query.split('&') {
        if let Some((k, value)) = pair.split_once('=') {
            if k == key && !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL inválida.".into());
    }
    // `cmd /C start` divide a URL nos "&" da query (trunca em client_id=... e
    // o Spotify responde "response_type must be code"); `explorer.exe` também
    // não abria o navegador. Aqui usamos o tauri-plugin-opener oficial, que
    // abre URLs HTTP/HTTPS no navegador padrão sem passar por shell.
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}