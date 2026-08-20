import { normalizeInput, removeAccents } from "./normalizer";
import {
  ARTIST_PREFIXES,
  ARTIST_SEPARATOR,
  CONFIDENCE,
  isCompoundCommand,
  isVagueQuery,
  matchExactAlias,
  PLAYLIST_BARE,
  PLAYLIST_PREFIXES,
  PLAY_PREFIXES,
  VOLUME_ABSOLUTE,
  VOLUME_DOWN,
  VOLUME_UP,
  type AliasMap,
} from "./patterns";
import { unknownIntent, type Intent, type IntentResult } from "./types";

/** Correspondência local sem metadados de origem (preenchidos no parse()). */
export interface LocalMatch {
  intent: Intent;
  confidence: number;
}

/** Normaliza uma frase de alias para comparação acento-insensível. */
export function normalizeAliasPhrase(phrase: string): string {
  return removeAccents(phrase.toLowerCase())
    .replace(/[.,;:!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LocalParserOptions {
  aliases: AliasMap;
  volumeStep: number;
}

function splitArtist(rawQuery: string): { query: string; artist: string } | null {
  const parts = rawQuery.split(ARTIST_SEPARATOR);
  if (parts.length < 2) return null;
  const query = parts.slice(0, -1).join(" ").trim();
  const artist = parts[parts.length - 1]!.trim();
  if (!query || !artist) return null;
  return { query, artist };
}

const VOLUME_FILLERS =
  /\b(?:o|a|os|as|em|para|na|no|minha|meu|minhas|meus|de|do|da|dos|das|e)\b/g;

/**
 * True quando há conteúdo significativo antes da palavra "volume".
 * Distingue "coloca o volume em 20" (só volume) de
 * "coloca minha playlist de rock e volume em 30" (composto).
 */
function hasContentBeforeVolume(ascii: string): boolean {
  const idx = ascii.search(/\bvolume\b/);
  if (idx === -1) return false;
  const before = ascii
    .slice(0, idx)
    .replace(/^(?:coloca|colocar|toca|toque|tocar|reproduz|reproduzir|liga|poe|põe)\s+/, "")
    .replace(VOLUME_FILLERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return before.length > 0;
}

export class LocalIntentParser {
  private readonly aliases: AliasMap;
  private readonly volumeStep: number;

  constructor(options: LocalParserOptions) {
    this.volumeStep = options.volumeStep;
    const aliases: AliasMap = {} as AliasMap;
    for (const [key, phrases] of Object.entries(options.aliases)) {
      aliases[key as keyof AliasMap] = phrases.map(normalizeAliasPhrase);
    }
    this.aliases = aliases;
  }

  parse(input: string): IntentResult {
    const { raw, ascii } = normalizeInput(input);

    if (!ascii) return unknownIntent(raw);

    const exact = matchExactAlias(ascii, this.aliases);
    if (exact) return { ...exact, source: "local" };

    const compound = this.parseCompoundGate(ascii, raw);
    if (compound) return { ...compound, source: "local" };

    const volume = this.parseVolume(ascii);
    if (volume) return { ...volume, source: "local" };

    const playlist = this.parsePlaylist(raw, ascii);
    if (playlist) return { ...playlist, source: "local" };

    const artist = this.parseArtist(raw, ascii);
    if (artist) return { ...artist, source: "local" };

    const track = this.parseTrack(raw, ascii);
    if (track) return { ...track, source: "local" };

    return unknownIntent(raw);
  }

  /**
   * Comandos compostos (ex.: tocar playlist + volume) não podem ser resolvidos
   * localmente com segurança — forçam confiança baixa para ir ao Grok.
   */
  private parseCompoundGate(ascii: string, raw: string): LocalMatch | null {
    if (VOLUME_ABSOLUTE.test(ascii) && hasContentBeforeVolume(ascii)) {
      return { intent: { type: "unknown", text: raw }, confidence: 0.4 };
    }
    return null;
  }

  private parseVolume(ascii: string): LocalMatch | null {
    const m = VOLUME_ABSOLUTE.exec(ascii);
    if (m && m[1] !== undefined) {
      let value = Number.parseInt(m[1], 10);
      if (!Number.isFinite(value)) return null;
      value = Math.min(100, Math.max(0, value));
      return {
        intent: { type: "set_volume", value },
        confidence: CONFIDENCE.SPECIFIC_REGEX,
      };
    }

    if (VOLUME_UP.test(ascii)) {
      return {
        intent: { type: "change_volume", delta: this.volumeStep },
        confidence: CONFIDENCE.SPECIFIC_REGEX,
      };
    }

    if (VOLUME_DOWN.test(ascii)) {
      return {
        intent: { type: "change_volume", delta: -this.volumeStep },
        confidence: CONFIDENCE.SPECIFIC_REGEX,
      };
    }

    return null;
  }

  private parsePlaylist(raw: string, ascii: string): LocalMatch | null {
    if (!/playlist/.test(ascii)) return null;

    const prefixed = PLAYLIST_PREFIXES.exec(ascii);
    if (prefixed && prefixed[1]) {
      const rawQuery = this.extractRawQuery(raw, "playlist");
      if (rawQuery) {
        return {
          intent: { type: "play_playlist", query: rawQuery },
          confidence: this.playConfidence(rawQuery, ascii),
        };
      }
      return {
        intent: { type: "play_playlist", query: prefixed[1].trim() },
        confidence: this.playConfidence(prefixed[1], ascii),
      };
    }

    const bare = PLAYLIST_BARE.exec(ascii);
    if (bare && bare[1]) {
      const rawQuery = this.extractRawQuery(raw, "playlist");
      if (rawQuery) {
        return {
          intent: { type: "play_playlist", query: rawQuery },
          confidence: this.playConfidence(rawQuery, ascii),
        };
      }
    }

    return null;
  }

  /** Confiança de comandos de reprodução; frases vagas/compostas vão para a IA. */
  private playConfidence(query: string, ascii: string): number {
    if (isVagueQuery(query) || isCompoundCommand(ascii)) {
      return 0.5;
    }
    return CONFIDENCE.SPECIFIC_REGEX;
  }

  private parseArtist(raw: string, ascii: string): LocalMatch | null {
    const m = ARTIST_PREFIXES.exec(ascii);
    if (!m || !m[1]) return null;
    const query = this.extractRawQuery(raw, "artista") ?? m[1].trim();
    return {
      intent: { type: "play_artist", query },
      confidence: CONFIDENCE.SPECIFIC_REGEX,
    };
  }

  private parseTrack(raw: string, ascii: string): LocalMatch | null {
    const m = PLAY_PREFIXES.exec(ascii);
    if (!m || !m[1]) return null;

    const rawQuery = this.extractRawQuery(raw, null) ?? m[1].trim();

    const split = splitArtist(rawQuery);
    if (split) {
      return {
        intent: { type: "play_track", query: split.query, artist: split.artist },
        confidence: this.playConfidence(split.query, ascii),
      };
    }

    return {
      intent: { type: "play_track", query: rawQuery },
      confidence: this.playConfidence(rawQuery, ascii),
    };
  }

  /**
   * Extrai o termo de busca do texto original (com acentos/maíusculas),
   * removendo o prefixo de comando detectado. `anchor` é uma palavra-chave
   * opcional que marca o início da busca quando presente (ex.: "playlist").
   */
  private extractRawQuery(raw: string, anchor: string | null): string | null {
    let start = 0;
    const lower = raw.trim().toLowerCase();

    if (anchor) {
      const idx = lower.indexOf(anchor);
      if (idx === -1) return null;
      start = idx + anchor.length;
    } else {
      const prefixMatch = PLAY_PREFIXES.exec(lower.replace(/[.,;:!?]/g, " ").replace(/\s+/g, " "));
      if (!prefixMatch || !prefixMatch[1]) return null;
      start = prefixMatch[0].length - prefixMatch[1].length;
    }

    const query = raw.trim().slice(start).trim();
    return query || null;
  }
}