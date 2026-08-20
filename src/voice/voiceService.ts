import type { SpeechToTextService } from "./speechToText";

/**
 * Camada de voz. Conhece apenas caminho de áudio → texto.
 * Não conhece Spotify nem intents.
 */
export class VoiceService {
  constructor(private readonly stt: SpeechToTextService) {}

  transcribe(audioPath: string): Promise<string> {
    return this.stt.transcribe(audioPath);
  }
}