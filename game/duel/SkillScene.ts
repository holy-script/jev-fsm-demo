import * as Phaser from "phaser";
import { PATH_LABEL, SKILLS, buy, canBuy, has } from "./skills";
import { save } from "./settings";
import { VIEW_H, VIEW_W } from "./data";
import { Sfx } from "./sfx";

/** The shrine: spend skill points. Opened after a boss falls and from the pause menu. */
export class SkillScene extends Phaser.Scene {
  private returnTo: "duel" | "menu" = "duel";
  private idx = 0;
  private rows: Phaser.GameObjects.Text[] = [];
  private head!: Phaser.GameObjects.Text;
  private blurb!: Phaser.GameObjects.Text;
  private msg!: Phaser.GameObjects.Text;
  private g!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private sfx?: Sfx;

  constructor() {
    super("skills");
  }
  init(data: { from?: "duel" | "menu" }) {
    this.returnTo = data.from ?? "duel";
    this.idx = 0;
    this.rows = []; // the scene object is reused: drop rows destroyed by the previous opening
  }

  create() {
    const font = { fontFamily: "monospace", color: "#efe6d2", stroke: "#000", strokeThickness: 4 };
    this.g = this.add.graphics();
    this.head = this.add.text(VIEW_W / 2, 70, "", { ...font, fontSize: "40px", strokeThickness: 7 }).setOrigin(0.5);
    this.blurb = this.add.text(VIEW_W / 2, VIEW_H - 110, "", { ...font, fontSize: "19px", color: "#cfc7b4", align: "center", wordWrap: { width: 900 } }).setOrigin(0.5);
    this.msg = this.add.text(VIEW_W / 2, VIEW_H - 60, "", { ...font, fontSize: "15px", color: "#9aa4b2", strokeThickness: 3 }).setOrigin(0.5);
    const manifest = this.cache.json.get("manifest");
    if (manifest) this.sfx = new Sfx(this, manifest);
    let y = 150;
    let lastPath = "";
    SKILLS.forEach((sk, i) => {
      if (sk.path !== lastPath) {
        lastPath = sk.path;
        this.add.text(VIEW_W / 2 - 330, y, PATH_LABEL[sk.path], { ...font, fontSize: "15px", color: "#ffd36b", strokeThickness: 3 });
        y += 26;
      }
      const t = this.add.text(VIEW_W / 2 - 330, y, "", { ...font, fontSize: "22px" }).setInteractive({ useHandCursor: true });
      t.on("pointerover", () => { this.idx = i; this.refresh(); });
      t.on("pointerdown", () => { this.idx = i; this.activate(); });
      this.rows.push(t);
      y += 31;
      if (i < SKILLS.length - 1 && SKILLS[i + 1].path !== sk.path) y += 12;
    });
    const close = this.add.text(VIEW_W / 2 - 330, y + 12, "", { ...font, fontSize: "22px", color: "#9ad0ff" }).setInteractive({ useHandCursor: true });
    close.on("pointerover", () => { this.idx = SKILLS.length; this.refresh(); });
    close.on("pointerdown", () => this.close());
    this.rows.push(close);
    this.keys = this.input.keyboard!.addKeys("UP,DOWN,W,S,ENTER,SPACE,J,ESC") as Record<string, Phaser.Input.Keyboard.Key>;
    const k = this.keys;
    const move = (d: number) => { this.idx = (this.idx + d + this.rows.length) % this.rows.length; this.refresh(); };
    k.UP.on("down", () => move(-1)); k.W.on("down", () => move(-1));
    k.DOWN.on("down", () => move(1)); k.S.on("down", () => move(1));
    for (const key of [k.ENTER, k.SPACE, k.J]) key.on("down", () => this.activate());
    k.ESC.on("down", () => this.close());
    this.refresh();
  }

  private activate() {
    if (this.idx === SKILLS.length) return this.close();
    const sk = SKILLS[this.idx];
    if (buy(sk.id)) {
      this.sfx?.skill();
      this.msg.setText(`${sk.name} learned.`);
    } else {
      this.sfx?.locked();
      this.msg.setText(has(sk.id) ? "Already learned." : sk.needs && !has(sk.needs) ? `Requires ${SKILLS.find((s) => s.id === sk.needs)!.name} first.` : "Not enough skill points.");
    }
    this.refresh();
  }

  private close() {
    this.scene.stop();
    this.scene.setVisible(true, this.returnTo);
    this.scene.resume(this.returnTo);
    this.scene.get(this.returnTo).events.emit("skills-closed");
  }

  private refresh() {
    this.head.setText(`SHRINE   skill points: ${save.points}`);
    this.rows.slice(0, SKILLS.length).forEach((t, i) => {
      const sk = SKILLS[i];
      const own = has(sk.id), buyable = canBuy(sk);
      const mark = own ? "[x]" : buyable ? "[ ]" : "[-]";
      t.setText(`${mark} ${sk.name.padEnd(16)} ${own ? "learned" : sk.cost + (sk.cost > 1 ? " pts" : " pt")}`)
        .setColor(i === this.idx ? "#ffd36b" : own ? "#7ee787" : buyable ? "#efe6d2" : "#6b7280");
    });
    const close = this.rows[SKILLS.length];
    close.setText("Continue").setColor(this.idx === SKILLS.length ? "#ffd36b" : "#9ad0ff");
    this.blurb.setText(this.idx < SKILLS.length ? SKILLS[this.idx].blurb + (SKILLS[this.idx].needs ? `  (needs ${SKILLS.find((s) => s.id === SKILLS[this.idx].needs)!.name})` : "") : "Back to the fight.");
    this.g.clear();
    this.g.fillStyle(0x05070a, 0.9).fillRect(0, 0, VIEW_W, VIEW_H);
    this.g.fillStyle(0x1b1a16, 0.9).fillRect(VIEW_W / 2 - 360, 128, 720, VIEW_H - 280).lineStyle(2, 0x6b5a3a, 1).strokeRect(VIEW_W / 2 - 360, 128, 720, VIEW_H - 280);
    this.children.bringToTop(this.head);
    this.rows.forEach((r) => this.children.bringToTop(r));
  }
}
