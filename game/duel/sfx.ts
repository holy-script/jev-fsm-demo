import * as Phaser from "phaser";
import type { DuelManifest } from "./engine";

/** Ninja Adventure samples plus a synthesised metal clang for the deflect (the parry should always ring). */
export class Sfx {
  private music?: Phaser.Sound.BaseSound;
  musicOn = true;
  constructor(private scene: Phaser.Scene, private manifest: DuelManifest) {}

  play(name: string, o: { volume?: number; rate?: number; detune?: number } = {}) {
    if (!this.manifest.audio[name]) return;
    this.scene.sound.play(name, { volume: o.volume ?? 0.6, rate: o.rate ?? 1, detune: o.detune ?? Phaser.Math.Between(-80, 80) });
  }
  pick(names: string[], o: { volume?: number; rate?: number } = {}) {
    this.play(Phaser.Utils.Array.GetRandom(names), o);
  }

  /** A bright inharmonic ring: three detuned partials with fast decay plus a short noise tick. */
  clang(power = 1) {
    const ctx = (this.scene.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const base = Phaser.Math.Between(1500, 2000);
    const master = ctx.createGain();
    master.gain.value = 0.32 * power;
    master.connect(ctx.destination);
    for (const [mul, vol, decay, type] of [[1, 1, 0.55, "triangle"], [2.76, 0.6, 0.35, "sine"], [5.4, 0.35, 0.2, "sine"], [8.93, 0.18, 0.12, "sine"]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(base * mul, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + decay + 0.05);
    }
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    n.buffer = buf;
    n.connect(hp).connect(master);
    n.start(t0);
  }

  playMusic(name: string, volume = 0.25) {
    this.stopMusic();
    if (!this.manifest.music[name]) return;
    this.music = this.scene.sound.add("music_" + name, { loop: true, volume: this.musicOn ? volume : 0 });
    this.music.play();
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
}
