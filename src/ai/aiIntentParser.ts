import type { Intent } from "../intents/types";
import { AiResponseSchema } from "../intents/schemas";
import { AiInvalidResponseError } from "../errors";
import type { GrokClient } from "./grokClient";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";

export class AiIntentParser {
  constructor(private readonly client: GrokClient) {}

  async parse(text: string): Promise<Intent[]> {
    const content = await this.client.complete(SYSTEM_PROMPT, buildUserMessage(text));

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiInvalidResponseError("Grok devolveu JSON inválido.");
    }

    const result = AiResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new AiInvalidResponseError("Resposta do Grok fora do schema permitido.");
    }

    return result.data.actions as Intent[];
  }
}