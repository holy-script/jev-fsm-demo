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
  private riposteText!: Phaser.GameObjects.Text;
  private dlgWho!: Phaser.GameObjects.Text;
  private dlgText!: Phaser.GameObjects.Text;
  private dlgMore!: Phaser.GameObjects.Text;
  private objTitle!: Phaser.GameObjects.Text;
  private objText!: Phaser.GameObjects.Text;
  private objProg!: Phaser.GameObjects.Text;
  private objHint!: Phaser.GameObjects.Text;

  constructor() {
    super("duelhud");
  }

  create() {
    this.g = this.add.graphics();
    const font = { fontFamily: "monospace", color: "#f3ead8", stroke: "#000", strokeThickness: 4 };
    this.title = this.add.text(VIEW_W / 2, 280, "", { ...font, fontSize: "58px", strokeThickness: 8 }).setOrigin(0.5);
    this.sub = this.add.text(VIEW_W / 2, 342, "", { ...font, fontSize: "20px" }).setOrigin(0.5);
    this.bossName = this.add.text(VIEW_W / 2, 22, "", { ...font, fontSize: "16px", strokeThickness: 4 }).setOrigin(0.5, 0);
    this.brain = this.add.text(28, VIEW_H - 92, "", { ...font, fontSize: "13px", strokeThickness: 3 }).setOrigin(0, 0);
    this.riposteText = this.add.text(VIEW_W / 2, VIEW_H - 86, "RIPOSTE  [J]", { ...font, fontSize: "18px", color: "#fff2b0", strokeThickness: 4 }).setOrigin(0.5).setVisible(false);
    this.dlgWho = this.add.text(VIEW_W / 2 - 430, VIEW_H - 286, "", { ...font, fontSize: "17px", color: "#9fd0ff", strokeThickness: 4 }).setDepth(5);
    this.dlgText = this.add.text(VIEW_W / 2 - 430, VIEW_H - 258, "", { ...font, fontSize: "21px", wordWrap: { width: 860 }, lineSpacing: 6, strokeThickness: 3 }).setDepth(5);
    this.dlgMore = this.add.text(VIEW_W / 2 + 420, VIEW_H - 196, "▼", { ...font, fontSize: "18px", color: "#ffd36b", strokeThickness: 3 }).setOrigin(1, 0.5).setDepth(5);
    this.objTitle = this.add.text(36, 104, "", { ...font, fontSize: "15px", color: "#ffd36b", strokeThickness: 3 });
    this.objText = this.add.text(36, 126, "", { ...font, fontSize: "16px", wordWrap: { width: 330 }, strokeThickness: 3 });
    this.objProg = this.add.text(36, 150, "", { ...font, fontSize: "15px", color: "#7ee787", strokeThickness: 3 });
    this.objHint = this.add.text(36, 174, "", { ...font, fontSize: "14px", color: "#9aa4b2", wordWrap: { width: 330 }, strokeThickness: 3 });
    this.help = this.add
      .text(VIEW_W - 12, VIEW_H - 10, "J attack · K heavy · SPACE guard (tap = deflect) · SHIFT roll · E kick · Q heal · F brain · M music · R retry", { ...font, fontSize: "12px", strokeThickness: 3 })
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
    g.fillStyle(0x000000, 0.55).fillRect(26, VIEW_H - 62, 344, 20);
    g.fillStyle(0x7d1f24).fillRect(28, VIEW_H - 60, 340 * Math.max(0, s.hp), 16);
    g.fillStyle(0xd23a3f).fillRect(28, VIEW_H - 60, 340 * Math.max(0, s.hp), 5);
    for (let i = 0; i < s.heals; i++) g.fillStyle(0x6bff9a).fillCircle(36 + i * 20, VIEW_H - 30, 7).lineStyle(1, 0x000000, 0.8).strokeCircle(36 + i * 20, VIEW_H - 30, 7);

    // spirit pips (diamonds) and the riposte prompt
    for (let i = 0; i < s.maxSpirit; i++) {
      const cx = 36 + i * 20, cy = VIEW_H - 74, on = i < s.spirit;
      g.fillStyle(on ? 0x7cc4ff : 0x1b2430, on ? 1 : 0.8).fillPoints([{ x: cx, y: cy - 7 }, { x: cx + 6, y: cy }, { x: cx, y: cy + 7 }, { x: cx - 6, y: cy }] as Phaser.Types.Math.Vector2Like[], true);
      g.lineStyle(1, 0x000000, 0.8).strokePoints([{ x: cx, y: cy - 7 }, { x: cx + 6, y: cy }, { x: cx, y: cy + 7 }, { x: cx - 6, y: cy }] as Phaser.Types.Math.Vector2Like[], true);
    }
    // player posture (bottom centre): white -> orange -> red as it fills
    const pc = s.posture < 0.6 ? lerpColor(0xe9e2cf, 0xf0a030, s.posture / 0.6) : lerpColor(0xf0a030, 0xe0302a, (s.posture - 0.6) / 0.4);
    this.centreBar(VIEW_W / 2, VIEW_H - 44, 420, 10, s.posture, pc);

    if (s.bossVisible) {
      const w = 680, x = VIEW_W / 2 - w / 2, y = 48;
      g.fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, w + 4, 20);
      g.fillStyle(0x6a2a8a).fillRect(x, y, w * Math.max(0, s.bossHp), 16);
      g.fillStyle(0xb257e0).fillRect(x, y, w * Math.max(0, s.bossHp), 5);
      for (let i = 1; i < s.bossSegs; i++) g.fillStyle(0x000000, 0.9).fillRect(x + (w * i) / s.bossSegs - 1, y - 2, 3, 20);
      const bc = s.bossPosture < 0.6 ? lerpColor(0xe9e2cf, 0xf0a030, s.bossPosture / 0.6) : lerpColor(0xf0a030, 0xe0302a, (s.bossPosture - 0.6) / 0.4);
      this.centreBar(VIEW_W / 2, y + 28, 460, 9, s.bossPosture, bc);
      if (s.bossGuard) g.fillStyle(0x8fd0ff).fillRect(VIEW_W / 2 + 244, y + 26, 12, 12);
      if (s.bossArmor) g.fillStyle(0x9fe8ff).fillRect(VIEW_W / 2 + 262, y + 26, 12, 12).lineStyle(1, 0x000000, 0.8).strokeRect(VIEW_W / 2 + 262, y + 26, 12, 12);
      this.bossName.setText(s.bossName).setVisible(true);
    } else this.bossName.setVisible(false);

    // dialogue box
    const dl = s.dialog;
    if (dl) {
      g.fillStyle(0x07090d, 0.88).fillRect(VIEW_W / 2 - 450, VIEW_H - 300, 900, 128);
      g.lineStyle(2, dl.who === "INSTRUCTOR" ? 0x4a7aa8 : 0x6b5a3a, 1).strokeRect(VIEW_W / 2 - 450, VIEW_H - 300, 900, 128);
    }
    this.dlgWho.setText(dl ? dl.who : "");
    this.dlgText.setText(dl ? dl.text : "");
    this.dlgMore.setVisible(!!dl?.done).setAlpha(0.5 + 0.5 * Math.sin(this.time.now / 160));
    // objective panel
    const ob = s.objective;
    this.objTitle.setText(ob ? `LESSON · ${ob.title}` : "");
    this.objText.setText(ob?.text ?? "");
    this.objProg.setText(ob?.progress ?? "").setY(this.objText.y + this.objText.height + 8);
    this.objHint.setText(ob?.hint ? `Hint: ${ob.hint}` : "").setY(this.objProg.y + (ob?.progress ? 24 : 0));
    if (ob) {
      const bottom = ob.hint ? this.objHint.y + this.objHint.height : ob.progress ? this.objProg.y + 22 : this.objText.y + this.objText.height;
      g.fillStyle(0x07090d, 0.8).fillRect(26, 92, 350, bottom - 92 + 12);
      g.lineStyle(1, 0x6b5a3a, 1).strokeRect(26, 92, 350, bottom - 92 + 12);
    }
    const dots = ".".repeat(1 + (Math.floor(this.time.now / 250) % 3));
    this.brain.setVisible(s.bossVisible).setColor(s.brain === "JEV" ? "#8fd0ff" : "#ffd36b").setText(`BRAIN ${s.brain}${s.thinking ? " thinking" + dots : ""}${s.last ? "   " + s.last : ""}`);

    const rp = 0.55 + 0.45 * Math.sin(this.time.now / 90);
    this.riposteText.setVisible(s.riposte).setAlpha(rp);
    this.help.setText(`J attack · K heavy · SPACE guard (tap = deflect) · SHIFT roll · E kick · Q heal${s.art ? " · L whirl" : ""}${s.tool ? " · I blades" : ""} · F brain · M music · R retry`);
    this.title.setText(s.message);
    this.sub.setText(s.sub);
  }
}
