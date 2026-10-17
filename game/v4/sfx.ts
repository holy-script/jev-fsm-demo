import * as Phaser from "phaser";
import type { ArenaManifest } from "./manifest";

/**
 * Sound for ARENA (ported from v3's sfx.ts). Recorded sword clashes/swings (OpenGameArt, CC0) are mixed with a synthesised library
 * (thuds, whooshes, breaks, heals, and one distinct warning cue per unblockable move), all through one compressed bus.
 */
export class Sfx {
  private music?: Phaser.Sound.BaseSound;
  musicOn = true;
  private bus?: GainNode;
  private noiseBuf?: AudioBuffer;
  private curTrim = 0; // dB, applied to every voice scheduled inside the current cue

  constructor(private scene: Phaser.Scene, private manifest: ArenaManifest, private cfg: () => { sfx: number; music: boolean }) {
    // Loudness balance, in dB, measured offline (tests/duel/audio.mjs): aims for a consistent level, with the deflect and the
    // warnings standing out and swings/rolls sitting underneath.
    const TRIM: Record<string, number> = {
      swing: 6.5, hit: 9, deflect: 5, block: 6.5, guardBreak: 3, postureBreak: 4, deathblow: 0, hurt: 7, roll: 8.5, heal: 0, slip: 3.5,
      stoneHit: 2.5, throwFist: 4.5, buff: 2, charge: 6, beamFire: 0, warn: 2.5, thud: 0, whoosh: 0, clash: 3,
      blip: 0, riposteReady: 3, spirit: 2, whirl: 5, throwBlade: 5, bladeHit: 7, locked: 0, skill: 0,
    };
    for (const [name, db] of Object.entries(TRIM)) {
      const orig = (this as unknown as Record<string, (...a: unknown[]) => void>)[name].bind(this);
      (this as unknown as Record<string, (...a: unknown[]) => void>)[name] = (...a: unknown[]) => this.cue(db, () => orig(...a));
    }
  }
  private cue(db: number, fn: () => void) {
    const prev = this.curTrim;
    this.curTrim = prev + db; // nested cues (a hit calls thud) stack on the outer trim
    try {
      fn();
    } finally {
      this.curTrim = prev;
    }
  }

