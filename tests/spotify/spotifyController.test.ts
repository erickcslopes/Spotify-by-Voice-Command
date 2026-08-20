import { describe, expect, it, vi } from "vitest";
import { SpotifySearchNoResultError } from "../../src/errors";
import { SpotifyController } from "../../src/spotify/spotifyController";
import type { SpotifyApi } from "../../src/spotify/spotifyApi";
import type { SpotifyPlayer } from "../../src/spotify/spotifyPlayer";
import type { SpotifySearch } from "../../src/spotify/spotifySearch";
import type { PlaybackState } from "../../src/spotify/types";

function makeController(overrides: {
  player?: Partial<Record<keyof SpotifyPlayer, ReturnType<typeof vi.fn>>>;
  search?: Partial<Record<keyof SpotifySearch, ReturnType<typeof vi.fn>>>;
} = {}) {
  const api = {} as SpotifyApi;
  const player = {
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    previous: vi.fn(async () => {}),
    setVolume: vi.fn(async () => {}),
    setShuffle: vi.fn(async () => {}),
    setRepeat: vi.fn(async () => {}),
    playUri: vi.fn(async () => {}),
    playContext: vi.fn(async () => {}),
    getCurrentPlayback: vi.fn<() => Promise<PlaybackState>>(async () => ({
      isPlaying: false,
      track: null,
      volume: 50,
      shuffle: false,
      repeatState: "off",
    })),
    ...overrides.player,
  } as unknown as SpotifyPlayer;

  const search = {
    findTrack: vi.fn(async () => ({
      uri: "spotify:track:1",
      name: "Black Betty",
      artist: "Ram Jam",
      album: "Ram Jam",
    })),
    findPlaylist: vi.fn(async () => ({
      uri: "spotify:playlist:1",
      name: "Rock",
      id: "1",
    })),
    findArtist: vi.fn(async () => ({ uri: "spotify:artist:1", name: "Ram Jam" })),
    ...overrides.search,
  } as unknown as SpotifySearch;

  return { controller: new SpotifyController(api, player, search), player, search };
}

describe("SpotifyController", () => {
  it("toca uma música pesquisada", async () => {
    const { controller, player } = makeController();
    const result = await controller.execute({
      type: "play_track",
      query: "Black Betty",
    });
    expect(player.playUri).toHaveBeenCalledWith("spotify:track:1");
    expect(result.message).toContain("Black Betty");
  });

  it("propaga erro quando a música não é encontrada", async () => {
    const { controller } = makeController({
      search: {
        findTrack: vi.fn(async () => {
          throw new SpotifySearchNoResultError("Não encontrei a música \"x\".");
        }),
      },
    });
    await expect(
      controller.execute({ type: "play_track", query: "x" }),
    ).rejects.toBeInstanceOf(SpotifySearchNoResultError);
  });

  it("pausa", async () => {
    const { controller, player } = makeController();
    const result = await controller.execute({ type: "pause" });
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(result.message).toBe("Pausado");
  });

  it("ajusta volume absoluto", async () => {
    const { controller, player } = makeController();
    await controller.execute({ type: "set_volume", value: 30 });
    expect(player.setVolume).toHaveBeenCalledWith(30);
  });

  it("ajusta volume relativo a partir do volume atual", async () => {
    const { controller, player } = makeController();
    await controller.execute({ type: "change_volume", delta: 10 });
    expect(player.setVolume).toHaveBeenCalledWith(60);
  });

  it("informa a música atual", async () => {
    const getCurrentPlayback = vi.fn<() => Promise<PlaybackState>>();
    getCurrentPlayback.mockResolvedValueOnce({
      isPlaying: true,
      track: { uri: "u", name: "Black Betty", artist: "Ram Jam", album: "Ram Jam" },
      volume: 50,
      shuffle: false,
      repeatState: "off",
    });
    const { controller } = makeController({ player: { getCurrentPlayback } });
    const result = await controller.execute({ type: "currently_playing" });
    expect(result.message).toBe("Black Betty — Ram Jam");
  });
});