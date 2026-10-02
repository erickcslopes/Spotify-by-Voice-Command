use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;
use tauri::{State, State as TauriState};

use crate::settings::is_path_like;
use crate::settings::SettingsService;

/// Formato alvo do whisper.cpp: WAV mono PCM 16 kHz.
const TARGET_RATE: u32 = 16_000;

struct ActiveRecording {
    samples: Arc<Mutex<Vec<i16>>>,
    sample_rate: u32,
    channels: u16,
    started: Instant,
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

/// Estado compartilhado da gravação, gerenciado pelo Tauri.
///
/// O `cpal::Stream` não é `Send`; a captura roda em uma thread dedicada e
/// apenas metadados Send+Sync ficam no estado gerenciado.
#[derive(Default)]
pub struct AudioRecorder {
    active: Mutex<Option<ActiveRecording>>,
}

#[derive(Serialize)]
pub struct RecordingResult {
    pub path: String,
    pub duration_ms: u64,
}

impl AudioRecorder {
    /// Inicia a gravação no dispositivo selecionado (None = padrão do sistema).
    pub fn start(&self, device_name: Option<String>) -> Result<(), String> {
        let mut guard = self
            .active
            .lock()
            .map_err(|_| "Falha interna de estado.".to_string())?;

        if guard.is_some() {
            return Err("Já há uma gravação em andamento.".into());
        }

        let samples: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<Result<(u32, u16), String>>();

        let samples_cb = samples.clone();
        let stop_cb = stop.clone();
        let started = Instant::now();

        let handle = std::thread::spawn(move || {
            capture_loop(samples_cb, stop_cb, device_name, tx);
        });

        match rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok((sample_rate, channels))) => {
                *guard = Some(ActiveRecording {
                    samples,
                    sample_rate,
                    channels,
                    started,
                    stop,
                    handle: Some(handle),
                });
                Ok(())
            }
            Ok(Err(err)) => {
                let _ = handle.join();
                Err(err)
            }
            Err(_) => {
                // A thread pode ainda estar abrindo o dispositivo; sinaliza parada.
                stop.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err("Tempo limite ao iniciar a captura.".into())
            }
        }
    }

    pub fn stop(&self) -> Result<RecordingResult, String> {
        let mut rec = self
            .active
            .lock()
            .map_err(|_| "Falha interna de estado.".to_string())?
            .take()
            .ok_or_else(|| "Nenhuma gravação em andamento.".to_string())?;

        rec.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = rec.handle.take() {
            // A thread encerra ao perceber o flag; dá-se uma folga para o stream parar.
            let _ = handle.join();
        }

        let duration_ms = rec.started.elapsed().as_millis() as u64;
        let raw: Vec<i16> = rec
            .samples
            .lock()
            .map_err(|_| "Falha interna de estado.".to_string())?
            .iter()
            .copied()
            .collect();

        if raw.is_empty() || rec.sample_rate == 0 {
            return Err("Nenhum áudio capturado.".into());
        }

        let mono = to_mono(&raw, rec.channels);
        let resampled = resample_linear(&mono, rec.sample_rate, TARGET_RATE);
        let path = write_wav_temp(&resampled, TARGET_RATE)?;

        Ok(RecordingResult { path, duration_ms })
    }

    pub fn is_recording(&self) -> bool {
        self.active
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }
}

/// Abre o microfone e captura em loop até o flag de parada.
/// O `cpal::Stream` permanece exclusivamente nesta thread.
/// O resultado de inicialização é enviado por `tx` assim que o stream entra em
/// reprodução (antes do loop), para que `start()` registre a gravação como ativa
/// sem esperar o término da captura.
fn capture_loop(
    samples: Arc<Mutex<Vec<i16>>>,
    stop: Arc<AtomicBool>,
    device_name: Option<String>,
    tx: mpsc::Sender<Result<(u32, u16), String>>,
) {
    let host = cpal::default_host();
    let device = match device_name.as_deref() {
        Some(name) if !name.is_empty() => match host.input_devices() {
            Ok(mut devices) => devices
                .find(|device| device.name().map(|n| n == name).unwrap_or(false))
                .or_else(|| host.default_input_device())
                .ok_or_else(|| {
                    "Microfone não encontrado. Conecte um dispositivo de entrada.".to_string()
                }),
            Err(e) => Err(format!("Não foi possível listar os microfones: {e}")),
        },
        _ => host
            .default_input_device()
            .ok_or_else(|| "Microfone não encontrado. Conecte um dispositivo de entrada.".to_string()),
    };
    let device = match device {
        Ok(d) => d,
        Err(e) => {
            let _ = tx.send(Err(e));
            return;
        }
    };

    let supported = match device.default_input_config() {
        Ok(s) => s,
        Err(e) => {
            let _ = tx.send(Err(format!("Não foi possível configurar o microfone: {e}")));
            return;
        }
    };

    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let stream = match build_stream(&device, &supported, &samples) {
        Ok(s) => s,
        Err(e) => {
            let _ = tx.send(Err(e));
            return;
        }
    };

    if let Err(e) = stream.play() {
        let _ = tx.send(Err(format!("Erro ao iniciar a gravação: {e}")));
        return;
    }

    // Sinaliza início com sucesso imediatamente; a gravação segue ativa na thread.
    if tx.send(Ok((sample_rate, channels))).is_err() {
        return;
    }

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    drop(stream);
}

