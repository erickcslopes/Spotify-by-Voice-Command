import type { Intent } from "../intents/types";
import type { SpotifyApi } from "./spotifyApi";
import type { SpotifyPlayer } from "./spotifyPlayer";
import type { SpotifySearch } from "./spotifySearch";
import type { ActionResult } from "./types";

export class SpotifyController {
  constructor(
    private readonly api: SpotifyApi,
    private readonly player: SpotifyPlayer,
    private readonly search: SpotifySearch,
  ) {}

  async execute(intent: Intent): Promise<ActionResult> {
    switch (intent.type) {
      case "play_track": {
        const track = await this.search.findTrack(intent.query, intent.artist);
        await this.player.playUri(track.uri);
        return {
          ok: true,
          message: `Tocando ${track.name} — ${track.artist}`,
          data: track,
        };
      }

      case "play_artist": {
        const artist = await this.search.findArtist(intent.query);
        await this.player.playContext(artist.uri);
        return {
          ok: true,
          message: `Tocando artista ${artist.name}`,
          data: artist,
        };
      }

      case "play_playlist": {
        const playlist = await this.search.findPlaylist(intent.query);
        await this.player.playContext(playlist.uri);
        return {
          ok: true,
          message: `Playlist "${playlist.name}" iniciada`,
          data: playlist,
        };
      }

      case "pause":
        await this.player.pause();
        return { ok: true, message: "Pausado" };

      case "resume":
        await this.player.resume();
        return { ok: true, message: "Reprodução continuada" };

      case "next_track":
        await this.player.next();
        return { ok: true, message: "Próxima música" };

      case "previous_track":
        await this.player.previous();
        return { ok: true, message: "Música anterior" };

      case "set_volume":
        await this.player.setVolume(intent.value);
        return { ok: true, message: `Volume: ${intent.value}%` };

      case "change_volume": {
        const playback = await this.player.getCurrentPlayback();
        const base = playback.volume ?? 50;
        await this.player.setVolume(base + intent.delta);
        const final = Math.min(100, Math.max(0, base + intent.delta));
        return { ok: true, message: `Volume: ${final}%` };
      }

      case "shuffle":
        await this.player.setShuffle(intent.enabled);
        return {
          ok: true,
          message: intent.enabled ? "Aleatório ativado" : "Aleatório desativado",
        };

      case "repeat":
        await this.player.setRepeat(intent.mode);
        return {
          ok: true,
          message: `Repetição ${intent.mode === "off" ? "desativada" : intent.mode === "track" ? "da música" : "da playlist"} ativada`,
        };

      case "currently_playing": {
        const playback = await this.player.getCurrentPlayback();
        if (!playback.track) {
          return { ok: false, message: "Nada tocando no momento" };
        }
        return {
          ok: true,
          message: `${playback.track.name} — ${playback.track.artist}`,
          data: playback.track,
        };
      }

      case "unknown":
        return { ok: false, message: "Não consegui interpretar esse comando." };
    }
  }
}