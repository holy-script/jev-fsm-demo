/** Quick-time event logic (pure, no Phaser). Two kinds:
 *  - QteRun: a sequence of key prompts, each with a shrinking ring that closes at `windowMs`; pressing the right key near the close is
 *    perfect/good, too early (a mash) or the wrong key is a miss.
 *  - MashRun: press one key `need` times inside `ms` (the clash). */
export type Grade = "perfect" | "good" | "miss";
export interface Prompt {
  key: string;
  windowMs: number;
}
export type DeathblowGrade = "execute" | "clean" | "scuffed";

export class QteRun {
  i = 0;
  t = 0;
  grades: Grade[] = [];
  done = false;
  constructor(readonly prompts: Prompt[], readonly perfectMs = 110, readonly goodMs = 260) {}

  get current(): Prompt | null {
    return this.done ? null : this.prompts[this.i];
  }
  /** signed ms from the ring closing: negative = early */
  get offset(): number {
    const c = this.current;
    return c ? this.t - c.windowMs : 0;
  }
  update(dtMs: number) {
    const c = this.current;
    if (!c) return;
    this.t += dtMs;
    if (this.t > c.windowMs + this.goodMs) this.advance("miss");
  }
  press(key: string): Grade | null {
    const c = this.current;
    if (!c) return null;
    let g: Grade = "miss";
    if (key === c.key) {
      const err = Math.abs(this.t - c.windowMs);
      g = err <= this.perfectMs ? "perfect" : err <= this.goodMs ? "good" : "miss";
    }
    this.advance(g);
    return g;
  }
  private advance(g: Grade) {
    this.grades.push(g);
    this.i++;
    this.t = 0;
    if (this.i >= this.prompts.length) this.done = true;
  }
  get summary() {
    const perfect = this.grades.filter((g) => g === "perfect").length;
    const good = this.grades.filter((g) => g === "good").length;
    const grade: DeathblowGrade = perfect === this.prompts.length ? "execute" : perfect + good >= Math.ceil(this.prompts.length * 0.66) ? "clean" : "scuffed";
    return { perfect, good, miss: this.grades.length - perfect - good, grade };
  }
}

export class MashRun {
  count = 0;
  t = 0;
  constructor(readonly need: number, readonly ms: number) {}
  press() {
    if (!this.done) this.count++;
  }
  update(dtMs: number) {
    if (!this.done) this.t += dtMs;
  }
  get won() {
    return this.count >= this.need;
  }
  get done() {
    return this.count >= this.need || this.t >= this.ms;
  }
}