fn build_stream(
    device: &cpal::Device,
    supported: &cpal::SupportedStreamConfig,
    samples: &Arc<Mutex<Vec<i16>>>,
) -> Result<cpal::Stream, String> {
    let config: cpal::StreamConfig = supported.clone().into();
    let err_fn = |err| eprintln!("[sva] erro no stream de áudio: {err}");

    match supported.sample_format() {
        cpal::SampleFormat::I16 => {
            let samples = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        if let Ok(mut s) = samples.lock() {
                            s.extend_from_slice(data);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Erro ao iniciar captura: {e}"))
        }
        cpal::SampleFormat::F32 => {
            let samples = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        if let Ok(mut s) = samples.lock() {
                            s.extend(
                                data.iter()
                                    .map(|&v| (v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16),
                            );
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Erro ao iniciar captura: {e}"))
        }
        cpal::SampleFormat::U16 => {
            let samples = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        if let Ok(mut s) = samples.lock() {
                            s.extend(data.iter().map(|&v| v.wrapping_sub(32_768) as i16));
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Erro ao iniciar captura: {e}"))
        }
        other => Err(format!(
            "Formato de áudio do microfone não suportado: {other:?}"
        )),
    }
}

/// Converte interleaved (multi-canal) para mono, fazendo a média dos canais.
fn to_mono(samples: &[i16], channels: u16) -> Vec<i16> {
    if samples.is_empty() || channels == 0 {
        return Vec::new();
    }
    if channels == 1 {
        return samples.to_vec();
    }
    samples
        .chunks_exact(channels as usize)
        .map(|frame| {
            let sum: i32 = frame.iter().map(|&s| s as i32).sum();
            (sum / channels as i32) as i16
        })
        .collect()
}

/// Resample por interpolação linear (simples e sem dependências).
fn resample_linear(samples: &[i16], src_rate: u32, dst_rate: u32) -> Vec<i16> {
    if samples.is_empty() || src_rate == dst_rate || dst_rate == 0 {
        return samples.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let i0 = pos.floor() as usize;
        let i1 = (i0 + 1).min(samples.len() - 1);
        let frac = (pos - i0 as f64) as f32;
        let value =
            samples[i0] as f32 * (1.0 - frac) + samples[i1] as f32 * frac;
        out.push(value.clamp(-32_768.0, 32_767.0) as i16);
    }
    out
}

fn write_wav_temp(samples: &[i16], sample_rate: u32) -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = std::env::temp_dir().join(format!("sva-rec-{nanos}.wav"));

    let data_len = (samples.len() * 2) as u32;
    let byte_rate = sample_rate * 2;

    let mut file =
        std::fs::File::create(&path).map_err(|e| format!("Erro ao salvar áudio: {e}"))?;
    let mut write = |bytes: &[u8]| file.write_all(bytes).map_err(io_err);

    write(b"RIFF")?;
    write(&(36 + data_len).to_le_bytes())?;
    write(b"WAVE")?;
    write(b"fmt ")?;
    write(&16u32.to_le_bytes())?;
    write(&1u16.to_le_bytes())?; // PCM
    write(&1u16.to_le_bytes())?; // mono
    write(&sample_rate.to_le_bytes())?;
    write(&byte_rate.to_le_bytes())?;
    write(&2u16.to_le_bytes())?; // block align
    write(&16u16.to_le_bytes())?; // bits por amostra
    write(b"data")?;
    write(&data_len.to_le_bytes())?;

    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    write(&bytes)?;

    Ok(path.to_string_lossy().into_owned())
}

fn io_err(e: std::io::Error) -> String {
    format!("Erro ao gravar áudio: {e}")
}

/// Resolve o modelo do whisper a partir das settings persistentes.
fn resolve_whisper_model(settings: &crate::settings::Settings) -> String {
    let model_path = settings.whisper.model_path.trim();
    if !model_path.is_empty() {
        return model_path.to_string();
    }
    "base".into()
}

/// Transcreve um arquivo de áudio com o whisper.cpp.
/// Binário, modelo e timeout vêm das settings (Fase 5).
#[tauri::command]
pub fn transcribe_audio(
    path: String,
    settings: TauriState<SettingsService>,
) -> Result<String, String> {
    let current = settings.current();
    let bin = current.whisper.binary_path.trim();
    let bin = if bin.is_empty() { "whisper-cli" } else { bin };
    let model = resolve_whisper_model(&current);
    let timeout_ms = current.whisper.timeout_ms.max(1000) as u64;

    if !std::path::Path::new(&path).exists() {
        return Err("Arquivo de áudio não encontrado.".into());
    }
    if is_path_like(bin) && !std::path::Path::new(bin).exists() {
        return Err("whisper.cpp não encontrado. Configure o binário nas configurações.".into());
    }
    if is_path_like(&model) && !std::path::Path::new(&model).exists() {
        return Err(format!("Modelo do whisper não encontrado: {model}"));
    }

    let mut child = Command::new(bin)
        .args(["-m", &model, "-f", &path, "-nt", "-l", "auto"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao executar o whisper: {e}"))?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let output = loop {
        match child.try_wait() {
            Ok(Some(_status)) => break child.wait_with_output(),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err("Whisper excedeu o tempo limite de transcrição.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Falha ao executar o whisper: {e}")),
        }
    }
    .map_err(|e| format!("Falha ao ler a saída do whisper: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Whisper encerrou com erro: {}",
            stderr.trim()
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

#[tauri::command]
pub fn start_recording(
    state: State<AudioRecorder>,
    settings: TauriState<SettingsService>,
) -> Result<(), String> {
    let device = settings.current().voice.device;
    let device = (!device.trim().is_empty()).then(|| device.trim().to_string());
    state.start(device)
}

#[tauri::command]
pub fn stop_recording(state: State<AudioRecorder>) -> Result<RecordingResult, String> {
    state.stop()
}

#[tauri::command]
pub fn is_recording(state: State<AudioRecorder>) -> bool {
    state.is_recording()
}

/// Lista os dispositivos de entrada disponíveis (nome exibido ao usuário).
#[tauri::command]
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|device| device.name().ok())
                .filter(|name| !name.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}