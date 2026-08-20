import { describe, expect, it, vi } from "vitest";
import { SpotifyAuthClient, type TokenPair } from "../../src/spotify/spotifyAuth";

function makeStore() {
  return {
    load: vi.fn(async (): Promise<TokenPair | null> => null),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
}

function makeClient(store = makeStore()) {
  return new SpotifyAuthClient({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:1420/callback",
    callbackPort: 1420,
    store,
  });
}

describe("SpotifyAuthClient", () => {
  it("logout limpa o store de tokens", async () => {
    const store = makeStore();
    const client = makeClient(store);
    await client.logout();
    expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it("isAuthenticated reflete ausência/presença de tokens", async () => {
    const store = makeStore();
    const client = makeClient(store);
    expect(await client.isAuthenticated()).toBe(false);
    store.load.mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 60_000,
    });
    expect(await client.isAuthenticated()).toBe(true);
  });

  it("getAccessToken usa o token válido sem rede", async () => {
    const store = makeStore();
    store.load.mockResolvedValue({
      accessToken: "token-valido",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    });
    const client = makeClient(store);
    await expect(client.getAccessToken()).resolves.toBe("token-valido");
  });

  it("lança erro quando não autenticado", async () => {
    const client = makeClient();
    await expect(client.getAccessToken()).rejects.toThrow(/autenticado/i);
  });
});