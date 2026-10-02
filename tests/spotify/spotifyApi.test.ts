import { describe, expect, it, vi, beforeEach } from "vitest";
import { SpotifyApi } from "../../src/spotify/spotifyApi";
import {
  SpotifyApiError,
  SpotifyNoActiveDeviceError,
} from "../../src/errors";
import type { SpotifyAuthClient } from "../../src/spotify/spotifyAuth";

const { httpFetchMock } = vi.hoisted(() => ({
  httpFetchMock: vi.fn<typeof fetch>(),
}));
vi.mock("../../src/platform/http", () => ({
  httpFetch: (...args: Parameters<typeof fetch>) => httpFetchMock(...args),
}));

function makeApi(auth: Partial<SpotifyAuthClient> = {}): SpotifyApi {
  const client = {
    getAccessToken: vi.fn(async () => "token-123"),
    forceRefresh: vi.fn(async () => {}),
    ...auth,
  } as unknown as SpotifyAuthClient;
  return new SpotifyApi(client);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SpotifyApi.request", () => {
  beforeEach(() => {
    httpFetchMock.mockReset();
  });

  it("200 com corpo texto (request-id) de comando de player não lança e retorna undefined", async () => {
    httpFetchMock.mockResolvedValueOnce(
      new Response("8KEw-Rqckpl-DaIIy5UX7Atz7i0", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const api = makeApi();
    const result = await api.request<void>("PUT", "/me/player/pause");
    expect(result).toBeUndefined();
  });

  it("204 sem corpo retorna undefined", async () => {
    httpFetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = makeApi();
    expect(await api.request<void>("PUT", "/me/player/play")).toBeUndefined();
  });

  it("200 com JSON é interpretado e devolvido", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse({ is_playing: true, item: { name: "Black Betty" } }),
    );
    const api = makeApi();
    const result = await api.request<{ is_playing: boolean }>(
      "GET",
      "/me/player",
    );
    expect(result.is_playing).toBe(true);
  });

  it("403 NO_ACTIVE_DEVICE vira SpotifyNoActiveDeviceError", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { status: 403, message: "Player command failed", reason: "NO_ACTIVE_DEVICE" },
        },
        403,
      ),
    );
    const api = makeApi();
    await expect(api.request<void>("PUT", "/me/player/pause")).rejects.toBeInstanceOf(
      SpotifyNoActiveDeviceError,
    );
  });

  it("403 com reason incluída na mensagem do erro", async () => {
    httpFetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { status: 403, message: "Player command failed: Restriction violated", reason: "UNKNOWN" },
        },
        403,
      ),
    );
    const api = makeApi();
    const promise = api.request<void>("PUT", "/me/player/pause");
    await expect(promise).rejects.toBeInstanceOf(SpotifyApiError);
    await promise.catch((error: SpotifyApiError) => {
      expect(error.message).toContain("Restriction violated");
    });
  });

  it("401 renova o token uma vez e reexecuta", async () => {
    httpFetchMock
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(
        new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } }),
      );
    const forceRefresh = vi.fn(async (): Promise<string> => "token-novo");
    const api = makeApi({ forceRefresh });
    await api.request<void>("PUT", "/me/player/pause");
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(httpFetchMock).toHaveBeenCalledTimes(2);
  });

  it("requisição lenta respeita o timeout e rejeita com SpotifyApiError", async () => {
    vi.useFakeTimers();
    httpFetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const api = makeApi();
    const promise = api.request<void>("GET", "/me/player");
    const assertion = expect(promise).rejects.toBeInstanceOf(SpotifyApiError);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    vi.useRealTimers();
  });
});