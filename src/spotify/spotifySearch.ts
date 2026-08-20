import { SpotifySearchNoResultError } from "../errors";
import type { SpotifyApi } from "./spotifyApi";
import type { ArtistSummary, PlaylistSummary, TrackSummary } from "./types";

interface RawTrack {
  uri: string;
  name: string;
  artists?: { name: string }[];
  album?: { name: string };
}

interface RawPlaylist {
  uri: string;
  name: string;
  id: string;
}

interface RawArtist {
  uri: string;
  name: string;
}

interface SearchResponse<T> {
  [key: string]: { items: T[] } | undefined;
}

/** Buscas no Spotify. Não interpreta linguagem. */
export class SpotifySearch {
  constructor(private readonly api: SpotifyApi) {}

  async findTrack(query: string, artist?: string): Promise<TrackSummary> {
    const q = artist
      ? `track:"${query}" artist:"${artist}"`
      : `track:"${query}"`;

    const data = await this.api.request<SearchResponse<RawTrack>>(
      "GET",
      `/search?type=track&limit=5&q=${encodeURIComponent(q)}`,
    );

    const item = data.tracks?.items.find((t) => t && t.uri);
    if (!item) {
      throw new SpotifySearchNoResultError(`Não encontrei a música "${query}".`);
    }

    return {
      uri: item.uri,
      name: item.name,
      artist: item.artists?.[0]?.name ?? "Desconhecido",
      album: item.album?.name ?? "Desconhecido",
    };
  }

  async findPlaylist(query: string): Promise<PlaylistSummary> {
    const normalized = query.toLowerCase().trim();

    const mine = await this.api.request<{ items: RawPlaylist[] }>(
      "GET",
      "/me/playlists?limit=50",
    );

    const mineMatch = mine.items.find((p) =>
      p.name.toLowerCase().includes(normalized),
    );
    if (mineMatch) {
      return { uri: mineMatch.uri, name: mineMatch.name, id: mineMatch.id };
    }

    const data = await this.api.request<SearchResponse<RawPlaylist>>(
      "GET",
      `/search?type=playlist&limit=5&q=${encodeURIComponent(query)}`,
    );

    const item = data.playlists?.items.find((p) => p && p.uri);
    if (!item) {
      throw new SpotifySearchNoResultError(`Não encontrei a playlist "${query}".`);
    }

    return { uri: item.uri, name: item.name, id: item.id };
  }

  async findArtist(query: string): Promise<ArtistSummary> {
    const data = await this.api.request<SearchResponse<RawArtist>>(
      "GET",
      `/search?type=artist&limit=5&q=${encodeURIComponent(query)}`,
    );

    const item = data.artists?.items.find((a) => a && a.uri);
    if (!item) {
      throw new SpotifySearchNoResultError(`Não encontrei o artista "${query}".`);
    }

    return { uri: item.uri, name: item.name };
  }
}