use serde::Serialize;

/// Comando exposto ao frontend. A lógica real de intents roda no frontend
/// (TypeScript); o Rust cuida de janela, tray, hotkey e captura de áudio.
#[tauri::command]
pub fn process_text(text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("texto vazio".into());
    }
    Ok(format!("recebido: {text}"))
}

#[derive(Serialize)]
pub struct AppStatus {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub fn status() -> AppStatus {
    AppStatus {
        ok: true,
        message: "aplicativo rodando".into(),
    }
}