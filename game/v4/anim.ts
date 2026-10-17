/** Frame-sequence player used by every v4 sprite. Unlike Phaser's built-in animations it can run a range backwards (the reverse
 *  perfect parry), hold on a frame for an extra time (telegraphs), freeze (hit-stop) and report its own progress. Pure logic: no Phaser. */
export interface PlayOpts {
  fps?: number;
  /** extra milliseconds to stay on a frame (frame number in the sheet, not the sequence index) */
  holds?: Record<number, number>;
  loop?: boolean;
  onDone?: () => void;
}

export class Animator {
  sheet = "";
  frame = 0;
  done = true;
  speed = 1;
  loop = false;
  from = 0;
  to = 0;
  private k = 0;
  private t = 0;
  private fps = 12;
  private holds: Record<number, number> = {};
  private onDone?: () => void;

  /** Play `from..to` inclusive. from > to plays it in reverse. */
  play(sheet: string, from: number, to: number, o: PlayOpts = {}) {
    this.sheet = sheet;
    this.from = from;
    this.to = to;
    this.k = 0;
    this.t = 0;
    this.frame = from;
    this.fps = o.fps ?? 12;
    this.holds = o.holds ?? {};
    this.loop = !!o.loop;
    this.onDone = o.onDone;
    this.done = false;
    if (from === to && !o.loop) this.done = false; // a one-frame clip still lasts one frame time
  }

  /** Run the part of the current clip that has been played so far backwards, in `ms` total. Returns the number of frames covered. */
  reverseTo(frame: number, ms: number, onDone?: () => void) {
    const steps = Math.abs(this.frame - frame) + 1;
    this.play(this.sheet, this.frame, frame, { fps: (steps / Math.max(ms, 1)) * 1000, onDone });
    return steps;
  }

  hold(sheet: string, frame: number) {
    this.play(sheet, frame, frame, { loop: true });
  }

  get length() {
    return Math.abs(this.to - this.from) + 1;
  }
  get dir() {
    return this.to >= this.from ? 1 : -1;
  }
  get reversed() {
    return this.to < this.from;
  }
  /** 0..1 through the clip (a loop wraps) */
  get progress() {
    return (this.k + Math.min(1, this.t / this.dur())) / this.length;
  }
  private dur() {
    return 1000 / this.fps + (this.holds[this.frame] ?? 0);
  }

  update(dtMs: number) {
    if (this.done || this.speed <= 0) return;
    this.t += dtMs * this.speed;
    let guard = 64;
    while (this.t >= this.dur() && guard-- > 0) {
      this.t -= this.dur();
      if (this.k >= this.length - 1) {
        if (this.loop) this.k = 0;
        else {
          this.done = true;
          this.t = 0;
          const cb = this.onDone;
          this.onDone = undefined;
          cb?.();
          return;
        }
      } else this.k++;
      this.frame = this.from + this.dir * this.k;
    }
  }
}
