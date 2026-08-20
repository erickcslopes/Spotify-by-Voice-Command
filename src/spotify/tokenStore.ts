import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TokenPair, TokenStore } from "./spotifyAuth";

export class FileTokenStore implements TokenStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      path.join(os.homedir(), ".spotify-voice-assistant", "tokens.json");
  }

  async load(): Promise<TokenPair | null> {
    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(content) as TokenPair;
    } catch {
      return null;
    }
  }

  async save(tokens: TokenPair): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(tokens, null, 2), "utf-8");
  }

  async clear(): Promise<void> {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // ignorado
    }
  }
}

export class TauriTokenStore implements TokenStore {
  async load(): Promise<TokenPair | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<TokenPair | null>("token_load")) ?? null;
  }

  async save(tokens: TokenPair): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("token_save", { tokens });
  }

  async clear(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("token_clear");
  }
}