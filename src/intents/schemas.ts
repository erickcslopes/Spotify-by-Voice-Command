import { z } from "zod";

export const PlayTrackSchema = z.object({
  type: z.literal("play_track"),
  query: z.string().min(1),
  artist: z.string().optional(),
});

export const PlayArtistSchema = z.object({
  type: z.literal("play_artist"),
  query: z.string().min(1),
});

export const PlayPlaylistSchema = z.object({
  type: z.literal("play_playlist"),
  query: z.string().min(1),
});

export const PauseSchema = z.object({ type: z.literal("pause") });

export const ResumeSchema = z.object({ type: z.literal("resume") });

export const NextTrackSchema = z.object({ type: z.literal("next_track") });

export const PreviousTrackSchema = z.object({
  type: z.literal("previous_track"),
});

export const SetVolumeSchema = z.object({
  type: z.literal("set_volume"),
  value: z.number().min(0).max(100),
});

export const ChangeVolumeSchema = z.object({
  type: z.literal("change_volume"),
  delta: z.number().int().min(-100).max(100),
});

export const ShuffleSchema = z.object({
  type: z.literal("shuffle"),
  enabled: z.boolean(),
});

export const RepeatSchema = z.object({
  type: z.literal("repeat"),
  mode: z.enum(["off", "track", "context"]),
});

export const CurrentlyPlayingSchema = z.object({
  type: z.literal("currently_playing"),
});

/**
 * União discriminada das intenções permitidas. Qualquer coisa fora disso
 * (ex.: "delete_playlist") é rejeitada pelo Zod.
 */
export const AllowedIntentSchema = z.discriminatedUnion("type", [
  PlayTrackSchema,
  PlayArtistSchema,
  PlayPlaylistSchema,
  PauseSchema,
  ResumeSchema,
  NextTrackSchema,
  PreviousTrackSchema,
  SetVolumeSchema,
  ChangeVolumeSchema,
  ShuffleSchema,
  RepeatSchema,
  CurrentlyPlayingSchema,
]);

export const AiResponseSchema = z.object({
  actions: z.array(AllowedIntentSchema).min(1).max(4),
});