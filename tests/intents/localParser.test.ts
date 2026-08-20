import { describe, expect, it } from "vitest";
import { LocalIntentParser } from "../../src/intents/localParser";
import { ALIASES } from "../helpers/aliases";

const parser = new LocalIntentParser({ aliases: ALIASES, volumeStep: 10 });

describe("LocalIntentParser", () => {
  const cases: [string, unknown][] = [
    ["pausa", { type: "pause" }],
    ["pause", { type: "pause" }],
    ["para a música", { type: "pause" }],
    ["continua", { type: "resume" }],
    ["volta a tocar", { type: "resume" }],
    ["próxima", { type: "next_track" }],
    ["pula essa", { type: "next_track" }],
    ["passa essa", { type: "next_track" }],
    ["anterior", { type: "previous_track" }],
    ["volta uma", { type: "previous_track" }],
    ["volume 50", { type: "set_volume", value: 50 }],
    ["coloca o volume em 20", { type: "set_volume", value: 20 }],
    ["volume 75 por cento", { type: "set_volume", value: 75 }],
    ["aumenta volume", { type: "change_volume", delta: 10 }],
    ["mais alto", { type: "change_volume", delta: 10 }],
    ["diminui o volume", { type: "change_volume", delta: -10 }],
    ["mais baixo", { type: "change_volume", delta: -10 }],
    ["ativa o aleatório", { type: "shuffle", enabled: true }],
    ["desativa aleatorio", { type: "shuffle", enabled: false }],
    ["repete essa música", { type: "repeat", mode: "track" }],
    ["repete a playlist", { type: "repeat", mode: "context" }],
    ["desativa repetição", { type: "repeat", mode: "off" }],
    ["toca Black Betty", { type: "play_track", query: "Black Betty" }],
    [
      "toca Black Betty do Ram Jam",
      { type: "play_track", query: "Black Betty", artist: "Ram Jam" },
    ],
    ["toca playlist treino", { type: "play_playlist", query: "treino" }],
    ["coloca minha playlist rock", { type: "play_playlist", query: "rock" }],
    ["playlist academia", { type: "play_playlist", query: "academia" }],
    ["que música é essa", { type: "currently_playing" }],
    ["o que tá tocando", { type: "currently_playing" }],
    ["toca artista Ram Jam", { type: "play_artist", query: "Ram Jam" }],
  ];

  for (const [input, expected] of cases) {
    it(`parseia "${input}"`, () => {
      const result = parser.parse(input);
      expect(result.intent).toEqual(expected);
    });
  }

  it("deve ter confiança alta em comandos exatos", () => {
    expect(parser.parse("pausa").confidence).toBe(1);
    expect(parser.parse("próxima").confidence).toBe(1);
  });

  it("deve ter confiança baixa em frases vagas (fallback para IA)", () => {
    expect(parser.parse("toca alguma coisa tranquila").confidence).toBeLessThan(0.85);
    expect(parser.parse("toca aquela música do Ram Jam que eu gosto").confidence).toBeLessThan(0.85);
    expect(parser.parse("coloca alguma coisa parecida com o que estou ouvindo").confidence).toBeLessThan(0.85);
  });

  it("deve ter confiança baixa em comandos compostos (fallback para IA)", () => {
    expect(parser.parse("coloca minha playlist de rock e volume em 30").confidence).toBeLessThan(0.85);
  });

  it("deve retornar unknown para texto irreconhecível", () => {
    const result = parser.parse("blablabla");
    expect(result.intent).toEqual({ type: "unknown", text: "blablabla" });
    expect(result.confidence).toBe(0);
  });

  it("deve ignorar pontuação e maiúsculas", () => {
    expect(parser.parse("  Próxima música! ").intent).toEqual({ type: "next_track" });
    expect(parser.parse("PAUSA.").intent).toEqual({ type: "pause" });
  });

  it("deve clampar volume fora do intervalo", () => {
    const result = parser.parse("volume 150");
    expect(result.intent).toEqual({ type: "set_volume", value: 100 });
  });
});