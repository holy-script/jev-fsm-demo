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

/** Proposed track assignments (placeholder until packs are downloaded and audited) */
export const MUSIC: Record<string, TrackMeta> = {
  bladekeeper_duel: {
    id: "bladekeeper_duel",
    name: "Knight's Duel",
    bpm: 120,
    lengthMs: 120000,
    loopMs: 30000,
    file: "bladekeeper_duel.ogg",
    contexts: ["boss-phase1"],
  },
  mauler_siege: {
    id: "mauler_siege",
    name: "Siege",
    bpm: 110,
    lengthMs: 150000,
    loopMs: 40000,
    file: "mauler_siege.ogg",
    contexts: ["boss-phase1"],
  },
  hashashin_desert: {
    id: "hashashin_desert",
    name: "Desert Battle",
    bpm: 130,
    lengthMs: 100000,
    loopMs: 25000,
    file: "hashashin_desert.ogg",
    contexts: ["boss-phase1"],
  },
  echo_synthetic: {
    id: "echo_synthetic",
    name: "Synthetic",
    bpm: 140,
    lengthMs: 110000,
    loopMs: 27500,
    file: "echo_synthetic.ogg",
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
