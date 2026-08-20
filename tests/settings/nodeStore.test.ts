import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../../src/settings/schema";
import { NodeSettingsStore } from "../../src/settings/stores";

const tempDirs: string[] = [];

function makeStore(): { store: NodeSettingsStore; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sva-settings-"));
  tempDirs.push(dir);
  const file = path.join(dir, "settings.json");
  return { store: new NodeSettingsStore(file), file };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("NodeSettingsStore", () => {
  it("retorna defaults quando o arquivo não existe", async () => {
    const { store } = makeStore();
    await expect(store.load()).resolves.toEqual(defaultSettings());
  });

  it("retorna defaults para JSON inválido", async () => {
    const { store, file } = makeStore();
    fs.writeFileSync(file, "{ nao é json");
    await expect(store.load()).resolves.toEqual(defaultSettings());
  });

  it("salva e recarrega valores", async () => {
    const { store } = makeStore();
    const s = {
      ...defaultSettings(),
      general: { ...defaultSettings().general, startMinimized: true },
      voice: { ...defaultSettings().voice, volumeStep: 25 },
    };
    await store.save(s);
    await expect(store.load()).resolves.toEqual(s);
  });

  it("sobrevive a arquivo antigo sem campo novo (default aplicado)", async () => {
    const { store, file } = makeStore();
    fs.writeFileSync(file, JSON.stringify({ voice: { hotkey: "Ctrl+Alt+V" } }));
    const s = await store.load();
    expect(s.voice.hotkey).toBe("Ctrl+Alt+V");
    expect(s.general.startWithWindows).toBe(false);
  });

  it("escreve atomicamente (sem arquivo .tmp órfão)", async () => {
    const { store, file } = makeStore();
    await store.save(defaultSettings());
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });
});