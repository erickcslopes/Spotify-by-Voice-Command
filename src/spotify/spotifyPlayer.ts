import type { SpotifyApi } from "./spotifyApi";
import type { PlaybackState, TrackSummary } from "./types";

interface RawTrack {
  uri: string;
  name: string;
  artists?: { name: string }[];
  album?: { name: string };
}

interface RawPlayback {
  is_playing?: boolean;
  device?: { volume_percent?: number };
  shuffle_state?: boolean;
  repeat_state?: "off" | "track" | "context";
  item?: RawTrack | null;
}

function toTrackSummary(item: RawTrack): TrackSummary {
  return {
    uri: item.uri,
    name: item.name,
    artist: item.artists?.[0]?.name ?? "Desconhecido",
    album: item.album?.name ?? "Desconhecido",
  };
}

/** Endpoints de player do Spotify. Não interpreta linguagem. */
export class SpotifyPlayer {
  constructor(private readonly api: SpotifyApi) {}

  async getCurrentPlayback(): Promise<PlaybackState> {
    const raw = await this.api.request<RawPlayback>("GET", "/me/player");
    return {
      isPlaying: raw.is_playing ?? false,
      track: raw.item ? toTrackSummary(raw.item) : null,
      volume: raw.device?.volume_percent ?? null,
      shuffle: raw.shuffle_state ?? null,
      repeatState: raw.repeat_state ?? null,
    };
  }

  async pause(): Promise<void> {
    await this.api.request<void>("PUT", "/me/player/pause");
  }

  async resume(): Promise<void> {
    await this.api.request<void>("PUT", "/me/player/play");
  }

  async next(): Promise<void> {
    await this.api.request<void>("POST", "/me/player/next");
  }

  async previous(): Promise<void> {
    await this.api.request<void>("POST", "/me/player/previous");
  }

  async setVolume(percent: number): Promise<void> {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    await this.api.request<void>("PUT", `/me/player/volume?volume_percent=${value}`);
  }

  async setShuffle(enabled: boolean): Promise<void> {
    await this.api.request<void>("PUT", `/me/player/shuffle?state=${enabled}`);
  }

  async setRepeat(mode: "off" | "track" | "context"): Promise<void> {
    await this.api.request<void>("PUT", `/me/player/repeat?state=${mode}`);
  }

  async playUri(uri: string): Promise<void> {
    await this.api.request<void>("PUT", "/me/player/play", { uris: [uri] });
  }

  async playContext(uri: string): Promise<void> {
    await this.api.request<void>("PUT", "/me/player/play", { context_uri: uri });
  }
}