// Needs `npm run dev` running and the duel assets built. Checks areas, zone title cards, travel between maps. Run: node tests/duel/world.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = []; const results = [];
const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
async function game(save) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  await p.addInitScript((sv) => { localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })); localStorage.setItem("duel.save", JSON.stringify(sv)); }, save);
  await p.goto("http://localhost:3000/duel", { waitUntil: "load" }); await p.waitForTimeout(4500);
  await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 20000 }); await p.waitForTimeout(900);
  return p;
}
const info = (p) => p.evaluate(() => { const d = window.__duel; return { area: d.areaId, def: d.def.id, awake: d.b.awake, shrines: d.world.shrines.length, lights: d.world.lights.length, lore: d.world.lore.length, bg: d.cameras.main.backgroundColor.rgba }; });

let p = await game({ cleared: ["bone-soldier", "spear-bearer", "captain"], deaths: 0, skills: [], points: 2, tutorialDone: true });
let s = await info(p);
check("Continue after the Captain loads the Foundry with the Golem asleep", s.area === "foundry" && s.def === "golem" && s.awake === false, s);
check("the Foundry map has its lights, a shrine and lore stones", s.lights >= 6 && s.shrines === 1 && s.lore >= 2, s);
await p.close();

p = await game({ cleared: [], deaths: 0, skills: [], points: 2, tutorialDone: true });
s = await info(p); check("a fresh save with the tutorial done starts in the Monastery", s.area === "monastery" && s.def === "bone-soldier", s);
await p.evaluate(() => { const d = window.__duel; d.player.x = d.world.spawns.player.x; d.player.y = 36 * 16; });
await p.waitForTimeout(400);
await p.evaluate(() => { const d = window.__duel; d.player.y = 40 * 16; }); await p.waitForTimeout(300);
await p.evaluate(() => { const d = window.__duel; d.player.y = 33 * 16 - 20; d.player.x = d.world.gate.l + 90; });   // through the gate gap: into the Hall
await p.waitForFunction(() => window.__duel.hud.card?.text, null, { timeout: 8000 }).catch(() => {});
const card = await p.evaluate(() => window.__duel.hud.card); check("crossing from the courtyard into the Hall shows its title card", card?.text === "HALL OF SPEARS", card);
await p.close();

// travel: Captain falls -> shrine -> Foundry
p = await game({ cleared: ["bone-soldier", "spear-bearer"], deaths: 0, skills: [], points: 2, tutorialDone: true });
await p.evaluate(() => { const d = window.__duel; d.wake(); d.b.auto = false; d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y; d.player.x = d.boss.x - 55; d.player.y = d.boss.y; d.b.seg = 1; d.b.hp = 4; d.b.mode = "idle"; d.b.nextThink = 1e12; });
await p.keyboard.down("j"); await p.waitForTimeout(40); await p.keyboard.up("j");
const shrine = await p.waitForFunction(() => window.__game.scene.isActive("skills"), null, { timeout: 40000 }).then(() => true, () => false);
await p.keyboard.press("Escape");
const arrived = await p.waitForFunction(() => window.__duel.areaId === "foundry" && window.__duel.def.id === "golem" && !window.__duel.travelling, null, { timeout: 40000 }).then(() => true, () => false);
s = await info(p); check("after the Captain and the shrine the game travels to the Foundry", shrine && arrived && s.awake === false, s);
const pos = await p.evaluate(() => ({ px: window.__duel.player.x, py: window.__duel.player.y, sx: window.__duel.world.spawns.player.x, sy: window.__duel.world.spawns.player.y, hp: window.__duel.p.hp }));
check("the hero arrives at the Foundry's start with full health", Math.abs(pos.px - pos.sx) < 2 && Math.abs(pos.py - pos.sy) < 2 && pos.hp === 100, pos);
await p.waitForTimeout(500); await p.screenshot({ path: "/private/tmp/claude-501/-Users-holyscript-Desktop-projects-jev-fsm-demo/0a66b84a-69b7-40fe-993e-07ff976d9cf7/scratchpad/w_foundry.png" });
await p.close();

// shrines and lore stones
p = await game({ cleared: [], deaths: 0, skills: [], points: 2, tutorialDone: true });
await p.evaluate(() => { const d = window.__duel; const sh = d.world.shrines[0]; d.player.x = sh.x - 10; d.player.y = sh.y + 14; d.p.hp = 40; d.p.heals = 0; d.p.spirit = 0; });
await p.waitForTimeout(400);
const near = await p.evaluate(() => ({ kind: window.__duel.nearby?.kind, prompt: window.__duel.prompt.visible, text: window.__duel.prompt.text }));
check("standing at a shrine shows its prompt", near.kind === "shrine" && near.prompt === true && /Rest/.test(near.text), near);
await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__game.scene.isActive("skills"), null, { timeout: 15000 }).catch(() => {});
const rest = await p.evaluate(() => ({ hp: window.__duel.p.hp, heals: window.__duel.p.heals, spirit: window.__duel.p.spirit, skills: window.__game.scene.isActive("skills") }));
check("resting heals fully, refills the gourd and spirit, and opens the skill screen", rest.hp === 100 && rest.heals === 3 && rest.spirit >= 3 && rest.skills === true, rest);
await p.keyboard.press("Escape"); await p.waitForTimeout(700);
await p.evaluate(() => { const d = window.__duel; const ln = d.world.lore[0]; d.player.x = ln.x + 12; d.player.y = ln.y + 10; });
await p.waitForTimeout(400); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
const lore = await p.evaluate(() => window.__duel.hud.dialog); check("reading a lore slab opens its inscription", lore?.who === "INSCRIPTION" && lore.text.length > 0, lore);
await p.keyboard.press("Enter"); await p.waitForTimeout(500);
const closed = await p.evaluate(() => window.__duel.hud.dialog); check("the press that closes the inscription does not reopen it", closed === null, { closed });
await p.evaluate(() => { const d = window.__duel; d.wake(); const sh = d.world.shrines[0]; d.player.x = sh.x - 10; d.player.y = sh.y + 14; });
await p.waitForTimeout(500); const fight = await p.evaluate(() => ({ n: window.__duel.nearby, active: window.__duel.bossActive() }));
check("no shrine or lore prompt while a boss fight is on", fight.n === null && fight.active === true, fight);
await p.close();
p = await game({ cleared: [], deaths: 0, skills: [], points: 2, tutorialDone: false });
await p.evaluate(() => { const d = window.__duel; const sh = d.world.shrines[0]; d.player.x = sh.x - 10; d.player.y = sh.y + 14; });
await p.waitForTimeout(400); const tut = await p.evaluate(() => ({ n: window.__duel.nearby, on: window.__duel.tutorialOn }));
check("no shrine prompt during the tutorial", tut.on === true && tut.n === null, tut);
await p.close();
console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
