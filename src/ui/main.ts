import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import commands from "../../config/commands.json";
import { buildApp, type App } from "../app/bootstrap";
import { configFromSettings, envConfig } from "../config/config";
import { FeedbackService } from "../feedback/feedbackService";
import type { AliasMap } from "../intents/patterns";
import { IntentRouter } from "../intents/intentRouter";
import { LocalIntentParser } from "../intents/localParser";
import { isTauri } from "../platform/env";
import type { Settings } from "../settings/schema";
import { TauriSettingsStore } from "../settings/stores";
import { TauriAuthBackend } from "../spotify/spotifyAuth";
import { TauriTokenStore } from "../spotify/tokenStore";
import { SpeechToTextService } from "../voice/speechToText";
import { HotkeyConflictError, HotkeyController } from "../voice/hotkeyController";
import type { VoiceState } from "../voice/types";
import { VoicePipeline } from "../voice/voicePipeline";
import { VoiceService } from "../voice/voiceService";

const isDesktop = isTauri();

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const mainView = document.getElementById("view-main") as HTMLElement;
const settingsView = document.getElementById("view-settings") as HTMLElement;
const navMain = document.getElementById("nav-main") as HTMLButtonElement;
const navSettings = document.getElementById("nav-settings") as HTMLButtonElement;
const bannerEl = document.getElementById("banner") as HTMLElement;

const spotifyStatusEl = document.getElementById("spotify-status") as HTMLSpanElement;
const whisperStatusEl = document.getElementById("whisper-status") as HTMLSpanElement;
const grokStatusEl = document.getElementById("grok-status") as HTMLSpanElement;
const hotkeyStatusEl = document.getElementById("hotkey-status") as HTMLSpanElement;

const talkButton = document.getElementById("talk") as HTMLButtonElement;
const voiceStateEl = document.getElementById("voice-state") as HTMLSpanElement;
const transcriptionEl = document.getElementById("last-transcription") as HTMLElement;
const intentEl = document.getElementById("last-intent") as HTMLElement;
const resultEl = document.getElementById("last-result") as HTMLElement;
const input = document.getElementById("command") as HTMLInputElement;
const send = document.getElementById("send") as HTMLButtonElement;
const output = document.getElementById("output") as HTMLPreElement;

const spotifyStatusDetail = document.getElementById("spotify-status-detail") as HTMLSpanElement;
const whisperValidationEl = document.getElementById("whisper-validation") as HTMLElement;
const aiKeyStatusEl = document.getElementById("ai-key-status") as HTMLElement;

// Settings inputs
const setStartMinimized = document.getElementById("set-start-minimized") as HTMLInputElement;
const setMinimizeToTray = document.getElementById("set-minimize-to-tray") as HTMLInputElement;
const setStartWithWindows = document.getElementById("set-start-with-windows") as HTMLInputElement;
const setClientId = document.getElementById("set-spotify-client-id") as HTMLInputElement;
const setRedirectUri = document.getElementById("set-spotify-redirect-uri") as HTMLInputElement;
const setHotkey = document.getElementById("set-hotkey") as HTMLInputElement;
const setVolumeStep = document.getElementById("set-volume-step") as HTMLInputElement;
const setMinRecording = document.getElementById("set-min-recording") as HTMLInputElement;
const setWhisperBin = document.getElementById("set-whisper-bin") as HTMLInputElement;
const setWhisperModel = document.getElementById("set-whisper-model") as HTMLInputElement;
const setWhisperTimeout = document.getElementById("set-whisper-timeout") as HTMLInputElement;
const setAiEnabled = document.getElementById("set-ai-enabled") as HTMLInputElement;
const setAiModel = document.getElementById("set-ai-model") as HTMLInputElement;
const setAiKey = document.getElementById("set-ai-key") as HTMLInputElement;

const aliases = commands as unknown as AliasMap;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const feedback = new FeedbackService();
let app: App | null = null;
let pipeline: VoicePipeline | null = null;
let settings: Settings | null = null;
let hotkeyController: HotkeyController | null = null;

