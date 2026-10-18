/** Audio system for music playback and beat-sync queries. Manages tracks, looping, and beat timing. */

import { MUSIC, type TrackMeta, getBeatMs, msUntilNextBeat } from "./music";

export class AudioManager {
  private tracks: Map<string, HTMLAudioElement> = new Map();
  private currentTrackId: string | null = null;
  private startTimeMs: number = 0;
  private pausedAtMs: number = 0;
  private isPlaying: boolean = false;

  constructor(private basePath: string = "/game-assets/music/") {}

  /** Load a track into memory (but don't play yet) */
  loadTrack(trackId: string): Promise<void> {
    if (this.tracks.has(trackId)) return Promise.resolve();
    const meta = MUSIC[trackId];
    if (!meta) throw new Error(`Unknown track: ${trackId}`);

    const audio = new Audio();
    audio.src = this.basePath + meta.file;
    audio.preload = "auto";
    this.tracks.set(trackId, audio);

    return new Promise((resolve, reject) => {
      audio.addEventListener("canplaythrough", () => resolve(), { once: true });
      audio.addEventListener("error", reject, { once: true });
    });
  }

  /** Play a track from the beginning, looping at loopMs */
  async play(trackId: string, fadeInMs: number = 0): Promise<void> {
    await this.loadTrack(trackId);
    const audio = this.tracks.get(trackId)!;
    const meta = MUSIC[trackId];

    this.stop();
    this.currentTrackId = trackId;
    this.startTimeMs = Date.now();
    this.pausedAtMs = 0;
    this.isPlaying = true;

    audio.currentTime = 0;
    audio.volume = fadeInMs > 0 ? 0 : 1;

    if (fadeInMs > 0) {
      const startVol = 0;
      const endVol = 1;
      const startTime = Date.now();
      const fadeFrame = () => {
        const elapsed = Date.now() - startTime;
        const frac = Math.min(1, elapsed / fadeInMs);
        audio.volume = startVol + (endVol - startVol) * frac;
        if (frac < 1) requestAnimationFrame(fadeFrame);
      };
      fadeFrame();
    }

    audio.play().catch((e) => console.error("Audio play failed:", e));

    // Handle looping manually if needed
    audio.addEventListener("timeupdate", this.onTimeUpdate);
  }

  /** Stop current track and optionally fade out */
  stop(fadeOutMs: number = 0): void {
    if (!this.currentTrackId) return;
    const audio = this.tracks.get(this.currentTrackId)!;

    if (fadeOutMs > 0) {
      const startVol = audio.volume;
      const startTime = Date.now();
      const fadeFrame = () => {
        const elapsed = Date.now() - startTime;
        const frac = Math.min(1, elapsed / fadeOutMs);
        audio.volume = startVol * (1 - frac);
        if (frac < 1) requestAnimationFrame(fadeFrame);
        else {
          audio.pause();
          this.isPlaying = false;
          this.currentTrackId = null;
        }
      };
      fadeFrame();
    } else {
      audio.pause();
      this.isPlaying = false;
      this.currentTrackId = null;
    }
  }

  /** Pause current track */
  pause(): void {
    if (!this.currentTrackId) return;
    const audio = this.tracks.get(this.currentTrackId)!;
    this.pausedAtMs = audio.currentTime * 1000;
    audio.pause();
    this.isPlaying = false;
  }

  /** Resume paused track */
  resume(): void {
    if (!this.currentTrackId) return;
    const audio = this.tracks.get(this.currentTrackId)!;
    audio.play().catch((e) => console.error("Audio resume failed:", e));
    this.startTimeMs = Date.now() - this.pausedAtMs;
    this.pausedAtMs = 0;
    this.isPlaying = true;
  }

  /** Get elapsed time in current track (ms). Returns 0 if no track playing. */
  getElapsedMs(): number {
    if (!this.isPlaying || !this.currentTrackId) return 0;
    return Date.now() - this.startTimeMs + this.pausedAtMs;
  }

  /** Get current beat position (0-1) in current track */
  getBeatPhase(): number {
    if (!this.currentTrackId) return 0;
    const beatMs = getBeatMs(this.currentTrackId);
    const elapsed = this.getElapsedMs();
    const beatNumber = elapsed / beatMs;
    return beatNumber - Math.floor(beatNumber);
  }

  /** Get ms until next beat in current track */
  getMsUntilNextBeat(): number {
    if (!this.currentTrackId) return 0;
    return msUntilNextBeat(this.currentTrackId, this.getElapsedMs());
  }

  /** Check if we're in a beat-sync window (ms tolerance on either side of beat) */
  isNearBeat(toleranceMs: number = 50): boolean {
    if (!this.currentTrackId) return false;
    const beatMs = getBeatMs(this.currentTrackId);
    const phase = this.getBeatPhase();
    const distToNextBeat = (1 - phase) * beatMs;
    const distFromPrevBeat = phase * beatMs;
    return distToNextBeat < toleranceMs || distFromPrevBeat < toleranceMs;
  }

  /** Get current track ID */
  getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  /** Check if audio is currently playing */
  isAudioPlaying(): boolean {
    return this.isPlaying && this.currentTrackId !== null;
  }

  private onTimeUpdate = () => {
    if (!this.currentTrackId) return;
    const audio = this.tracks.get(this.currentTrackId)!;
    const meta = MUSIC[this.currentTrackId];
    if (audio.currentTime * 1000 >= meta.loopMs) {
      audio.currentTime = 0;
      this.startTimeMs = Date.now();
    }
  };
}
