import { afterEach, describe, expect, it } from "vitest";
import { configFromSettings, envConfig } from "../../src/config/config";
import { applySettings } from "../../src/settings/schema";

const ENV_KEYS = [
  "VOLUME_STEP",
  "XAI_API_KEY",
  "XAI_MODEL",
  "WHISPER_BIN",
  "WHISPER_MODEL_PATH",
  "WHISPER_TIMEOUT_MS",
  "MIN_RECORDING_MS",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_REDIRECT_URI",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("precedência settings > env > defaults", () => {
  it("usa .env quando as settings não preenchem o campo", () => {
    process.env.VOLUME_STEP = "7";
    process.env.WHISPER_BIN = "C:\\whisper.exe";
    const base = envConfig();
    const cfg = configFromSettings(applySettings(null), base);
    expect(cfg.volumeStep).toBe(7);
    expect(cfg.voice.whisperBin).toBe("C:\\whisper.exe");
  });

  it("settings vencem o .env", () => {
    process.env.VOLUME_STEP = "7";
    process.env.WHISPER_BIN = "C:\\env-whisper.exe";
    const base = envConfig();
    const settings = applySettings({
      voice: { volumeStep: 25 },
      whisper: { binaryPath: "C:\\settings-whisper.exe" },
    });
    const cfg = configFromSettings(settings, base);
    expect(cfg.volumeStep).toBe(25);
    expect(cfg.voice.whisperBin).toBe("C:\\settings-whisper.exe");
  });

  it("usa defaults quando nem settings nem env definem", () => {
    const cfg = configFromSettings(applySettings(null), envConfig());
    expect(cfg.volumeStep).toBe(10);
    expect(cfg.voice.whisperTimeoutMs).toBe(60000);
    expect(cfg.pushToTalk.hotkey).toBe("Ctrl+Alt+Space");
  });

  it("mapeia settings → AppConfig (voz, ia, geral, spotify)", () => {
    const settings = applySettings({
      voice: { hotkey: "Ctrl+Alt+Z", minimumRecordingMs: 700, volumeStep: 12 },
      whisper: { binaryPath: "C:\\w.exe", modelPath: "C:\\m.bin", timeoutMs: 30000 },
      ai: { enabled: true, model: "grok-3-mini" },
      general: { startMinimized: true, minimizeToTray: false, startWithWindows: true },
      spotify: { clientId: "abc", redirectUri: "http://127.0.0.1:1420/callback" },
    });
    const cfg = configFromSettings(settings, envConfig());
    expect(cfg.pushToTalk.hotkey).toBe("Ctrl+Alt+Z");
    expect(cfg.voice.minRecordingMs).toBe(700);
    expect(cfg.volumeStep).toBe(12);
    expect(cfg.voice.whisperBin).toBe("C:\\w.exe");
    expect(cfg.voice.whisperModelPath).toBe("C:\\m.bin");
    expect(cfg.voice.whisperTimeoutMs).toBe(30000);
    expect(cfg.ai.enabled).toBe(true);
    expect(cfg.general.startMinimized).toBe(true);
    expect(cfg.general.minimizeToTray).toBe(false);
    expect(cfg.spotify.clientId).toBe("abc");
  });

  it("mantém campo vazio nas settings usando o fallback do env", () => {
    process.env.WHISPER_MODEL_PATH = "C:\\env-model.bin";
    const base = envConfig();
    const settings = applySettings({ whisper: { modelPath: "" } });
    const cfg = configFromSettings(settings, base);
    expect(cfg.voice.whisperModelPath).toBe("C:\\env-model.bin");
  });
});