const stateLabels: Record<VoiceState, string> = {
  idle: "Pronto",
  recording: "Ouvindo...",
  transcribing: "Transcrevendo...",
  processing: "Executando...",
  success: "Concluído",
  error: "Erro",
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function banner(message: string, isError = false): void {
  bannerEl.textContent = message;
  bannerEl.classList.toggle("hidden", !message);
  bannerEl.classList.toggle("error", isError);
}

function renderVoiceState(state: VoiceState): void {
  voiceStateEl.textContent = stateLabels[state] ?? state;
  talkButton.classList.toggle("recording", state === "recording");
  talkButton.disabled = state === "transcribing" || state === "processing";
}

function renderResults(): void {
  if (!app) return;
  intentEl.textContent = app.state.lastIntent ?? "—";
  resultEl.textContent = app.state.lastResult ?? "—";
}

function setStatus(el: HTMLElement, ok: boolean, okText: string, badText: string): void {
  el.textContent = ok ? okText : badText;
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok);
}

function setView(view: "main" | "settings"): void {
  mainView.classList.toggle("hidden", view !== "main");
  settingsView.classList.toggle("hidden", view !== "settings");
  navMain.classList.toggle("active", view === "main");
  navSettings.classList.toggle("active", view === "settings");
}

function setTab(tab: string): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  for (const el of document.querySelectorAll<HTMLElement>(".tab")) {
    el.classList.toggle("hidden", el.id !== `tab-${tab}`);
  }
}

// ---------------------------------------------------------------------------
// Processamento de texto
// ---------------------------------------------------------------------------
async function processText(text: string): Promise<void> {
  const target = text.trim();
  if (!target) return;
  if (app) {
    await app.processCommand(target);
    renderResults();
    return;
  }
  const router = new IntentRouter({
    parser: new LocalIntentParser({ aliases, volumeStep: 10 }),
    ai: { parse: async () => [] },
    threshold: 0.85,
  });
  const result = await router.route(target);
  intentEl.textContent = result.results.map((r) => r.intent.type).join(", ") || "—";
  output.textContent = JSON.stringify(
    { input: target, aiCalled: result.aiCalled, results: result.results },
    null,
    2,
  );
  feedback.say(
    result.results.length === 0
      ? "Não consegui interpretar esse comando."
      : `Detectado: ${intentEl.textContent} (${result.aiCalled ? "IA" : "local"})`,
  );
}

// ---------------------------------------------------------------------------
// Desktop: app + voz
// ---------------------------------------------------------------------------
function wirePipeline(): void {
  if (!app) return;
  pipeline = new VoicePipeline({
    backend: {
      start: () => invoke("start_recording"),
      stop: async () => {
        const res = await invoke<{ path: string; duration_ms: number }>("stop_recording");
        return { path: res.path, format: "wav", durationMs: res.duration_ms };
      },
    },
    voice: new VoiceService(
      new SpeechToTextService({
        transcribe: (path) => invoke<string>("transcribe_audio", { path }),
      }),
    ),
    processCommand: async (text) => {
      transcriptionEl.textContent = text;
      await processText(text);
    },
    feedback,
    minRecordingMs: settings?.voice.minimumRecordingMs ?? 300,
  });
  pipeline.onStateChange(renderVoiceState);
}

async function rebuildApp(): Promise<void> {
  if (!settings) return;
  const apiKey = await invoke<string>("ai_get_api_key");
  const config = configFromSettings(settings, { ...envConfig(), aliases });
  app = await buildApp(config, {
    tokenStore: new TauriTokenStore(),
    authBackend: new TauriAuthBackend(),
    aiApiKey: apiKey,
    feedback,
  });
  wirePipeline();
  renderResults();
  await refreshStatus();
}

async function refreshStatus(): Promise<void> {
  if (!app || !settings) return;
  setStatus(
    spotifyStatusEl,
    app.state.spotifyConnected,
    "● conectado",
    "○ desconectado",
  );
  spotifyStatusDetail.textContent = app.state.spotifyConnected ? "conectado" : "desconectado";

  const whisperConfigured = settings.whisper.binaryPath.trim() !== "";
  setStatus(
    whisperStatusEl,
    whisperConfigured,
    "● configurado",
    "○ não configurado",
  );

  const hasKey = await invoke<boolean>("ai_has_api_key");
  const grokOk = settings.ai.enabled && hasKey;
  setStatus(grokStatusEl, grokOk, "● configurado", "○ não configurado");

  hotkeyStatusEl.textContent = settings.voice.hotkey || "—";
}

