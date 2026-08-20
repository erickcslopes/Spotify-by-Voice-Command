import type { FeedbackService } from "../feedback/feedbackService";
import type { AudioSource, VoiceState } from "./types";
import type { VoiceService } from "./voiceService";

export interface RecordingBackend {
  start(): Promise<void>;
  stop(): Promise<AudioSource>;
}

export interface VoicePipelineOptions {
  backend: RecordingBackend;
  voice: VoiceService;
  /** Único fluxo de execução de texto (CLI, UI e voz usam o mesmo). */
  processCommand: (text: string) => Promise<void>;
  feedback: FeedbackService;
  minRecordingMs: number;
}

export type StateListener = (state: VoiceState) => void;

/**
 * Orquestra push-to-talk: grava → transcreve → processa.
 * Bloqueia concorrência, descarta gravações curtas/silêncio e
 * nunca toca Spotify nem Grok diretamente.
 */
export class VoicePipeline {
  private current: VoiceState = "idle";
  private readonly listeners = new Set<StateListener>();
  lastTranscription: string | null = null;

  constructor(private readonly options: VoicePipelineOptions) {}

  get state(): VoiceState {
    return this.current;
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.current !== "idle") {
      this.options.feedback.say("Aguarde a gravação anterior terminar.");
      return;
    }
    this.setState("recording");
    try {
      await this.options.backend.start();
    } catch (error) {
      this.setState("error");
      this.options.feedback.error(error);
    }
  }

  async stop(): Promise<void> {
    if (this.current !== "recording") return;

    let source: AudioSource;
    try {
      source = await this.options.backend.stop();
    } catch (error) {
      this.setState("error");
      this.options.feedback.error(error);
      return;
    }

    if (source.durationMs < this.options.minRecordingMs) {
      this.setState("idle");
      this.options.feedback.say("Gravação muito curta. Fale novamente.");
      return;
    }

    this.setState("transcribing");

    let text: string;
    try {
      text = await this.options.voice.transcribe(source.path);
    } catch (error) {
      this.setState("error");
      this.options.feedback.error(error);
      return;
    }

    this.lastTranscription = text;

    if (!text.trim()) {
      this.setState("idle");
      this.options.feedback.say("Não detectei nenhum comando.");
      return;
    }

    this.setState("processing");
    try {
      await this.options.processCommand(text);
      this.setState("success");
    } catch (error) {
      this.setState("error");
      this.options.feedback.error(error);
    }
  }

  private setState(state: VoiceState): void {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}