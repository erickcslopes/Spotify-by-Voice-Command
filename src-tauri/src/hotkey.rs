use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
};

/// Combinação atualmente registrada (para troca sem duplicar atalhos).
pub struct HotkeyManager {
    current: Mutex<Option<String>>,
}

impl Default for HotkeyManager {
    fn default() -> Self {
        HotkeyManager {
            current: Mutex::new(None),
        }
    }
}

impl HotkeyManager {
    fn set_current(&self, combo: String) {
        if let Ok(mut guard) = self.current.lock() {
            *guard = Some(combo);
        }
    }
}

/// Handler global do plugin: reflete press/release na UI via eventos.
pub fn on_shortcut_event(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    use tauri::Emitter;
    let event_name = if event.state == ShortcutState::Pressed {
        "voice:hotkey-down"
    } else {
        "voice:hotkey-up"
    };
    let _ = app.emit(event_name, ());
}

/// Registra a combinação inicial (das settings).
pub fn setup_hotkey(app: &mut tauri::App, combo: &str) -> Result<(), String> {
    app.manage(HotkeyManager::default());

    if !combo.trim().is_empty() {
        let parsed: Shortcut = combo
            .parse()
            .map_err(|_| format!("Combinação de hotkey inválida: {combo}"))?;
        app.global_shortcut()
            .register(parsed)
            .map_err(|_| "Não foi possível registrar a hotkey. Ela pode estar em uso por outro programa.".to_string())?;
        if let Some(manager) = app.try_state::<HotkeyManager>() {
            manager.set_current(combo.to_string());
        }
    }

    Ok(())
}

/// Troca a hotkey em runtime: registra a nova antes de remover a antiga,
/// mantendo a anterior em caso de conflito.
#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    state: State<HotkeyManager>,
    combo: String,
) -> Result<(), String> {
    let combo = combo.trim().to_string();
    if combo.is_empty() {
        return Err("A hotkey não pode ficar vazia.".into());
    }

    {
        let guard = state
            .current
            .lock()
            .map_err(|_| "Falha interna de estado.".to_string())?;
        if guard.as_deref() == Some(combo.as_str()) {
            return Ok(());
        }
    }

    let parsed: Shortcut = combo
        .parse()
        .map_err(|_| format!("Combinação de hotkey inválida: {combo}"))?;

    app.global_shortcut().register(parsed).map_err(|_| {
        "Não foi possível registrar essa combinação. Ela pode estar em uso por outro programa."
            .to_string()
    })?;

    let mut guard = state
        .current
        .lock()
        .map_err(|_| "Falha interna de estado.".to_string())?;
    if let Some(old) = guard.take() {
        if let Ok(old_shortcut) = old.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(old_shortcut);
        }
    }
    *guard = Some(combo);
    Ok(())
}

#[tauri::command]
pub fn hotkey_clear(app: AppHandle, state: State<HotkeyManager>) -> Result<(), String> {
    let mut guard = state
        .current
        .lock()
        .map_err(|_| "Falha interna de estado.".to_string())?;
    if let Some(old) = guard.take() {
        if let Ok(old_shortcut) = old.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(old_shortcut);
        }
    }
    Ok(())
}