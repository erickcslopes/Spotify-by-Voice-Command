import { AiInvalidResponseError, AiUnavailableError } from "../errors";
import { httpFetch } from "../platform/http";
import type { ChatCompletionRequest, ChatCompletionResponse, GrokClientOptions } from "./types";

export class GrokClient {
  private readonly options: GrokClientOptions;

  constructor(options: GrokClientOptions) {
    if (!options.apiKey) {
      throw new AiUnavailableError("XAI_API_KEY não configurada.");
    }
    this.options = options;
  }

  async complete(system: string, user: string): Promise<string> {
    const body: ChatCompletionRequest = {
      model: this.options.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: this.options.maxTokens,
      response_format: { type: "json_object" },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await httpFetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AiUnavailableError(`xAI retornou status ${response.status}.`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new AiInvalidResponseError("Resposta vazia do Grok.");
      }
      return content;
    } catch (error) {
      if (error instanceof AiUnavailableError || error instanceof AiInvalidResponseError) {
        throw error;
      }
      throw new AiUnavailableError(`Falha de rede ao chamar o Grok: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}