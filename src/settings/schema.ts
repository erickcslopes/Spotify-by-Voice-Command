import { z } from "zod";
import { DEFAULTS } from "../config/defaults";

export const SettingsSchema = z.object({
  general: z
    .object({
      startMinimized: z.boolean().default(DEFAULTS.general.startMinimized),
      minimizeToTray: z.boolean().default(DEFAULTS.general.minimizeToTray),
      startWithWindows: z.boolean().default(DEFAULTS.general.startWithWindows),
    })
    .default({}),
  voice: z
    .object({
      hotkey: z.string().min(1).default(DEFAULTS.pushToTalk.hotkey),
      volumeStep: z.number().int().min(1).max(100).default(DEFAULTS.volumeStep),
      minimumRecordingMs: z
        .number()
        .int()
        .min(100)
        .max(60_000)
        .default(DEFAULTS.voice.minRecordingMs),
      device: z.string().default(""),
    })
    .default({}),
  whisper: z
    .object({
      binaryPath: z.string().default(""),
      modelPath: z.string().default(""),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .default(DEFAULTS.voice.whisperTimeoutMs),
    })
    .default({}),
  ai: z
    .object({
      enabled: z.boolean().default(DEFAULTS.ai.enabled),
      model: z.string().min(1).default(DEFAULTS.ai.model),
    })
    .default({}),
  spotify: z
    .object({
      clientId: z.string().default(""),
      redirectUri: z.string().url().default(DEFAULTS.spotify.redirectUri),
    })
    .default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

/**
 * Valida/mergeia um valor bruto (ex.: conteúdo de settings.json) contra
 * os defaults. Campos ausentes recebem default; valores inválidos também
 * caem nos defaults seguros. Nunca lança.
 */
export function applySettings(raw: unknown): Settings {
  const result = SettingsSchema.safeParse(raw);
  return result.success ? result.data : defaultSettings();
}