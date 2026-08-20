import type { LocalIntentParser } from "./localParser";
import type { Intent, IntentResult } from "./types";

export interface AiFallback {
  parse(text: string): Promise<Intent[]>;
}

export interface IntentRouterOptions {
  parser: LocalIntentParser;
  ai: AiFallback;
  /** Confiança mínima para executar localmente. Abaixo disso, usa o fallback de IA. */
  threshold?: number;
}

export interface RouterResult {
  results: IntentResult[];
  aiCalled: boolean;
}

export class IntentRouter {
  private readonly parser: LocalIntentParser;
  private readonly ai: AiFallback;
  private readonly threshold: number;

  constructor(options: IntentRouterOptions) {
    this.parser = options.parser;
    this.ai = options.ai;
    this.threshold = options.threshold ?? 0.85;
  }

  async route(input: string): Promise<RouterResult> {
    const local = this.parser.parse(input);

    if (local.confidence >= this.threshold) {
      return { results: [local], aiCalled: false };
    }

    const intents = await this.ai.parse(input);
    const results: IntentResult[] = intents.map((intent) => ({
      intent,
      confidence: 0.9,
      source: "ai",
    }));

    return { results, aiCalled: true };
  }
}