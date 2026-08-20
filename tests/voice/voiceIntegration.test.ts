import { describe, expect, it, vi } from "vitest";
import { IntentRouter } from "../../src/intents/intentRouter";
import { LocalIntentParser } from "../../src/intents/localParser";
import { SpeechToTextService } from "../../src/voice/speechToText";
import { VoicePipeline } from "../../src/voice/voicePipeline";
import { VoiceService } from "../../src/voice/voiceService";
import { ALIASES } from "../helpers/aliases";
import { FeedbackService } from "../../src/feedback/feedbackService";

describe("Voz → IntentRouter (integração)", () => {
  it('transcrição "pausa" é resolvida localmente com 0 chamadas ao Grok', async () => {
    const ai = { parse: vi.fn(async () => []) };
    const parser = new LocalIntentParser({ aliases: ALIASES, volumeStep: 10 });
    const router = new IntentRouter({ parser, ai, threshold: 0.85 });

    let routed: { aiCalled: boolean; types: string[] } | null = null;
    const processCommand = async (text: string) => {
      const result = await router.route(text);
      routed = {
        aiCalled: result.aiCalled,
        types: result.results.map((r) => r.intent.type),
      };
    };

    const provider = {
      transcribe: vi.fn(async () => "pausa"),
    };
    const pipeline = new VoicePipeline({
      backend: {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => ({
          path: "audio.wav",
          format: "wav" as const,
          durationMs: 1000,
        })),
      },
      voice: new VoiceService(new SpeechToTextService(provider)),
      processCommand,
      feedback: new FeedbackService(),
      minRecordingMs: 300,
    });

    await pipeline.start();
    await pipeline.stop();

    expect(ai.parse).not.toHaveBeenCalled();
    expect(routed).toEqual({ aiCalled: false, types: ["pause"] });
  });
});