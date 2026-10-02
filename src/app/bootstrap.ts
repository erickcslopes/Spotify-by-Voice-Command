import { AiIntentParser } from "../ai/aiIntentParser";
import { GrokClient } from "../ai/grokClient";
import type { AppConfig } from "../config/config";
import { FeedbackService } from "../feedback/feedbackService";
import type { Intent } from "../intents/types";
import { IntentRouter, type AiFallback } from "../intents/intentRouter";
import { LocalIntentParser } from "../intents/localParser";
import { SpotifyApi } from "../spotify/spotifyApi";
import {
  SpotifyAuthClient,
  type AuthBackend,
  type TokenStore,
} from "../spotify/spotifyAuth";
import { SpotifyController } from "../spotify/spotifyController";
import { SpotifyPlayer } from "../spotify/spotifyPlayer";
import { SpotifySearch } from "../spotify/spotifySearch";
import { FileTokenStore } from "../spotify/tokenStore";
import {
  aiFallbackRate,
  createMetrics,
  createState,
  type AppState,
  type UsageMetrics,
} from "./state";

class NoopAiParser implements AiFallback {
  async parse(): Promise<Intent[]> {
    return [];
  }
}

export interface App {
  auth: SpotifyAuthClient;
  controller: SpotifyController;
  router: IntentRouter;
  feedback: FeedbackService;
  state: AppState;
  metrics: UsageMetrics;
  processCommand(text: string): Promise<void>;
  getAiFallbackRate(): number;
}

export interface BuildAppDeps {
  tokenStore?: TokenStore;
  authBackend?: AuthBackend;
  /** Chave da IA vinda do keyring (desktop); default usa config.ai.apiKey. */
  aiApiKey?: string;
  /** Feedback compartilhado (UI/desktop); default cria um novo. */
  feedback?: FeedbackService;
}

/** Monta o grafo de dependências a partir da configuração. */
export async function buildApp(
  config: AppConfig,
  deps: BuildAppDeps = {},
): Promise<App> {
  const state = createState();
  const metrics = createMetrics();
  const feedback = deps.feedback ?? new FeedbackService();

  const auth = new SpotifyAuthClient({
    clientId: config.spotify.clientId,
    redirectUri: config.spotify.redirectUri,
    callbackPort: config.spotify.callbackPort,
    store: deps.tokenStore ?? new FileTokenStore(),
    backend: deps.authBackend,
  });

  const api = new SpotifyApi(auth);
  const player = new SpotifyPlayer(api);
  const search = new SpotifySearch(api);
  const controller = new SpotifyController(api, player, search);

  const parser = new LocalIntentParser({
    aliases: config.aliases,
    volumeStep: config.volumeStep,
  });

  let ai: AiFallback = new NoopAiParser();
  if (config.ai.enabled) {
    try {
      const grok = new GrokClient({
        apiKey: deps.aiApiKey ?? config.ai.apiKey,
        model: config.ai.model,
        endpoint: config.ai.endpoint,
        maxTokens: config.ai.maxTokens,
        timeoutMs: config.ai.timeoutMs,
      });
      ai = new AiIntentParser(grok);
      state.grokConfigured = true;
    } catch {
      // Sem API key configurada → fallback desabilitado, app continua normal.
      state.grokConfigured = false;
    }
  }

  const router = new IntentRouter({
    parser,
    ai,
    threshold: config.intentThreshold,
  });

  state.spotifyConnected = await auth.isAuthenticated();

  /**
   * Fluxo único de processamento de texto. CLI, UI e voz terminam aqui:
   * texto → IntentRouter → SpotifyController → feedback.
   */
  async function processCommand(rawText: string): Promise<void> {
    state.lastCommand = rawText;
    state.lastError = null;
    metrics.total += 1;

    console.log(`[command] input=${JSON.stringify(rawText)}`);

    const { results, aiCalled } = await router.route(rawText);
    if (aiCalled) {
      metrics.ai += 1;
    } else if (results.length > 0) {
      metrics.local += 1;
    }

    if (results.length === 0) {
      state.lastIntent = "unknown";
      state.lastSource = null;
      feedback.say("Não consegui interpretar esse comando.");
      console.log("[command] no-intent");
      return;
    }

    for (const result of results) {
      state.lastIntent = result.intent.type;
      state.lastSource = result.source;
      console.log(
        `[command] intent=${result.intent.type} source=${result.source}`,
      );
      try {
        const action = await controller.execute(result.intent);
        state.lastResult = action.message;
        state.lastError = null;
        feedback.say(action.message);
        console.log(`[command] ok: ${action.message}`);
      } catch (error) {
        state.lastResult = null;
        state.lastError =
          error instanceof Error ? error.message : String(error);
        feedback.error(error);
        console.log(`[command] error: ${state.lastError}`);
      }
    }
  }

  return {
    auth,
    controller,
    router,
    feedback,
    state,
    metrics,
    processCommand,
    getAiFallbackRate: () => aiFallbackRate(metrics),
  };
}