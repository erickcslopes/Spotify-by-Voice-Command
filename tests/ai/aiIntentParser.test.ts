import { describe, expect, it, vi } from "vitest";
import { AiIntentParser } from "../../src/ai/aiIntentParser";
import type { GrokClient } from "../../src/ai/grokClient";
import { AiInvalidResponseError } from "../../src/errors";

function makeParser(complete: (system: string, user: string) => Promise<string>) {
  const client = { complete } as unknown as GrokClient;
  return new AiIntentParser(client);
}

describe("AiIntentParser", () => {
  it("converte JSON válido do Grok em intents", async () => {
    const parser = makeParser(
      vi.fn(async () =>
        JSON.stringify({
          actions: [
            { type: "play_playlist", query: "rock" },
            { type: "set_volume", value: 30 },
          ],
        }),
      ),
    );

    const intents = await parser.parse("coloca minha playlist de rock e volume em 30");
    expect(intents).toEqual([
      { type: "play_playlist", query: "rock" },
      { type: "set_volume", value: 30 },
    ]);
  });

  it("rejeita JSON inválido", async () => {
    const parser = makeParser(vi.fn(async () => "isto não é json"));
    await expect(parser.parse("x")).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it("rejeita ações fora do schema permitido", async () => {
    const parser = makeParser(
      vi.fn(async () => JSON.stringify({ actions: [{ type: "delete_playlist" }] })),
    );
    await expect(parser.parse("x")).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it("rejeita valores inválidos (volume > 100)", async () => {
    const parser = makeParser(
      vi.fn(async () => JSON.stringify({ actions: [{ type: "set_volume", value: 500 }] })),
    );
    await expect(parser.parse("x")).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it("rejeita respostas vazias", async () => {
    const parser = makeParser(vi.fn(async () => ""));
    await expect(parser.parse("x")).rejects.toBeInstanceOf(AiInvalidResponseError);
  });
});