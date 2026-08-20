export interface GrokClientOptions {
  apiKey: string;
  model: string;
  endpoint: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

export interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}