import type { Intent } from "./types";

export const CONFIDENCE = {
  EXACT_ALIAS: 1.0,
  SPECIFIC_REGEX: 0.95,
  GENERIC_REGEX: 0.8,
  HEURISTIC: 0.65,
  NONE: 0,
} as const;

export type AliasGroup =
  | "pause"
  | "resume"
  | "next_track"
  | "previous_track"
  | "currently_playing"
  | "shuffle_on"
  | "shuffle_off"
  | "repeat_track"
  | "repeat_context"
  | "repeat_off";

export type AliasMap = Record<AliasGroup, string[]>;

export const PLAY_PREFIXES =
  /^(?:toca|toque|tocar|coloca|colocar|reproduz|reproduzir|liga|poe|põe)\s+(.+)$/;

export const PLAYLIST_PREFIXES =
  /^(?:toca|toque|tocar|coloca|colocar|reproduz|reproduzir|liga)\s+(?:(?:minha|a|a minha|na minha|de|em)\s+)?playlist\s+(.+)$/;

export const PLAYLIST_BARE = /^playlist\s+(.+)$/;

export const ARTIST_PREFIXES =
  /^(?:toca|toque|tocar|coloca|colocar|reproduz|reproduzir|liga)\s+(?:artista|o artista)\s+(.+)$/;

export const VOLUME_ABSOLUTE =
  /\bvolume\b[^\d]{0,24}(\d{1,3})\s*(?:por\s*cento)?/;

export const VOLUME_UP =
  /(?:\b(?:aumenta|aumentar|sobe|levanta|sala)\b[^\d]{0,24}\bvolume\b)|\bmais\s+alto\b/;

export const VOLUME_DOWN =
  /(?:\b(?:diminui|diminuir|abaixa|abaixar|baixa|reduz|reduzir)\b[^\d]{0,24}\bvolume\b)|\bmais\s+baixo\b/;

/** Separadores usados para "música do artista" — split pela última ocorrência. */
export const ARTIST_SEPARATOR = /(?:\s+(?:do|da|dos|das|de)\s+)/i;

/**
 * Marcadores de fala vaga/semântica. Quando presentes em um pedido de
 * reprodução, reduzem a confiança e forçam o fallback para o Grok.
 */
export const VAGUE_MARKERS = [
  "alguma coisa",
  "algo",
  "algum",
  "alguma",
  "algumas",
  "parecida",
  "parecido",
  "tranquila",
  "tranquilo",
  "animada",
  "animado",
  "aquela",
  "aquele",
  "aquilo",
  "que eu gosto",
  "gosto",
  "dessa",
  "desse",
  "assim",
  "tipo",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isVagueQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  for (const marker of VAGUE_MARKERS) {
    if (marker.includes(" ")) {
      if (q.includes(marker)) return true;
    } else if (new RegExp(`\\b${escapeRegExp(marker)}\\b`).test(q)) {
      return true;
    }
  }
  return false;
}

/** Detecta comandos compostos (ex.: tocar + volume) que exigem IA. */
export function isCompoundCommand(asciiText: string): boolean {
  return /\bvolume\b|\be\b/.test(asciiText);
}

export function aliasToIntent(group: AliasGroup): Intent {
  switch (group) {
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "next_track":
      return { type: "next_track" };
    case "previous_track":
      return { type: "previous_track" };
    case "currently_playing":
      return { type: "currently_playing" };
    case "shuffle_on":
      return { type: "shuffle", enabled: true };
    case "shuffle_off":
      return { type: "shuffle", enabled: false };
    case "repeat_track":
      return { type: "repeat", mode: "track" };
    case "repeat_context":
      return { type: "repeat", mode: "context" };
    case "repeat_off":
      return { type: "repeat", mode: "off" };
  }
}

/** Procura correspondência exata entre o texto normalizado e a tabela de aliases. */
export function matchExactAlias(
  asciiText: string,
  aliases: AliasMap,
): { intent: Intent; confidence: number } | null {
  const groups = Object.keys(aliases) as AliasGroup[];
  for (const group of groups) {
    const list = aliases[group];
    if (!list) continue;
    for (const alias of list) {
      if (asciiText === alias) {
        return { intent: aliasToIntent(group), confidence: CONFIDENCE.EXACT_ALIAS };
      }
    }
  }
  return null;
}