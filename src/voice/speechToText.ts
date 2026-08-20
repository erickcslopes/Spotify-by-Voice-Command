import type { SpeechToTextProvider } from "./types";

/** Serviço de transcrição. O provider pode ser trocado sem afetar o restante. */
export class SpeechToTextService {
  constructor(private readonly provider: SpeechToTextProvider) {}

  transcribe(audioPath: string): Promise<string> {
    return this.provider.transcribe(audioPath);
  }
}