  // ------------------------------------------------------------------ plumbing
  private get ctx(): AudioContext | null {
    return (this.scene.sound as Phaser.Sound.WebAudioSoundManager).context ?? null;
  }
  /** Master bus: gain (the settings volume) -> compressor -> speakers. */
  private out(): { ctx: AudioContext; dest: AudioNode; t: number } | null {
    const ctx = this.ctx;
    if (!ctx || this.cfg().sfx <= 0) return null;
    if (!this.bus) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      this.bus = ctx.createGain();
      this.bus.connect(comp).connect(ctx.destination);
    }
    this.bus.gain.value = this.cfg().sfx * 1.1;
    const trim = ctx.createGain();
    trim.gain.value = 10 ** (this.curTrim / 20);
    trim.connect(this.bus);
    return { ctx, dest: trim, t: ctx.currentTime };
  }
  private noise(ctx: AudioContext) {
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    return n;
  }
  private env(ctx: AudioContext, t: number, vol: number, attack: number, decay: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  private tone(o: NonNullable<ReturnType<Sfx["out"]>>, type: OscillatorType, f0: number, f1: number, vol: number, attack: number, decay: number, at = 0) {
    const { ctx, dest, t } = o;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t + at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + at + attack + decay);
    const g = this.env(ctx, t + at, vol, attack, decay);
    osc.connect(g).connect(dest);
    osc.start(t + at);
    osc.stop(t + at + attack + decay + 0.05);
  }
  private burst(o: NonNullable<ReturnType<Sfx["out"]>>, kind: BiquadFilterType, f0: number, f1: number, q: number, vol: number, attack: number, decay: number, at = 0) {
    const { ctx, dest, t } = o;
    const n = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t + at);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + at + attack + decay);
    const g = this.env(ctx, t + at, vol, attack, decay);
    n.connect(f).connect(g).connect(dest);
    n.start(t + at, Math.random());
    n.stop(t + at + attack + decay + 0.05);
  }
  /** Play one of the recorded samples through the bus. */
  private sample(group: string, count: number, vol: number, rate = 1, pick?: number[]) {
    const o = this.out();
    if (!o) return;
    const idx = pick ? Phaser.Utils.Array.GetRandom(pick) : Phaser.Math.Between(1, count);
    const buf = this.scene.cache.audio.get(`${group}${idx}`) as AudioBuffer | undefined;
    if (!buf || !("getChannelData" in buf)) return;
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = o.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(o.dest);
    src.start();
  }

  // ------------------------------------------------------------------ building blocks
  thud(power = 1) {
    const o = this.out();
    if (!o) return;
    this.tone(o, "sine", 150, 42, 0.7 * power, 0.004, 0.2);
    this.burst(o, "lowpass", 600, 200, 0.7, 0.35 * power, 0.002, 0.07);
  }
  whoosh(vol = 0.3, dur = 0.26, from = 280, to = 1700, q = 0.9) {
    const o = this.out();
    if (!o) return;
    this.burst(o, "bandpass", from, to, q, vol, dur * 0.45, dur * 0.55);
  }

  // ------------------------------------------------------------------ combat
  swing(heavy: boolean, boss = false) {
    const rate = boss ? 0.8 : 1;
    if (heavy) this.sample("blade", 10, 0.5, rate, [9, 10]);
    else this.sample("blade", 10, 0.42, rate, [1, 3, 4, 7]);
    this.whoosh(heavy ? 0.28 : 0.2, heavy ? 0.34 : 0.22, boss ? 220 : 320, boss ? 1100 : 1900);
  }
  hit(heavy: boolean) {
    const o = this.out();
    if (!o) return;
    this.burst(o, "bandpass", 3600, 1100, 1.1, heavy ? 0.5 : 0.38, 0.003, 0.1);
    this.thud(heavy ? 1 : 0.55);
    this.sample("blade", 10, 0.3, 1, [2, 5, 8]);
  }
  /** A tapped guard meeting a blow: the bright, ringing one. */
  deflect() {
    this.sample("clash", 10, 0.75, 1, [1, 2, 3, 5]);
    this.clang(0.9);
    const o = this.out();
    if (o) this.tone(o, "sine", 2600, 2600, 0.12, 0.002, 0.45); // a thin ringing tail
  }
  block(power = 1) {
    this.sample("clash", 10, 0.5 * power, 0.85, [4, 6, 7, 9, 10]);
    this.thud(0.5 * power);
  }
  /** Generic metal-on-metal: sample + clang, scaled. */
  clash(power = 0.6) {
    this.sample("clash", 10, 0.5 * power, 1, [4, 6, 8, 10]);
    this.clang(power * 0.7);
  }
  stoneHit() {
    this.thud(0.8);
    const o = this.out();
    if (o) this.burst(o, "bandpass", 1200, 500, 2, 0.2, 0.002, 0.08);
  }
  guardBreak() {
    this.sample("clash", 10, 0.7, 0.8, [3, 5]);
    this.thud(1);
    this.clang(0.8);
  }
  slip() {
    this.sample("clash", 10, 0.55, 1.1, [2, 3]);
    this.thud(0.7);
  }
  postureBreak() {
    const o = this.out();
    if (!o) return;
    this.burst(o, "highpass", 2200, 5000, 0.8, 0.5, 0.002, 0.14);
    this.tone(o, "sine", 1100, 160, 0.45, 0.003, 0.34);
    this.thud(1.2);
    this.sample("clash", 10, 0.55, 0.9, [1, 5]);
  }
  deathblow() {
    const o = this.out();
    if (!o) return;
    this.tone(o, "sine", 95, 28, 0.9, 0.01, 0.6);
    this.burst(o, "lowpass", 900, 80, 0.7, 0.5, 0.02, 0.5);
    this.burst(o, "highpass", 1800, 5200, 0.8, 0.45, 0.004, 0.2, 0.02);
    this.sample("clash", 10, 0.8, 0.75, [2, 3]);
    this.clang(0.8);
  }
  hurt() {
    const o = this.out();
    if (!o) return;
    this.thud(0.9);
    this.burst(o, "bandpass", 700, 500, 5, 0.3, 0.01, 0.16); // a grunt-ish formant
    this.burst(o, "bandpass", 1150, 900, 6, 0.18, 0.01, 0.14);
    this.sample("blade", 10, 0.25, 1, [2, 8]);
  }
  roll() {
    this.whoosh(0.3, 0.24, 450, 900, 0.7);
    const o = this.out();
    if (o) this.burst(o, "lowpass", 500, 300, 0.5, 0.18, 0.02, 0.12);
  }
  heal() {
    const o = this.out();
    if (!o) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(o, "sine", f, f, 0.2, 0.01, 0.34, i * 0.09));
    this.burst(o, "highpass", 6000, 6000, 0.5, 0.05, 0.1, 0.4);
  }
  throwFist() {
    this.whoosh(0.32, 0.3, 200, 900, 0.8);
    this.thud(0.5);
  }
  buff() {
    const o = this.out();
    if (!o) return;
    this.tone(o, "sawtooth", 110, 330, 0.18, 0.2, 0.5);
    this.tone(o, "sine", 660, 990, 0.14, 0.15, 0.5);
    this.thud(0.8);
  }
  charge() {
    const o = this.out();
    if (o) this.tone(o, "sine", 160, 420, 0.16, 0.5, 0.2);
  }
  beamFire() {
    const o = this.out();
    if (!o) return;
    this.tone(o, "sawtooth", 1400, 160, 0.3, 0.01, 0.5);
    this.tone(o, "sine", 70, 40, 0.7, 0.02, 0.55);
    this.burst(o, "bandpass", 3000, 900, 0.8, 0.35, 0.02, 0.45);
  }

  // ------------------------------------------------------------------ warnings: one unmistakable cue per unblockable move
  warn(kind: "thrust" | "sweep" | "grab" | "beam" | string) {
    const o = this.out();
    if (!o) return;
    if (kind === "thrust") {
      // two rising, sharp chime notes: a needle
      this.tone(o, "triangle", 880, 880, 0.34, 0.004, 0.16);
      this.tone(o, "triangle", 1320, 1320, 0.38, 0.004, 0.4, 0.1);
      this.tone(o, "sine", 2640, 2640, 0.1, 0.004, 0.4, 0.1);
    } else if (kind === "sweep") {
      // a low swelling rumble with a rising edge: the ground gathering
      this.tone(o, "sawtooth", 55, 95, 0.32, 0.3, 0.45);
      this.burst(o, "lowpass", 220, 420, 0.9, 0.5, 0.3, 0.4);
    } else if (kind === "grab") {
      // a dissonant (tritone) tremolo and a breath: unsettling, nothing like the others
      this.tone(o, "sine", 440, 440, 0.2, 0.15, 0.5);
      this.tone(o, "sine", 622, 622, 0.2, 0.15, 0.5);
      this.tone(o, "sine", 447, 447, 0.12, 0.15, 0.5);
      this.burst(o, "highpass", 3500, 6500, 0.7, 0.16, 0.25, 0.3);
    } else if (kind === "beam") {
      // a charging whine that climbs for the whole telegraph
      this.tone(o, "sawtooth", 160, 900, 0.34, 0.7, 0.15);
      this.tone(o, "sine", 320, 1800, 0.22, 0.7, 0.15);
    }
  }

  /** Dialogue typewriter tick; the Instructor's voice is a soft low tone, the narrator a higher one. */
  blip(who: string) {
    const o = this.out();
    if (!o) return;
    const f = who === "INSTRUCTOR" ? 210 + Math.random() * 30 : 330 + Math.random() * 40;
    this.tone(o, "triangle", f, f * 0.96, 0.05, 0.003, 0.05);
  }

  // ------------------------------------------------------------------ skills
  /** A soft two-note chime: a riposte is available. */
  riposteReady() {
    const o = this.out();
    if (!o) return;
    this.tone(o, "sine", 988, 988, 0.22, 0.004, 0.22);
    this.tone(o, "sine", 1480, 1480, 0.2, 0.004, 0.3, 0.08);
  }
  spirit() {
    const o = this.out();
    if (o) this.tone(o, "sine", 600, 1200, 0.2, 0.01, 0.2);
  }
  whirl() {
    this.whoosh(0.34, 0.36, 300, 2600, 0.7);
    this.sample("blade", 10, 0.4, 1, [9, 10]);
    this.thud(0.4);
  }
  throwBlade() {
    this.whoosh(0.26, 0.16, 1200, 3400, 1.2);
  }
  bladeHit() {
    const o = this.out();
    if (!o) return;
    this.burst(o, "bandpass", 3200, 1500, 1.4, 0.4, 0.002, 0.07);
    this.thud(0.4);
  }
  /** Menu feedback: a refused action. */
  locked() {
    const o = this.out();
    if (o) this.tone(o, "square", 180, 120, 0.12, 0.004, 0.14);
  }
  skill() {
    const o = this.out();
    if (!o) return;
    [392, 523, 659].forEach((f, i) => this.tone(o, "triangle", f, f, 0.16, 0.01, 0.3, i * 0.07));
  }

  /** A bright inharmonic ring: four detuned partials with fast decay plus a short noise tick. */
  clang(power = 1) {
    const o = this.out();
    if (!o) return;
    const base = Phaser.Math.Between(1500, 2000);
    for (const [mul, vol, decay, type] of [[1, 0.9, 0.55, "triangle"], [2.76, 0.55, 0.35, "sine"], [5.4, 0.32, 0.2, "sine"], [8.93, 0.16, 0.12, "sine"]] as const)
      this.tone(o, type, base * mul, base * mul, vol * 0.4 * power, 0.001, decay);
    this.burst(o, "highpass", 3000, 3000, 0.7, 0.3 * power, 0.001, 0.03);
  }

  // ------------------------------------------------------------------ music + beat clock
  private musicInfo?: { bpm: number; phase: number };
  private musicT0 = 0; // AudioContext time at which the track started
  private beatFallbackT0 = performance.now();

  playMusic(name: string, volume = 0.25) {
    this.stopMusic();
    const info = this.manifest.music?.[name];
    if (!info) return;
    this.music = this.scene.sound.add("music_" + name, { loop: true, volume: this.musicOn && this.cfg().music ? volume : 0 });
    this.music.play();
    this.musicInfo = { bpm: info.bpm, phase: info.phase };
    this.musicT0 = this.ctx?.currentTime ?? 0;
    this.beatFallbackT0 = performance.now();
  }
  stopMusic() {
    this.music?.stop();
    this.music?.destroy();
    this.music = undefined;
  }
  toggleMusic() {
    this.musicOn = !this.musicOn;
    (this.music as Phaser.Sound.WebAudioSound | undefined)?.setVolume(this.musicOn ? 0.25 : 0);
  }
  /** Tempo of the current track (BPM), or a default when none is playing. */
  get bpm() {
    return this.musicInfo?.bpm ?? 90;
  }
  /** Beats elapsed since the track's first beat (fractional). Keeps counting at the track's tempo if the music is muted. */
  beatPos() {
    const info = this.musicInfo ?? { bpm: 90, phase: 0 };
    const sec = this.musicInfo && this.ctx ? this.ctx.currentTime - this.musicT0 : (performance.now() - this.beatFallbackT0) / 1000;
    return ((sec - info.phase) * info.bpm) / 60;
  }
}
