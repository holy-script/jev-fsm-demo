import * as Phaser from "phaser";
import { VIEW_H, VIEW_W } from "./data";
import type { HudState } from "./DuelScene";

const lerpColor = (a: number, b: number, t: number) => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(a), Phaser.Display.Color.ValueToColor(b), 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
};

/** Screen-space UI: HP, centre-out posture bars (Sekiro style), boss bar, banners. Reads the shared state the duel scene writes. */
export class HudScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private bossName!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private brain!: Phaser.GameObjects.Text;

  constructor() {
    super("duelhud");
  }

  create() {
    this.g = this.add.graphics();
    const font = { fontFamily: "monospace", color: "#f3ead8", stroke: "#000", strokeThickness: 4 };
    this.title = this.add.text(VIEW_W / 2, 210, "", { ...font, fontSize: "44px", strokeThickness: 7 }).setOrigin(0.5);
    this.sub = this.add.text(VIEW_W / 2, 258, "", { ...font, fontSize: "16px" }).setOrigin(0.5);
    this.bossName = this.add.text(VIEW_W / 2, 20, "", { ...font, fontSize: "13px", strokeThickness: 3 }).setOrigin(0.5, 0);
    this.brain = this.add.text(24, VIEW_H - 70, "", { ...font, fontSize: "11px", strokeThickness: 3 }).setOrigin(0, 0);
    this.help = this.add
      .text(VIEW_W - 12, VIEW_H - 10, "J attack · K heavy · SPACE guard (tap = deflect) · SHIFT roll · E kick · Q heal · F brain · M music · R retry", { ...font, fontSize: "10px", strokeThickness: 3 })
      .setOrigin(1, 1)
      .setAlpha(0.7);
  }

  /** A bar whose fill grows from the centre outward. */
  private centreBar(cx: number, y: number, w: number, h: number, frac: number, color: number) {
    const g = this.g;
    g.fillStyle(0x000000, 0.55).fillRect(cx - w / 2 - 2, y - 2, w + 4, h + 4);
    const half = (w / 2) * Phaser.Math.Clamp(frac, 0, 1);
    g.fillStyle(color).fillRect(cx - half, y, half * 2, h);
    g.lineStyle(1, 0xcfc4ac, 0.5).strokeRect(cx - w / 2, y, w, h);
  }

  update() {
    const s = this.registry.get("hud") as HudState | undefined;
    if (!s) return;
    const g = this.g;
    g.clear();

    // player HP (bottom left) + heal charges
    g.fillStyle(0x000000, 0.55).fillRect(22, VIEW_H - 46, 264, 16);
    g.fillStyle(0x7d1f24).fillRect(24, VIEW_H - 44, 260 * Math.max(0, s.hp), 12);
    g.fillStyle(0xd23a3f).fillRect(24, VIEW_H - 44, 260 * Math.max(0, s.hp), 4);
    for (let i = 0; i < s.heals; i++) g.fillStyle(0x6bff9a).fillCircle(30 + i * 16, VIEW_H - 22, 5).lineStyle(1, 0x000000, 0.8).strokeCircle(30 + i * 16, VIEW_H - 22, 5);

    // player posture (bottom centre): white -> orange -> red as it fills
    const pc = s.posture < 0.6 ? lerpColor(0xe9e2cf, 0xf0a030, s.posture / 0.6) : lerpColor(0xf0a030, 0xe0302a, (s.posture - 0.6) / 0.4);
    this.centreBar(VIEW_W / 2, VIEW_H - 34, 300, 8, s.posture, pc);

    if (s.bossVisible) {
      const w = 520, x = VIEW_W / 2 - w / 2, y = 40;
      g.fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, w + 4, 16);
      g.fillStyle(0x6a2a8a).fillRect(x, y, w * Math.max(0, s.bossHp), 12);
      g.fillStyle(0xb257e0).fillRect(x, y, w * Math.max(0, s.bossHp), 4);
      for (let i = 1; i < s.bossSegs; i++) g.fillStyle(0x000000, 0.9).fillRect(x + (w * i) / s.bossSegs - 1, y - 2, 3, 16);
      const bc = s.bossPosture < 0.6 ? lerpColor(0xe9e2cf, 0xf0a030, s.bossPosture / 0.6) : lerpColor(0xf0a030, 0xe0302a, (s.bossPosture - 0.6) / 0.4);
      this.centreBar(VIEW_W / 2, y + 22, 340, 7, s.bossPosture, bc);
      if (s.bossGuard) g.fillStyle(0x8fd0ff).fillRect(VIEW_W / 2 + 180, y + 20, 10, 10);
      this.bossName.setText(s.bossName).setVisible(true);
    } else this.bossName.setVisible(false);

    const dots = ".".repeat(1 + (Math.floor(this.time.now / 250) % 3));
    this.brain.setVisible(s.bossVisible).setColor(s.brain === "JEV" ? "#8fd0ff" : "#ffd36b").setText(`BRAIN ${s.brain}${s.thinking ? " thinking" + dots : ""}${s.last ? "   " + s.last : ""}`);

    this.title.setText(s.message);
    this.sub.setText(s.sub);
  }
}
