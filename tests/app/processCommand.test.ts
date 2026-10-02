import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildApp } from "../../src/app/bootstrap";
import { DEFAULTS } from "../../src/config/defaults";
import type { AppConfig } from "../../src/config/config";
import type { TokenPair } from "../../src/spotify/spotifyAuth";
import { FeedbackService } from "../../src/feedback/feedbackService";
import { ALIASES } from "../helpers/aliases";

const { httpFetchMock } = vi.hoisted(() => ({
  httpFetchMock: vi.fn<typeof fetch>(),
}));
vi.mock("../../src/platform/http", () => ({
  httpFetch: (...args: Parameters<typeof fetch>) => httpFetchMock(...args),
}));

const config: AppConfig = {
  ...DEFAULTS,
  aliases: ALIASES,
  ai: { ...DEFAULTS.ai, enabled: false, apiKey: "" },
  spotify: {
    ...DEFAULTS.spotify,
    clientId: "test-client",
  },
};

const tokenStore: {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} = {
  load: vi.fn(async () => ({
    accessToken: "token-abc",
    refreshToken: "refresh-xyz",
    expiresAt: Date.now() + 3600_000,
  })),
  save: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
};

async function makeApp() {
  const feedback = new FeedbackService();
  const messages: string[] = [];
  feedback.on((message) => messages.push(message));
  const app = await buildApp(config, {
    tokenStore: tokenStore as never,
    feedback,
  });
  return { app, messages };
}

describe("processCommand (fluxo único texto → Spotify)", () => {
  beforeEach(() => {
    httpFetchMock.mockReset();
  });

  it('"pausa" é resolvida localmente e chama o player do Spotify 1x', async () => {
    httpFetchMock.mockResolvedValueOnce(
      new Response("req-id-texto", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const { app, messages } = await makeApp();

    await app.processCommand("pausa");

    expect(httpFetchMock).toHaveBeenCalledTimes(1);
    expect(String(httpFetchMock.mock.calls[0]![0])).toContain(
      "/me/player/pause",
    );
    expect(messages).toContain("Pausado");
    expect(app.state.lastIntent).toBe("pause");
    expect(app.state.lastSource).toBe("local");
    expect(app.state.lastError).toBeNull();
    expect(app.metrics.local).toBe(1);
    expect(app.metrics.ai).toBe(0);
  });

  it('"próxima" vira next_track e chama o player', async () => {
    httpFetchMock.mockResolvedValueOnce(
      new Response("req-id-2", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const { app, messages } = await makeApp();

    await app.processCommand("próxima");

    expect(String(httpFetchMock.mock.calls[0]![0])).toContain("/me/player/next");
    expect(messages).toContain("Próxima música");
    expect(app.state.lastIntent).toBe("next_track");
  });

  it("erro do Spotify (NO_ACTIVE_DEVICE) é propagado ao feedback e ao estado, sem lançar", async () => {
    httpFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { status: 403, message: "Player command failed", reason: "NO_ACTIVE_DEVICE" },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { app, messages } = await makeApp();

    await expect(app.processCommand("pausa")).resolves.toBeUndefined();

    expect(app.state.lastError).toContain("Nenhum dispositivo Spotify ativo");
    expect(messages.some((m) => m.includes("Nenhum dispositivo"))).toBe(true);
  });

  it("comando simples nunca chama o Grok", async () => {
    httpFetchMock.mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const { app } = await makeApp();
    await app.processCommand("volume 50");
    expect(app.metrics.ai).toBe(0);
  });
});