import { AppError } from "../errors";

export class HotkeyConflictError extends AppError {}

export interface HotkeyBackend {
  set(combo: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Controla a hotkey global com rollback seguro: em conflito, mantém a
 * combinação anterior e propaga erro (nunca derruba o app).
 */
export class HotkeyController {
  private currentCombo: string | null;

  constructor(
    private readonly backend: HotkeyBackend,
    initial: string | null = null,
  ) {
    this.currentCombo = initial;
  }

  get combo(): string | null {
    return this.currentCombo;
  }

  async apply(next: string): Promise<void> {
    const combo = next.trim();
    if (!combo) throw new HotkeyConflictError("A hotkey não pode ficar vazia.");
    try {
      await this.backend.set(combo);
      this.currentCombo = combo;
    } catch {
      throw new HotkeyConflictError(
        "Não foi possível registrar essa combinação. Ela pode estar em uso por outro programa.",
      );
    }
  }

  async clear(): Promise<void> {
    await this.backend.clear();
    this.currentCombo = null;
  }
}