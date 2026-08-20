export const DEFAULTS = {
  volumeStep: 10,
  intentThreshold: 0.85,
  ai: {
    enabled: true,
    model: "grok-3-mini",
    endpoint: "https://api.xai.com/v1/chat/completions",
    maxTokens: 256,
    timeoutMs: 8000,
  },
  voice: {
    whisperModel: "base",
    whisperBin: "whisper-cli",
    whisperModelPath: "",
    whisperModelsDir: "",
    whisperTimeoutMs: 60000,
    minRecordingMs: 300,
  },
  spotify: {
    callbackPort: 1420,
    redirectUri: "http://127.0.0.1:1420/callback",
  },
  general: {
    startMinimized: false,
    minimizeToTray: true,
    startWithWindows: false,
  },
  pushToTalk: {
    hotkey: "Ctrl+Alt+Space",
  },
};

export type AppDefaults = typeof DEFAULTS;

export const SETTINGS_FILE_NAME = "settings.json";