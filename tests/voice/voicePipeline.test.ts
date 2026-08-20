import { describe, expect, it, vi } from "vitest";
import { FeedbackService } from "../../src/feedback/feedbackService";
import { SpeechToTextService } from "../../src/voice/speechToText";
import { VoicePipeline } from "../../src/voice/voicePipeline";
import { VoiceService } from "../../src/voice/voiceService";
import type { SpeechToTextProvider } from "../../src/voice/types";

interface Mocks {
  provider: SpeechToTextProvider;
  backend: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  processCommand: ReturnType<typeof vi.fn>;
}

function makePipeline() {
  const provider: SpeechToTextProvider = { transcribe: vi.fn() };
  const backend = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({
      path: "audio.wav",
      format: "wav" as const,
      durationMs: 1000,
    })),
  };
  const processCommand = vi.fn(async () => {});
  const feedback = new FeedbackService();
  const messages: string[] = [];
  feedback.on((m) => messages.push(m));

  const voice = new VoiceService(new SpeechToTextService(provider));
  const pipeline = new VoicePipeline({
    backend,
    voice,
    processCommand,
    feedback,
    minRecordingMs: 300,
  });

  const states: string[] = [];
  pipeline.onStateChange((s) => states.push(s));

  return { pipeline, provider, backend, processCommand, messages, states };
}

describe("VoicePipeline", () => {
  it("transcreve e processa um comando válido", async () => {
    const { pipeline, provider, processCommand, states } = makePipeline();
    (provider.transcribe as ReturnType<typeof vi.fn>).mockResolvedValue("pausa");

    await pipeline.start();
    await pipeline.stop();

    expect(provider.transcribe).toHaveBeenCalledWith("audio.wav");
    expect(processCommand).toHaveBeenCalledWith("pausa");
    expect(states).toContain("recording");
    expect(states).toContain("transcribing");
    expect(states).toContain("processing");
    expect(states).toContain("success");
    expect(pipeline.lastTranscription).toBe("pausa");
  });

  it("descarta silêncio sem executar nada", async () => {
    const { pipeline, provider, processCommand, messages } = makePipeline();
    (provider.transcribe as ReturnType<typeof vi.fn>).mockResolvedValue("");

    await pipeline.start();
    await pipeline.stop();

    expect(processCommand).not.toHaveBeenCalled();
    expect(messages).toContain("Não detectei nenhum comando.");
  });

  it("descarta gravações muito curtas sem transcrever", async () => {
    const { pipeline, provider, backend, processCommand, messages } = makePipeline();
    backend.stop.mockResolvedValueOnce({
      path: "audio.wav",
      format: "wav",
      durationMs: 100,
    });

    await pipeline.start();
    await pipeline.stop();

    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(processCommand).not.toHaveBeenCalled();
    expect(messages.some((m) => m.includes("curta"))).toBe(true);
  });

  it("propaga erro do provider sem executar intent", async () => {
    const { pipeline, provider, processCommand, states } = makePipeline();
    (provider.transcribe as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("whisper falhou"),
    );

    await pipeline.start();
    await pipeline.stop();

    expect(processCommand).not.toHaveBeenCalled();
    expect(states).toContain("error");
  });

  it("bloqueia nova gravação enquanto está ocupado", async () => {
    const { pipeline, backend, messages } = makePipeline();

    await pipeline.start();
    await pipeline.start();

    expect(backend.start).toHaveBeenCalledTimes(1);
    expect(messages.some((m) => m.includes("Aguarde"))).toBe(true);
  });
});