async function persistSettings(next: Settings): Promise<void> {
  settings = next;
  await new TauriSettingsStore().save(next);
  await rebuildApp();
  banner("Configurações salvas.");
}

async function refreshAiKeyStatus(): Promise<void> {
  const has = await invoke<boolean>("ai_has_api_key");
  aiKeyStatusEl.textContent = has ? "Configurada" : "Não configurada";
}

async function validateWhisper(): Promise<{ ok: boolean; message: string }> {
  const res = await invoke<{ ok: boolean; message: string }>("validate_whisper");
  whisperValidationEl.textContent = res.message;
  whisperValidationEl.classList.toggle("ok", res.ok);
  whisperValidationEl.classList.toggle("error", !res.ok);
  return res;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
feedback.on((message) => {
  resultEl.textContent = message;
  banner(message);
});

navMain.addEventListener("click", () => setView("main"));
navSettings.addEventListener("click", () => setView("settings"));

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
  btn.addEventListener("click", () => setTab(btn.dataset.tab ?? "general"));
}

talkButton.addEventListener("pointerdown", () => {
  if (pipeline) void pipeline.start();
  else banner("Voz disponível no desktop (Tauri).");
});
talkButton.addEventListener("pointerup", () => void pipeline?.stop());
talkButton.addEventListener("pointerleave", () => void pipeline?.stop());

send.addEventListener("click", () => void processText(input.value.trim()));
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void processText(input.value.trim());
});

// ------------------------------ Settings: General --------------------------
document.getElementById("save-general")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.general.startMinimized = setStartMinimized.checked;
  settings.general.minimizeToTray = setMinimizeToTray.checked;
  settings.general.startWithWindows = setStartWithWindows.checked;
  if (isDesktop) {
    try {
      if (setStartWithWindows.checked) await enableAutostart();
      else await disableAutostart();
    } catch (error) {
      banner(`Falha ao alterar inicialização com o Windows: ${String(error)}`, true);
    }
  }
  await persistSettings(settings);
});

// ------------------------------ Settings: Spotify --------------------------
document.getElementById("spotify-connect")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.spotify.clientId = setClientId.value.trim();
  settings.spotify.redirectUri = setRedirectUri.value.trim();
  if (!settings.spotify.clientId) {
    banner("Defina o Client ID do Spotify primeiro.", true);
    return;
  }
  await persistSettings(settings);
  try {
    await app?.auth.login();
    if (app) app.state.spotifyConnected = true;
    banner("Conectado ao Spotify!");
  } catch (error) {
    banner(`Falha ao conectar: ${String(error)}`, true);
  }
  await refreshStatus();
});

document.getElementById("spotify-disconnect")?.addEventListener("click", async () => {
  await app?.auth.logout();
  if (app) app.state.spotifyConnected = false;
  banner("Desconectado do Spotify.");
  await refreshStatus();
});

document.getElementById("save-spotify")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.spotify.clientId = setClientId.value.trim();
  settings.spotify.redirectUri = setRedirectUri.value.trim();
  await persistSettings(settings);
});

// ------------------------------ Settings: Voice ---------------------------
document.getElementById("apply-hotkey")?.addEventListener("click", async () => {
  if (!settings || !hotkeyController) return;
  const combo = setHotkey.value.trim();
  if (!combo) {
    banner("A hotkey não pode ficar vazia.", true);
    return;
  }
  try {
    await hotkeyController.apply(combo);
    settings.voice.hotkey = combo;
    await new TauriSettingsStore().save(settings);
    banner("Hotkey atualizada.");
    hotkeyStatusEl.textContent = combo;
  } catch (error) {
    banner(
      error instanceof HotkeyConflictError ? error.message : String(error),
      true,
    );
    setHotkey.value = settings.voice.hotkey;
  }
});

document.getElementById("save-voice")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.voice.volumeStep = clampNumber(setVolumeStep.value, 1, 100, 10);
  settings.voice.minimumRecordingMs = clampNumber(setMinRecording.value, 100, 60000, 300);
  settings.voice.hotkey = setHotkey.value.trim() || settings.voice.hotkey;
  await persistSettings(settings);
});

