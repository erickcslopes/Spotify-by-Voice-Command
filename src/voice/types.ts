export interface AudioSource {
  /** Caminho de um arquivo de áudio temporário (WAV mono PCM). */
  path: string;
  format: "wav";
  durationMs: number;
}

export interface SpeechToTextProvider {
  transcribe(audioPath: string): Promise<string>;
}

export type VoiceState =
  | "idle"
  | "recording"
  | "transcribing"
  | "processing"
  | "success"
  | "error";