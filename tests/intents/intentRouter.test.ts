import { describe, expect, it, vi } from "vitest";
import { IntentRouter } from "../../src/intents/intentRouter";
import { LocalIntentParser } from "../../src/intents/localParser";
import { ALIASES } from "../helpers/aliases";

function makeRouter(ai: { parse: ReturnType<typeof vi.fn> }) {
  const parser = new LocalIntentParser({ aliases: ALIASES, volumeStep: 10 });
  return new IntentRouter({ parser, ai, threshold: 0.85 });
}

describe("IntentRouter", () => {
  it("não chama a IA para comandos simples", async () => {
    const ai = { parse: vi.fn(async () => []) };
    const router = makeRouter(ai);

    for (const text of ["pausa", "próxima", "volume 50", "toca Black Betty"]) {
      const result = await router.route(text);
      expect(result.aiCalled).toBe(false);
      expect(ai.parse).not.toHaveBeenCalled();
    }
  });

  it("chama a IA como fallback para frases vagas", async () => {
    const ai = { parse: vi.fn(async () => [{ type: "pause" }]) };
    const router = makeRouter(ai);

    const result = await router.route("coloca alguma coisa tranquila");
    expect(result.aiCalled).toBe(true);
    expect(ai.parse).toHaveBeenCalledTimes(1);
    expect(result.results[0]?.source).toBe("ai");
  });

  it('"play" é resolvido localmente como resume sem chamar a IA', async () => {
    const ai = { parse: vi.fn(async () => []) };
    const router = makeRouter(ai);

    const result = await router.route("play");
    expect(result.aiCalled).toBe(false);
    expect(ai.parse).not.toHaveBeenCalled();
    expect(result.results[0]?.intent.type).toBe("resume");
    expect(result.results[0]?.source).toBe("local");
  });

  it("chama a IA para comandos compostos", async () => {
    const ai = {
      parse: vi.fn(async () => [
        { type: "play_playlist", query: "rock" },
        { type: "set_volume", value: 30 },
      ]),
    };
    const router = makeRouter(ai);

    const result = await router.route("coloca minha playlist de rock e volume em 30");
    expect(result.aiCalled).toBe(true);
    expect(result.results).toHaveLength(2);
  });
});