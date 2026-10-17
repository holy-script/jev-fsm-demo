import * as Phaser from "phaser";

/** One place that turns keyboard (rebindable), mouse and gamepad into the actions the game uses. The scene polls it once per frame and
 *  never looks at keys directly, so rebinding and pads work everywhere (movement, combat, QTE prompts). */
export type Action = "up" | "down" | "left" | "right" | "attack" | "guard" | "roll" | "skill";
export type Keymap = Record<Action, string[]>;

export const ACTIONS: Action[] = ["up", "down", "left", "right", "attack", "guard", "roll", "skill"];
export const ACTION_LABEL: Record<Action, string> = { up: "Move up", down: "Move down", left: "Move left", right: "Move right", attack: "Attack", guard: "Guard / parry", roll: "Roll", skill: "Flame burst" };

/** Phaser key names (Phaser.Input.Keyboard.KeyCodes). Two slots per action; the first is the one shown in prompts. */
export const DEFAULT_KEYMAP: Keymap = {
  up: ["W", "UP"], down: ["S", "DOWN"], left: ["A", "LEFT"], right: ["D", "RIGHT"],
  attack: ["J"], guard: ["SPACE", "K"], roll: ["SHIFT", "L"], skill: ["E"],
};

/** Gamepad (standard mapping): left stick or d-pad moves, X attacks, A rolls, B or a shoulder button guards, Y casts, Start pauses. */
export const PAD = { attack: 2, roll: 0, guard: [1, 4, 5], skill: 3, start: 9, dpad: { up: 12, down: 13, left: 14, right: 15 }, deadzone: 0.3 };

const NAMED: Record<string, string> = { Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT", ControlLeft: "CTRL", ControlRight: "CTRL", Enter: "ENTER", Backspace: "BACKSPACE", Comma: "COMMA", Period: "PERIOD", Slash: "FORWARD_SLASH", Semicolon: "SEMICOLON", Quote: "QUOTES" };
const DIGITS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];

/** KeyboardEvent.code -> Phaser key name, or null when the key is reserved or unsupported (Escape pauses, Tab opens the panel). */
export function codeToKey(code: string): string | null {
  if (code === "Escape" || code === "Tab") return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.slice(5).toUpperCase();
  if (/^Digit\d$/.test(code)) return DIGITS[Number(code.slice(5))];
  return NAMED[code] ?? null;
}

/** What a prompt or a settings row should show for a Phaser key name. */
export function keyLabel(name: string | undefined): string {
  if (!name) return "-";
  const m: Record<string, string> = { SPACE: "Space", SHIFT: "Shift", UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→", CTRL: "Ctrl", ENTER: "Enter", COMMA: ",", PERIOD: ".", FORWARD_SLASH: "/", SEMICOLON: ";", QUOTES: "'" };
  const d = DIGITS.indexOf(name);
  return m[name] ?? (d >= 0 ? String(d) : name);
}

export function normaliseKeymap(k: Partial<Keymap> | undefined): Keymap {
  const out = {} as Keymap;
  for (const a of ACTIONS) {
    const v = k?.[a];
    out[a] = Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && x in Phaser.Input.Keyboard.KeyCodes) ? v.slice(0, 2) : [...DEFAULT_KEYMAP[a]];
  }
  return out;
}

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
