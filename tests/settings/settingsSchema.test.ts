import { describe, expect, it } from "vitest";
import { applySettings, defaultSettings } from "../../src/settings/schema";

describe("Settings schema", () => {
  it("cria defaults seguros para entrada nula/vazia", () => {
    expect(applySettings(null)).toEqual(defaultSettings());
    expect(applySettings({})).toEqual(defaultSettings());
    expect(applySettings(undefined)).toEqual(defaultSettings());
  });

  it("tem a estrutura esperada com defaults", () => {
    const s = defaultSettings();
    expect(s.general.startMinimized).toBe(false);
    expect(s.general.minimizeToTray).toBe(true);
    expect(s.general.startWithWindows).toBe(false);
    expect(s.voice.hotkey).toBe("Ctrl+Alt+Space");
    expect(s.voice.volumeStep).toBe(10);
    expect(s.voice.minimumRecordingMs).toBe(300);
    expect(s.whisper.timeoutMs).toBe(60000);
    expect(s.ai.enabled).toBe(true);
    expect(s.ai.model).toBe("grok-3-mini");
  });

  it("aplica defaults para campos ausentes em arquivos antigos", () => {
    const old = {
      general: { minimizeToTray: false },
      voice: { hotkey: "Ctrl+Alt+M" },
    };
    const s = applySettings(old);
    expect(s.general.minimizeToTray).toBe(false);
    expect(s.general.startMinimized).toBe(false);
    expect(s.general.startWithWindows).toBe(false);
    expect(s.voice.hotkey).toBe("Ctrl+Alt+M");
    expect(s.voice.volumeStep).toBe(10);
    expect(s.whisper.modelPath).toBe("");
  });

  it("preserva campos válidos informados", () => {
    const s = applySettings({
      general: { startMinimized: true, startWithWindows: true },
      voice: { volumeStep: 15, minimumRecordingMs: 500 },
      whisper: { binaryPath: "C:\\whisper-cli.exe", modelPath: "C:\\ggml-base.bin" },
      ai: { enabled: false, model: "grok-3-mini" },
    });
    expect(s.general.startMinimized).toBe(true);
    expect(s.general.startWithWindows).toBe(true);
    expect(s.voice.volumeStep).toBe(15);
    expect(s.voice.minimumRecordingMs).toBe(500);
    expect(s.whisper.binaryPath).toBe("C:\\whisper-cli.exe");
    expect(s.ai.enabled).toBe(false);
  });

  it("rejeita valores inválidos e cai nos defaults", () => {
    const s = applySettings({
      voice: { volumeStep: 999, hotkey: "" },
      whisper: { timeoutMs: -5 },
    });
    expect(s.voice.volumeStep).toBe(10);
    expect(s.voice.hotkey).toBe("Ctrl+Alt+Space");
    expect(s.whisper.timeoutMs).toBe(60000);
  });

  it("rejeita JSON totalmente inválido (tipos errados)", () => {
    const s = applySettings({ general: "não é um objeto", voice: [1, 2, 3] });
    expect(s).toEqual(defaultSettings());
  });

  it("voice.device: default vazio, preserva seleção e default em arquivo antigo", () => {
    expect(defaultSettings().voice.device).toBe("");
    const s = applySettings({ voice: { device: "Microfone (Realtek)" } });
    expect(s.voice.device).toBe("Microfone (Realtek)");
    expect(applySettings({ voice: { hotkey: "Ctrl+Alt+V" } }).voice.device).toBe("");
  });
});