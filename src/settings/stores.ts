import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isNode, isTauri } from "../platform/env";
import type { Settings } from "./schema";
import { applySettings } from "./schema";

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

const SETTINGS_DIR = ".spotify-voice-assistant";

export function defaultSettingsFilePath(): string {
  return path.join(os.homedir(), SETTINGS_DIR, "settings.json");
}

export class NodeSettingsStore implements SettingsStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultSettingsFilePath();
  }

  async load(): Promise<Settings> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as unknown;
      return applySettings(raw);
    } catch {
      return applySettings(null);
    }
  }

  async save(settings: Settings): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf-8");
    fs.renameSync(tmp, this.filePath);
  }
}

export class TauriSettingsStore implements SettingsStore {
  async load(): Promise<Settings> {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = (await invoke<unknown>("get_settings")) as unknown;
    return applySettings(raw);
  }

  async save(settings: Settings): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { settings });
  }
}

export class MemorySettingsStore implements SettingsStore {
  private current: Settings;

  constructor(initial?: Settings, private readonly key = "sva.settings") {
    this.current = initial ?? loadFromStorage(key);
  }

  async load(): Promise<Settings> {
    return { ...this.current };
  }

  async save(settings: Settings): Promise<void> {
    this.current = settings;
    try {
      localStorage.setItem(this.key, JSON.stringify(settings));
    } catch {
      // armazenamento indisponível (testes)
    }
  }
}

function loadFromStorage(key: string): Settings {
  try {
    const raw = localStorage.getItem(key);
    return raw ? applySettings(JSON.parse(raw)) : applySettings(null);
  } catch {
    return applySettings(null);
  }
}

export async function createSettingsStore(): Promise<SettingsStore> {
  if (isTauri()) return new TauriSettingsStore();
  if (isNode()) return new NodeSettingsStore();
  return new MemorySettingsStore();
}