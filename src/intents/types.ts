export type Intent =
  | { type: "play_track"; query: string; artist?: string }
  | { type: "play_artist"; query: string }
  | { type: "play_playlist"; query: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "next_track" }
  | { type: "previous_track" }
  | { type: "set_volume"; value: number }
  | { type: "change_volume"; delta: number }
  | { type: "shuffle"; enabled: boolean }
  | { type: "repeat"; mode: "off" | "track" | "context" }
  | { type: "currently_playing" }
  | { type: "unknown"; text: string };

export const INTENT_TYPES = [
  "play_track",
  "play_artist",
  "play_playlist",
  "pause",
  "resume",
  "next_track",
  "previous_track",
  "set_volume",
  "change_volume",
  "shuffle",
  "repeat",
  "currently_playing",
  "unknown",
] as const;

export interface IntentResult {
  intent: Intent;
  confidence: number;
  source: "local" | "ai";
}

export function isIntentType(value: string): value is Intent["type"] {
  return (INTENT_TYPES as readonly string[]).includes(value);
}

export function unknownIntent(text: string, source: "local" | "ai" = "local"): IntentResult {
  return { intent: { type: "unknown", text }, confidence: 0, source };
}