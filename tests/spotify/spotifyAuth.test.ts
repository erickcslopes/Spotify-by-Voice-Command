import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  SpotifyAuthClient,
  TauriAuthBackend,
  type TokenPair,
} from "../../src/spotify/spotifyAuth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
    redirectUri: "http://127.0.0.1:1421/callback",
    callbackPort: 1421,
    store,
  });
}

describe("buildAuthorizationUrl", () => {
  const verifier = "verifier-abc";
  const state = "state-xyz";
  const redirectUri = "http://127.0.0.1:1421/callback";

  it("usa Authorization Code + PKCE (nunca response_type=token)", () => {
    const url = buildAuthorizationUrl("cid-123", redirectUri, verifier, state);
    expect(url).toContain("response_type=code");
    expect(url).not.toContain("response_type=token");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("code_challenge=");
  });

  it("inclui client_id, redirect_uri, code_challenge e state", () => {
    const url = buildAuthorizationUrl("cid-123", redirectUri, verifier, state);
    expect(url).toContain("client_id=cid-123");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
    expect(url).toContain(`code_challenge=${verifier}`);
    expect(url).toContain(`state=${state}`);
    expect(url).toContain("scope=");
  });

  it("preserva o redirect_uri das settings intacto (sem trocar por localhost)", () => {
    const url = buildAuthorizationUrl("cid-123", redirectUri, verifier, state);
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url).not.toContain("localhost");
  });

  it("code_challenge é o SHA-256 base64url do verifier (sem padding)", async () => {
    const v = generateCodeVerifier();
    const challenge = await generateCodeChallenge(v);
    const url = buildAuthorizationUrl("cid", redirectUri, challenge, "s");
    const fromUrl = new URL(url).searchParams.get("code_challenge") ?? "";
    expect(fromUrl).toBe(challenge);
    expect(fromUrl).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromUrl).not.toContain("=");
  });
});

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

  it("login completa o fluxo (URL com PKCE, troca por token e save)", async () => {
    const store = makeStore();
    const backend = {
      startCallbackServer: vi.fn(
        async (_port: number, _redirectUri: string, _state?: string) => "auth-code-123",
      ),
      openUrl: vi.fn(async (_url: string) => {}),
    };
    const client = new SpotifyAuthClient({
      clientId: "cid-abc",
      redirectUri: "http://127.0.0.1:1421/callback",
      callbackPort: 1421,
      store,
      backend,
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            access_token: "tok",
            refresh_token: "rt",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client.login();

    const url = backend.openUrl.mock.calls[0]?.[0] as string;
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=cid-abc");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=");
    expect(url).toContain(`redirect_uri=${encodeURIComponent("http://127.0.0.1:1421/callback")}`);

    const expectedState = backend.startCallbackServer.mock.calls[0]?.[2];
    expect(expectedState).toBeTruthy();
    expect(url).toContain(`state=${expectedState}`);

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=auth-code-123");
    expect(body).toContain("code_verifier=");
    expect(body).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A1421%2Fcallback");
    expect(body).not.toContain("client_secret");

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "tok", refreshToken: "rt" }),
    );
    vi.unstubAllGlobals();
  });

  it("TauriAuthBackend envia a URL OAuth completa ao comando open_url (sem shell)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const backend = new TauriAuthBackend();
    const url =
      "https://accounts.spotify.com/authorize?client_id=abc&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A1421%2Fcallback&scope=user-read-playback-state&code_challenge_method=S256&code_challenge=challenge&state=state-123";
    await backend.openUrl(url);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("open_url", { url });
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).not.toMatch(/cmd|explorer|powershell/i);
  });
});