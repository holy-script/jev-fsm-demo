/** Music metadata and audio management for beat-sync choreography.
 *  Tracks: BPM, length, loop type, and which boss/context they fit. */

export interface TrackMeta {
  id: string;
  name: string;
  bpm: number;
  lengthMs: number;
  loopMs: number; // point in ms where loop restarts
  file: string;
  contexts: ("exploration" | "boss-phase1" | "boss-phase2" | "boss" | "victory")[];
}

/** Boss fight tracks from alkakrab's Pixel RPG Music Pack (free, CC attribution not required) */
export const MUSIC: Record<string, TrackMeta> = {
  bladekeeper_duel: {
    id: "bladekeeper_duel",
    name: "Pixel 3 (Bladekeeper Duel)",
    bpm: 125,
    lengthMs: 90000,
    loopMs: 45000,
    file: "boss-bladekeeper.wav",
    contexts: ["boss-phase1"],
  },
  mauler_siege: {
    id: "mauler_siege",
    name: "Pixel 8 (Mauler Siege)",
    bpm: 110,
    lengthMs: 84000,
    loopMs: 42000,
    file: "boss-mauler.wav",
    contexts: ["boss-phase1"],
  },
  hashashin_desert: {
    id: "hashashin_desert",
    name: "Pixel 5 (Hashashin Rush)",
    bpm: 135,
    lengthMs: 99000,
    loopMs: 49500,
    file: "boss-hashashin.wav",
    contexts: ["boss-phase1"],
  },
  echo_synthetic: {
    id: "echo_synthetic",
    name: "Pixel 12 (Echo Evolution)",
    bpm: 128,
    lengthMs: 96000,
    loopMs: 48000,
    file: "boss-echo.wav",
    contexts: ["boss-phase1"],
  },
};

/** Get BPM for a track */
export function getBpm(trackId: string): number {
  return MUSIC[trackId]?.bpm ?? 120;
}

/** Get beat duration in ms for a track (60000 / bpm) */
export function getBeatMs(trackId: string): number {
  const bpm = getBpm(trackId);
  return 60000 / bpm;
}

/** Get current beat position (0-1, where 1 is a full beat) given elapsed time and track */
export function getBeatPhase(trackId: string, elapsedMs: number): number {
  const beatMs = getBeatMs(trackId);
  const beatNumber = elapsedMs / beatMs;
  return beatNumber - Math.floor(beatNumber); // fractional part (0-1)
}

/** Check if we're close to a beat boundary (within a window) */
export function nearBeat(trackId: string, elapsedMs: number, windowMs: number): boolean {
  const beatMs = getBeatMs(trackId);
  const phase = getBeatPhase(trackId, elapsedMs);
  const distToNextBeat = (1 - phase) * beatMs;
  const distFromPrevBeat = phase * beatMs;
  return distToNextBeat < windowMs || distFromPrevBeat < windowMs;
}

/** Time until next beat boundary in ms */
export function msUntilNextBeat(trackId: string, elapsedMs: number): number {
  const beatMs = getBeatMs(trackId);
  const phase = getBeatPhase(trackId, elapsedMs);
  return (1 - phase) * beatMs;
}
