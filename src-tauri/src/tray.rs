use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::SettingsService;

pub fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let falar = MenuItemBuilder::with_id("falar", "Falar").build(app)?;
    let pausar = MenuItemBuilder::with_id("pausar", "Pausar").build(app)?;
    let proxima = MenuItemBuilder::with_id("proxima", "Próxima").build(app)?;
    let abrir = MenuItemBuilder::with_id("abrir", "Abrir").build(app)?;
    let configuracoes = MenuItemBuilder::with_id("configuracoes", "Configurações").build(app)?;
    let sair = MenuItemBuilder::with_id("sair", "Sair").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&falar)
        .item(&pausar)
        .item(&proxima)
        .separator()
        .item(&abrir)
        .item(&configuracoes)
        .separator()
        .item(&sair)
        .build()?;

    let icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "sair" => {
                cleanup(app);
                app.exit(0);
            }
            "abrir" => show_main_window(app),
            "configuracoes" => {
                show_main_window(app);
                let _ = app.emit("open-settings", ());
            }
            "falar" => {
                let _ = app.emit("voice:tray-toggle", ());
            }
            // "pausar" e "proxima" ficam como atalhos rápidos opcionais.
            "pausar" | "proxima" => {}
            _ => {}
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Encerramento limpo: para gravação ativa, libera o microfone e remove a hotkey.
pub fn cleanup(app: &AppHandle) {
    if let Some(recorder) = app.try_state::<crate::audio::AudioRecorder>() {
        let _ = recorder.stop();
    }
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
}

/// Se minimizeToTray, o "X" esconde a janela em vez de encerrar o app.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let minimize_to_tray = window
            .app_handle()
            .try_state::<SettingsService>()
            .map(|s| s.current().general.minimize_to_tray)
            .unwrap_or(false);
        if minimize_to_tray {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}