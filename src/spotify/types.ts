export interface TrackSummary {
  uri: string;
  name: string;
  artist: string;
  album: string;
}

export interface ArtistSummary {
  uri: string;
  name: string;
}

export interface PlaylistSummary {
  uri: string;
  name: string;
  id: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  track: TrackSummary | null;
  volume: number | null;
  shuffle: boolean | null;
  repeatState: "off" | "track" | "context" | null;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: unknown;
}