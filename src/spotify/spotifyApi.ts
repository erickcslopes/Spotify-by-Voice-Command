import {
  SpotifyApiError,
  SpotifyNoActiveDeviceError,
} from "../errors";
import { httpFetch } from "../platform/http";
import type { SpotifyAuthClient } from "./spotifyAuth";

const API_BASE = "https://api.spotify.com/v1";

export class SpotifyApi {
  constructor(private readonly auth: SpotifyAuthClient) {}

  async request<T>(
    method: "GET" | "PUT" | "POST",
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<T> {
    const token = await this.auth.getAccessToken();
    const response = await httpFetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && retry) {
      await this.auth.forceRefresh();
      return this.request<T>(method, path, body, false);
    }

    if (response.status === 404 || response.status === 403) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { reason?: string; message?: string } }
        | null;
      const reason = payload?.error?.reason ?? payload?.error?.message ?? "";
      if (reason.includes("NO_ACTIVE_DEVICE") || reason.toLowerCase().includes("no active device")) {
        throw new SpotifyNoActiveDeviceError(
          "Nenhum dispositivo Spotify ativo foi encontrado. Abra o Spotify em algum dispositivo e tente novamente.",
        );
      }
    }

    if (!response.ok) {
      throw new SpotifyApiError(`Erro do Spotify (status ${response.status}).`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}