// ------------------------------ Settings: Whisper --------------------------
document.getElementById("pick-whisper-bin")?.addEventListener("click", async () => {
  const sel = await open({
    multiple: false,
    filters: [{ name: "Executável", extensions: ["exe"] }],
  });
  if (typeof sel === "string" && sel) setWhisperBin.value = sel;
});

document.getElementById("pick-whisper-model")?.addEventListener("click", async () => {
  const sel = await open({
    multiple: false,
    filters: [{ name: "Modelo Whisper", extensions: ["bin"] }],
  });
  if (typeof sel === "string" && sel) setWhisperModel.value = sel;
});

document.getElementById("validate-whisper")?.addEventListener("click", async () => {
  await validateWhisper();
  await refreshStatus();
});

document.getElementById("save-whisper")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.whisper.binaryPath = setWhisperBin.value.trim();
  settings.whisper.modelPath = setWhisperModel.value.trim();
  settings.whisper.timeoutMs = clampNumber(setWhisperTimeout.value, 1000, 600000, 60000);
  await persistSettings(settings);
  await validateWhisper();
});

// ------------------------------ Settings: AI ------------------------------
document.getElementById("save-ai-key")?.addEventListener("click", async () => {
  const key = setAiKey.value.trim();
  await invoke("ai_set_api_key", { key });
  setAiKey.value = "";
  await refreshAiKeyStatus();
  banner(key ? "Chave salva no keyring do sistema." : "Chave removida.");
});

document.getElementById("save-ai")?.addEventListener("click", async () => {
  if (!settings) return;
  settings.ai.enabled = setAiEnabled.checked;
  settings.ai.model = setAiModel.value.trim() || "grok-3-mini";
  await persistSettings(settings);
  await refreshAiKeyStatus();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function loadSettingsIntoForm(s: Settings): void {
  setStartMinimized.checked = s.general.startMinimized;
  setMinimizeToTray.checked = s.general.minimizeToTray;
  setStartWithWindows.checked = s.general.startWithWindows;
  setClientId.value = s.spotify.clientId;
  setRedirectUri.value = s.spotify.redirectUri;
  setHotkey.value = s.voice.hotkey;
  setVolumeStep.value = String(s.voice.volumeStep);
  setMinRecording.value = String(s.voice.minimumRecordingMs);
  setWhisperBin.value = s.whisper.binaryPath;
  setWhisperModel.value = s.whisper.modelPath;
  setWhisperTimeout.value = String(s.whisper.timeoutMs);
  setAiEnabled.checked = s.ai.enabled;
  setAiModel.value = s.ai.model;
}

async function initDesktop(): Promise<void> {
  const store = new TauriSettingsStore();
  settings = await store.load();
  loadSettingsIntoForm(settings);

  hotkeyController = new HotkeyController({
    set: (combo) => invoke("hotkey_set", { combo }),
    clear: () => invoke("hotkey_clear"),
  }, settings.voice.hotkey);

  await rebuildApp();
  await refreshAiKeyStatus();
  if (settings.whisper.binaryPath.trim()) void validateWhisper();

  await listen("voice:hotkey-down", () => void pipeline?.start());
  await listen("voice:hotkey-up", () => void pipeline?.stop());
  await listen("voice:tray-toggle", () => {
    if (!pipeline) return;
    if (pipeline.state === "recording") void pipeline.stop();
    else void pipeline.start();
  });
  await listen("open-settings", () => setView("settings"));

  banner("Pronto. Use o botão Falar ou a hotkey global.");
  setView("main");
}

function initBrowser(): void {
  banner("Modo navegador: demonstração do parser (sem voz, Spotify ou IA).");
  navSettings.classList.add("hidden");
  spotifyStatusEl.textContent = "—";
  whisperStatusEl.textContent = "—";
  grokStatusEl.textContent = "—";
  hotkeyStatusEl.textContent = "—";
  setView("main");
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

if (isDesktop) {
  void initDesktop().catch((error) => {
    banner(`Erro ao iniciar: ${String(error)}`, true);
  });
} else {
  initBrowser();
}
