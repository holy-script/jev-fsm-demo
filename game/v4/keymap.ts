/** Key bindings and labels: no Phaser import, so the React shell can use it during server rendering. The Phaser side is input.ts. */
export type Action = "up" | "down" | "left" | "right" | "attack" | "guard" | "roll" | "jump" | "dash" | "skill" | "bolt" | "nova" | "item" | "pot";
export type Keymap = Record<Action, string[]>;

export const ACTIONS: Action[] = ["up", "down", "left", "right", "attack", "guard", "roll", "jump", "dash", "skill", "bolt", "nova", "item", "pot"];
export const ACTION_LABEL: Record<Action, string> = { up: "Move up", down: "Move down", left: "Move left", right: "Move right", attack: "Attack", guard: "Guard / parry", roll: "Roll", jump: "Jump", dash: "Dash", skill: "Flame Burst", bolt: "Ember Bolt", nova: "Inferno Ring", item: "Healing gourd", pot: "Fire pot" };

/** Phaser key names (Phaser.Input.Keyboard.KeyCodes). Two slots per action; the first is the one shown in prompts. */
export const DEFAULT_KEYMAP: Keymap = {
  up: ["W", "UP"], down: ["S", "DOWN"], left: ["A", "LEFT"], right: ["D", "RIGHT"],
  attack: ["J"], guard: ["SPACE", "K"], roll: ["SHIFT", "L"], jump: ["I"], dash: ["U"], skill: ["E"], bolt: ["Q"], nova: ["R"], item: ["H"], pot: ["G"],
};

/** Gamepad (standard mapping): left stick or d-pad moves, X attacks, A rolls, B or LB guards, RB jumps, RT dashes, Y Flame Burst, LT Ember Bolt, Back Inferno Ring, L3 gourd, R3 fire pot, Start pauses. */
export const PAD = { attack: 2, roll: 0, guard: [1, 4], jump: 5, dash: 7, skill: 3, bolt: 6, nova: 8, item: 10, pot: 11, start: 9, dpad: { up: 12, down: 13, left: 14, right: 15 }, deadzone: 0.3 };

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

/** Key names the game accepts (a subset of Phaser's KeyCodes; kept here so the React shell can validate without loading Phaser). */
const VALID_KEYS = new Set([...("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")), "UP", "DOWN", "LEFT", "RIGHT", "SPACE", "SHIFT", "CTRL", "ENTER", "BACKSPACE", "COMMA", "PERIOD", "FORWARD_SLASH", "SEMICOLON", "QUOTES", ...DIGITS]);

export function normaliseKeymap(k: Partial<Keymap> | undefined): Keymap {
  const out = {} as Keymap;
  for (const a of ACTIONS) {
    const v = k?.[a];
    out[a] = Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && VALID_KEYS.has(x)) ? v.slice(0, 2) : [...DEFAULT_KEYMAP[a]];
  }
  return out;
}

