mod audio;
mod commands;
mod hotkey;
mod settings;
mod tray;

use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(hotkey::on_shortcut_event)
            .build())
        .setup(|app| {
            let settings = settings::SettingsService::load(
                app.path().app_config_dir()?.join("settings.json"),
            );
            app.manage(settings);
            app.manage(audio::AudioRecorder::default());

            // Start with Windows: sincroniza com as settings persistentes.
            let current = app.state::<settings::SettingsService>().current();
            let autostart = app.autolaunch();
            if current.general.start_with_windows {
                let _ = autostart.enable();
            } else {
                let _ = autostart.disable();
            }

            // Hotkey global (configurável nas settings).
            let combo = app
                .state::<settings::SettingsService>()
                .current()
                .voice
                .hotkey;
            if let Err(msg) = hotkey::setup_hotkey(app, &combo) {
                eprintln!("[sva] hotkey: {msg}");
            }

            tray::setup_tray(app)?;

            // Start minimized: a janela nasce oculta (visible:false) e só é
            // exibida quando a opção não estiver habilitada.
            let start_minimized = app
                .state::<settings::SettingsService>()
                .current()
                .general
                .start_minimized;
            if let Some(window) = app.get_webview_window("main") {
                if !start_minimized {
                    let _ = window.show();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            audio::start_recording,
            audio::stop_recording,
            audio::is_recording,
            audio::transcribe_audio,
            commands::process_text,
            commands::status,
            settings::get_settings,
            settings::save_settings,
            settings::ai_get_api_key,
            settings::ai_has_api_key,
            settings::ai_set_api_key,
            settings::ai_clear_api_key,
            settings::token_load,
            settings::token_save,
            settings::token_clear,
            settings::validate_whisper,
            settings::auth_open_callback_server,
            settings::open_url,
            hotkey::hotkey_set,
            hotkey::hotkey_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}