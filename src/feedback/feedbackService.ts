import { AppError } from "../errors";

export type FeedbackListener = (message: string) => void;

function friendlyMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return "Algo deu errado. Verifique os logs.";
  return "Algo deu errado.";
}

export class FeedbackService {
  private readonly listeners = new Set<FeedbackListener>();

  on(listener: FeedbackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  say(message: string): void {
    for (const listener of this.listeners) listener(message);
  }

  error(error: unknown): void {
    this.say(friendlyMessage(error));
  }
}