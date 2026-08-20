import { describe, expect, it, vi } from "vitest";
import { SpeechToTextService } from "../../src/voice/speechToText";
import { VoiceService } from "../../src/voice/voiceService";
import type { SpeechToTextProvider } from "../../src/voice/types";

describe("VoiceService", () => {
  it("transcreve um caminho de áudio via provider", async () => {
    const provider: SpeechToTextProvider = { transcribe: vi.fn(async () => "pausa") };
    const service = new VoiceService(new SpeechToTextService(provider));

    const text = await service.transcribe("audio.wav");

    expect(text).toBe("pausa");
    expect(provider.transcribe).toHaveBeenCalledWith("audio.wav");
  });
});