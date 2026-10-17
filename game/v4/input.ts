import * as Phaser from "phaser";
import { ACTIONS, PAD, keyLabel, normaliseKeymap, type Action, type Keymap } from "./keymap";
export * from "./keymap";

/** One place that turns keyboard (rebindable), mouse and gamepad into the actions the game uses. The scene polls it once per frame and
 *  never looks at keys directly, so rebinding and pads work everywhere (movement, combat, QTE prompts). */
export interface InputFrame {
  dir: { x: number; y: number; any: boolean };
  attack: boolean; // pressed this frame
  guard: boolean; // pressed this frame
  roll: boolean;
  skill: boolean;
  guardHeld: boolean;
  pause: boolean;
  pad: boolean; // a pad drove any of this frame's input
}

export class GameInput {
  private keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private clicked = false;
  private prevPad: boolean[] = [];
  private padWasDown = false;
  keymap: Keymap;

  constructor(private scene: Phaser.Scene, keymap: Keymap) {
    this.keymap = normaliseKeymap(keymap);
    this.bind();
    scene.input.on("pointerdown", () => (this.clicked = true));
  }

  setKeymap(k: Keymap) {
    this.keymap = normaliseKeymap(k);
    this.bind();
  }

  private bind() {
    const kb = this.scene.input.keyboard!;
    for (const key of this.keys.values()) kb.removeKey(key, true);
    this.keys.clear();
    const names = new Set(ACTIONS.flatMap((a) => this.keymap[a]));
    for (const n of names) this.keys.set(n, kb.addKey(n));
    kb.addCapture([...names].filter((n) => ["SPACE", "UP", "DOWN", "LEFT", "RIGHT"].includes(n)).join(","));
  }

  /** The first key bound to an action, for prompts. */
  label(a: Action) {
    return keyLabel(this.keymap[a][0]);
  }

  private down(a: Action) {
    return this.keymap[a].some((n) => this.keys.get(n)?.isDown);
  }
  private just(a: Action) {
    let hit = false;
    for (const n of this.keymap[a]) {
      const k = this.keys.get(n);
      if (k && Phaser.Input.Keyboard.JustDown(k)) hit = true;
    }
    return hit;
  }

  poll(): InputFrame {
    let x = (this.down("right") ? 1 : 0) - (this.down("left") ? 1 : 0);
    let y = (this.down("down") ? 1 : 0) - (this.down("up") ? 1 : 0);
    let attack = this.just("attack") || this.clicked;
    let guard = this.just("guard");
    let roll = this.just("roll");
    let skill = this.just("skill");
    let guardHeld = this.down("guard");
    let pause = false;
    let pad = false;
    this.clicked = false;

    const gp = this.scene.input.gamepad?.getPad(0);
    if (gp && gp.connected) {
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const edge = (i: number) => b(i) && !this.prevPad[i];
      const ax = gp.axes[0]?.getValue() ?? 0, ay = gp.axes[1]?.getValue() ?? 0;
      const dz = PAD.deadzone;
      const px = (Math.abs(ax) > dz ? ax : 0) + (b(PAD.dpad.right) ? 1 : 0) - (b(PAD.dpad.left) ? 1 : 0);
      const py = (Math.abs(ay) > dz ? ay : 0) + (b(PAD.dpad.down) ? 1 : 0) - (b(PAD.dpad.up) ? 1 : 0);
      if (px || py) { x = Phaser.Math.Clamp(x + px, -1, 1); y = Phaser.Math.Clamp(y + py, -1, 1); pad = true; }
      if (edge(PAD.attack)) { attack = true; pad = true; }
      if (edge(PAD.roll)) { roll = true; pad = true; }
      if (edge(PAD.skill)) { skill = true; pad = true; }
      const gh = PAD.guard.some(b);
      if (PAD.guard.some(edge)) { guard = true; pad = true; }
      if (gh) { guardHeld = true; pad = true; }
      if (edge(PAD.start)) pause = true;
      this.prevPad = gp.buttons.map((bt) => !!bt.pressed);
      this.padWasDown = pad;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { dir: { x, y, any: Math.abs(x) > 0.01 || Math.abs(y) > 0.01 }, attack, guard, roll, skill, guardHeld, pause, pad };
  }

  get usingPad() {
    return this.padWasDown;
  }
}
