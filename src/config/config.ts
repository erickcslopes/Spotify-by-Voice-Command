import fs from "node:fs";
import path from "node:path";
import { DEFAULTS, type AppDefaults } from "./defaults";
import type { AliasMap } from "../intents/patterns";
import type { Settings } from "../settings/schema";
import { createSettingsStore } from "../settings/stores";

export interface AppConfig {
  volumeStep: number;
  intentThreshold: number;
  ai: {
    enabled: boolean;
    model: string;
    endpoint: string;
    maxTokens: number;
    timeoutMs: number;
    apiKey: string;
  };
  voice: {
    whisperModel: string;
    whisperBin: string;
    whisperModelPath: string;
    whisperModelsDir: string;
    whisperTimeoutMs: number;
    minRecordingMs: number;
  };
  spotify: {
    clientId: string;
    redirectUri: string;
    callbackPort: number;
  };
  general: AppDefaults["general"];
  pushToTalk: AppDefaults["pushToTalk"];
  aliases: AliasMap;
}

function envValue(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[key];
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadAliases(): AliasMap {
  if (typeof process === "undefined") return {} as AliasMap;
  const file = path.resolve(process.cwd(), "config", "commands.json");
  if (!fs.existsSync(file)) return {} as AliasMap;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as AliasMap;
  } catch {
    return {} as AliasMap;
  }
}

function loadEnvFile(): void {
  if (typeof process === "undefined") return;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  } catch {
    // .env opcional
  }
}

/** Config apenas a partir de .env + defaults (sem settings). */
export function envConfig(): AppConfig {
  const defaults = DEFAULTS;
  return {
    volumeStep: num(envValue("VOLUME_STEP"), defaults.volumeStep),
    intentThreshold: defaults.intentThreshold,
    ai: {
      enabled: (envValue("XAI_API_KEY") ?? "") !== "",
      model: envValue("XAI_MODEL") ?? defaults.ai.model,
      endpoint: defaults.ai.endpoint,
      maxTokens: defaults.ai.maxTokens,
      timeoutMs: defaults.ai.timeoutMs,
      apiKey: envValue("XAI_API_KEY") ?? "",
    },
    voice: {
      whisperModel: envValue("WHISPER_MODEL") ?? defaults.voice.whisperModel,
      whisperBin: envValue("WHISPER_BIN") ?? defaults.voice.whisperBin,
      whisperModelPath: envValue("WHISPER_MODEL_PATH") ?? "",
      whisperModelsDir: envValue("WHISPER_MODELS_DIR") ?? "",
      whisperTimeoutMs: num(
        envValue("WHISPER_TIMEOUT_MS"),
        defaults.voice.whisperTimeoutMs,
      ),
      minRecordingMs: num(
        envValue("MIN_RECORDING_MS"),
        defaults.voice.minRecordingMs,
      ),
    },
    spotify: {
      clientId: envValue("SPOTIFY_CLIENT_ID") ?? "",
      redirectUri:
        envValue("SPOTIFY_REDIRECT_URI") ?? defaults.spotify.redirectUri,
      callbackPort: num(
        envValue("SPOTIFY_CALLBACK_PORT"),
        defaults.spotify.callbackPort,
      ),
    },
    general: { ...defaults.general },
    pushToTalk: { ...defaults.pushToTalk },
    aliases: loadAliases(),
  };
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

/**
 * Precedência: settings persistentes > .env > defaults.
 * Se a settings ainda está no valor padrão, o .env atua como fallback
 * (importante para o fluxo de desenvolvimento sem settings explícitas).
 */
function pick<T>(settingsValue: T, envValue: T, defaultValue: T): T {
  return settingsValue === defaultValue ? envValue : settingsValue;
}

export function configFromSettings(
  settings: Settings,
  base: AppConfig = envConfig(),
): AppConfig {
  return {
    ...base,
    volumeStep: pick(settings.voice.volumeStep, base.volumeStep, DEFAULTS.volumeStep),
    ai: {
      ...base.ai,
      enabled: settings.ai.enabled,
      model: pick(settings.ai.model, base.ai.model, DEFAULTS.ai.model),
    },
    voice: {
      ...base.voice,
      whisperBin: nonEmpty(settings.whisper.binaryPath)
        ? settings.whisper.binaryPath
        : base.voice.whisperBin,
      whisperModelPath: nonEmpty(settings.whisper.modelPath)
        ? settings.whisper.modelPath
        : base.voice.whisperModelPath,
      whisperTimeoutMs: pick(
        settings.whisper.timeoutMs,
        base.voice.whisperTimeoutMs,
        DEFAULTS.voice.whisperTimeoutMs,
      ),
      minRecordingMs: pick(
        settings.voice.minimumRecordingMs,
        base.voice.minRecordingMs,
        DEFAULTS.voice.minRecordingMs,
      ),
    },
    spotify: {
      ...base.spotify,
      clientId: nonEmpty(settings.spotify.clientId)
        ? settings.spotify.clientId
        : base.spotify.clientId,
      redirectUri: nonEmpty(settings.spotify.redirectUri)
        ? settings.spotify.redirectUri
        : base.spotify.redirectUri,
    },
    general: {
      ...base.general,
      startMinimized: settings.general.startMinimized,
      minimizeToTray: settings.general.minimizeToTray,
      startWithWindows: settings.general.startWithWindows,
    },
    pushToTalk: {
      ...base.pushToTalk,
      hotkey: pick(settings.voice.hotkey, base.pushToTalk.hotkey, DEFAULTS.pushToTalk.hotkey),
    },
  };
}

export async function getConfig(): Promise<AppConfig> {
  loadEnvFile();
  const store = await createSettingsStore();
  const settings = await store.load();
  return configFromSettings(settings);
}