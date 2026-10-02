import {
  SpotifyApiError,
  SpotifyNoActiveDeviceError,
} from "../errors";
import { httpFetch } from "../platform/http";
import type { SpotifyAuthClient } from "./spotifyAuth";

const API_BASE = "https://api.spotify.com/v1";

const SPOTIFY_REQUEST_TIMEOUT_MS = 15_000;

/** Rejeita com SpotifyApiError se a promise não resolver dentro de `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SpotifyApiError(`Tempo limite na requisição ao Spotify (${ms} ms).`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class SpotifyApi {
  constructor(private readonly auth: SpotifyAuthClient) {}

  async request<T>(
    method: "GET" | "PUT" | "POST",
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<T> {
    const token = await this.auth.getAccessToken();
    const response = await withTimeout(
      httpFetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      SPOTIFY_REQUEST_TIMEOUT_MS,
    );

    if (response.status === 401 && retry) {
      await this.auth.forceRefresh();
      return this.request<T>(method, path, body, false);
    }

    if (response.status === 404 || response.status === 403) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { reason?: string; message?: string } }
        | null;
      const reason = payload?.error?.reason ?? "";
      const message = payload?.error?.message ?? "";
      if (
        reason.includes("NO_ACTIVE_DEVICE") ||
        reason.toLowerCase().includes("no active device") ||
        message.toLowerCase().includes("no active device")
      ) {
        throw new SpotifyNoActiveDeviceError(
          "Nenhum dispositivo Spotify ativo foi encontrado. Abra o Spotify em algum dispositivo e tente novamente.",
        );
      }
      throw new SpotifyApiError(
        `Erro do Spotify (status ${response.status}). ${message || `reason: ${reason}`}`.trim(),
      );
    }

    if (!response.ok) {
      throw new SpotifyApiError(`Erro do Spotify (status ${response.status}).`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    // Spotify responde com 200 + request-id em texto puro (não JSON) para
    // comandos de player (pause/resume/next/volume/...). Só interpreta JSON.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      return undefined as T;
    }
  }
}