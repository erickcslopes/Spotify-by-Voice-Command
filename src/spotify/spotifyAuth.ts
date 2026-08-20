import { SpotifyNotAuthenticatedError } from "../errors";
import { httpFetch } from "../platform/http";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

export interface TokenPair {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface TokenStore {
  load(): Promise<TokenPair | null>;
  save(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Diferenças de plataforma no fluxo de login (callback local + abrir
 * navegador). O Node usa servidor http próprio; o desktop Tauri delega ao
 * Rust, que escuta na porta local e abre o navegador padrão.
 */
export interface AuthBackend {
  startCallbackServer(port: number, redirectUri: string): Promise<string>;
  openUrl(url: string): Promise<void>;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return base64url(bytes);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  verifier: string,
): string {
  return (
    `${AUTH_ENDPOINT}?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: "S256",
      code_challenge: verifier,
      show_dialog: "true",
    }).toString()
  );
}

async function requestToken(params: URLSearchParams): Promise<TokenPair> {
  const response = await httpFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Falha na autenticação Spotify (status ${response.status}).`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

export async function exchangeCodeForToken(
  clientId: string,
  redirectUri: string,
  code: string,
  verifier: string,
): Promise<TokenPair> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  );
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<TokenPair> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  );
}

/** Backend Node: servidor HTTP local + abertura do navegador via child_process. */
export class NodeAuthBackend implements AuthBackend {
  async startCallbackServer(port: number, redirectUri: string): Promise<string> {
    const { default: http } = await import("node:http");
    return new Promise<string>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const urlObj = new URL(req.url ?? "", redirectUri);
          const code = urlObj.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>Falha na autenticação.</h1>");
            server.close();
            reject(new Error("Autenticação cancelada."));
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Autenticado! Você já pode fechar esta janela.</h1>");
          server.close();
          resolve(code);
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      server.listen(port, "127.0.0.1");
    });
  }

  async openUrl(url: string): Promise<void> {
    const { exec } = await import("node:child_process");
    const opener =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    await new Promise<void>((resolve) => {
      exec(opener, (error) => {
        if (error) {
          console.log("Abra a URL abaixo no navegador para autenticar:\n" + url);
        }
        resolve();
      });
    });
  }
}

/** Backend Tauri: delega ao Rust (callback local + navegador padrão). */
export class TauriAuthBackend implements AuthBackend {
  async startCallbackServer(port: number): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ code?: string }>("auth_open_callback_server", {
      port,
    });
    const code = result?.code;
    if (!code) throw new Error("Autenticação cancelada.");
    return code;
  }

  async openUrl(url: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  }
}

export interface SpotifyAuthOptions {
  clientId: string;
  redirectUri: string;
  callbackPort: number;
  store: TokenStore;
  backend?: AuthBackend;
}

export class SpotifyAuthClient {
  private readonly options: SpotifyAuthOptions;
  private readonly backend: AuthBackend;

  constructor(options: SpotifyAuthOptions) {
    this.options = options;
    this.backend = options.backend ?? new NodeAuthBackend();
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.options.store.load()) !== null;
  }

  /** Retorna o access token válido, renovando se necessário. */
  async getAccessToken(): Promise<string> {
    const tokens = await this.options.store.load();
    if (!tokens || !tokens.refreshToken) {
      throw new SpotifyNotAuthenticatedError("Spotify não autenticado.");
    }
    if (tokens.expiresAt > Date.now()) {
      return tokens.accessToken;
    }
    return this.forceRefresh();
  }

  async forceRefresh(): Promise<string> {
    const tokens = await this.options.store.load();
    if (!tokens?.refreshToken) {
      throw new SpotifyNotAuthenticatedError("Spotify não autenticado.");
    }
    const fresh = await refreshAccessToken(this.options.clientId, tokens.refreshToken);
    await this.options.store.save({
      ...fresh,
      refreshToken: fresh.refreshToken ?? tokens.refreshToken,
    });
    return fresh.accessToken;
  }

  /**
   * Fluxo completo: abre o navegador, escuta o callback local e troca o
   * code por tokens. Bloqueia até concluir.
   */
  async login(): Promise<void> {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const url = buildAuthorizationUrl(
      this.options.clientId,
      this.options.redirectUri,
      challenge,
    );

    const codePromise = this.backend.startCallbackServer(
      this.options.callbackPort,
      this.options.redirectUri,
    );
    await this.backend.openUrl(url);

    const code = await codePromise;
    const tokens = await exchangeCodeForToken(
      this.options.clientId,
      this.options.redirectUri,
      code,
      verifier,
    );
    await this.options.store.save(tokens);
  }

  async logout(): Promise<void> {
    await this.options.store.clear();
  }
}