import type { MusicGameConfig, MusicPlaybackMode } from "./music.types";

export interface SecretTrack {
  id: string;
  title: string;
  artist: string;
  year: number;
}

export interface PlayableTrack {
  trackId: string;
  durationSeconds: number;
  playbackUrl?: string;
}

export interface MusicProvider {
  readonly mode: MusicPlaybackMode;
  prepare(config: MusicGameConfig): Promise<void>;
  selectTrack(config: MusicGameConfig, excludedIds: string[]): Promise<SecretTrack>;
  getPlayableTrack(track: SecretTrack, durationSeconds: number): Promise<PlayableTrack>;
  stop(): Promise<void>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} todavía no está configurado para este proyecto.`);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Contrato de integración. El proveedor demo/manual puede implementarse sin
 * credenciales; Reactional se conectará aquí cuando habilite el proyecto.
 * Ningún proveedor puede exponer la respuesta secreta al cliente jugador.
 */
export function assertProviderAvailable(mode: MusicPlaybackMode) {
  if (mode === "reactional") throw new ProviderNotConfiguredError("Reactional");
}
