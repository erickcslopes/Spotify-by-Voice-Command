export interface AppState {
  spotifyConnected: boolean;
  grokConfigured: boolean;
  voiceReady: boolean;
  lastCommand: string | null;
  lastIntent: string | null;
  lastResult: string | null;
}

export interface UsageMetrics {
  total: number;
  local: number;
  ai: number;
}

export function createState(): AppState {
  return {
    spotifyConnected: false,
    grokConfigured: false,
    voiceReady: false,
    lastCommand: null,
    lastIntent: null,
    lastResult: null,
  };
}

export function createMetrics(): UsageMetrics {
  return { total: 0, local: 0, ai: 0 };
}

export function aiFallbackRate(metrics: UsageMetrics): number {
  if (metrics.total === 0) return 0;
  return Math.round((metrics.ai / metrics.total) * 100);
}