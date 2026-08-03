export type MusicPhase =
  | "waiting_for_dj"
  | "ready"
  | "loading"
  | "playing"
  | "answering"
  | "paused"
  | "reveal"
  | "finished"
  | "error";

export interface SecretTrack {
  title: string;
  artist: string;
  recordingMbid?: string;
  youtubeVideoId?: string | null;
}

export interface PreparedMusicTrack extends SecretTrack {
  preparedVideoId?: string;
  preparedDurationSeconds?: number;
}

export interface MusicAnswerResult {
  songCorrect: boolean;
  artistCorrect: boolean;
  submitted: boolean;
}

export interface MusicPublicState {
  djConnected: boolean;
  phase: MusicPhase;
  roundNumber: number;
  totalRounds: number;
  clipDuration: number;
  answerDuration: number;
  startSeconds?: number;
  endSeconds?: number;
  videoId?: string;
  deadlineAt?: string;
  revealedTrack?: SecretTrack;
  answerResults?: Record<string, MusicAnswerResult>;
  scores?: Record<string, number>;
  error?: string;
  pausedPhase?: "playing" | "answering";
  pausedRemainingMs?: number;
}

export interface MusicRoomState {
  publicState: MusicPublicState;
  djTokenHash?: string;
  secretTrack?: SecretTrack;
  queuedTracks?: PreparedMusicTrack[];
  preparedConfigKey?: string;
  answerDrafts?: Record<string, { roundNumber: number; song: string; artist: string }>;
  usedTracks: string[];
}
