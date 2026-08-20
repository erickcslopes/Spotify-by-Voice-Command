export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SpotifyNotAuthenticatedError extends AppError {}
export class SpotifyNoActiveDeviceError extends AppError {}
export class SpotifySearchNoResultError extends AppError {}
export class SpotifyApiError extends AppError {}
export class MicrophoneUnavailableError extends AppError {}
export class RecordingError extends AppError {}
export class WhisperBinaryNotFoundError extends AppError {}
export class WhisperModelNotFoundError extends AppError {}
export class SpeechRecognitionError extends AppError {}
export class AiUnavailableError extends AppError {}
export class AiInvalidResponseError extends AppError {}
export class UnknownIntentError extends AppError {}