// Needs `npm run dev` running and the duel assets built. Checks the grunt encounters: rules brain (no Jev calls), the red stab,
// no shrine or skill points for grunts, and the progression Bone Soldier -> Spear Bearer -> Captain. Run: node tests/duel/grunts.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = []; const results = [];
const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
let jevCalls = 0; await p.route("**/api/jev/ask", (r) => { jevCalls++; r.abort(); });
await p.addInitScript(() => { localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })); localStorage.setItem("duel.save", JSON.stringify({ cleared: [], deaths: 0, skills: [], points: 2, tutorialDone: true })); });
await p.goto("http://localhost:3000/duel", { waitUntil: "load" }); await p.waitForTimeout(4500);
await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 20000 }); await p.waitForTimeout(800);
const st = () => p.evaluate(() => { const d = window.__duel; return { def: d.def.id, awake: d.b.awake, mode: d.b.mode, move: d.b.move?.id, hp: d.b.hp, glyph: d.b.glyph?.type, php: Math.round(d.p.hp), pts: JSON.parse(localStorage.getItem("duel.save")).points, cleared: JSON.parse(localStorage.getItem("duel.save")).cleared, shrine: window.__game.scene.isActive("skills") }; });
let s = await st();
check("Continue starts at the first grunt, asleep in the arena", s.def === "bone-soldier" && s.awake === false, s);
await p.evaluate(() => { const d = window.__duel; d.player.x = d.world.spawns.boss.x - 90; d.player.y = d.world.spawns.boss.y + 30; });
await p.waitForFunction(() => window.__duel.b.awake, null, { timeout: 10000 }).then(() => 0, () => 0);
check("walking into the arena wakes it and seals the gate", (await st()).awake === true && (await p.evaluate(() => window.__duel.world.gateOpen)) === false, await st());
const moved = await p.waitForFunction(() => window.__duel.b.mode === "attack", null, { timeout: 20000 }).then(() => true, () => false);
check("the Bone Soldier fights on its own (rules brain)", moved, await st());
check("grunts never call Jev", jevCalls === 0, { jevCalls });
const label = await p.evaluate(() => window.__duel.hud.brainActual); check("the HUD says the brain is RULES for grunts", label === "RULES", { label });

// kill it with a deathblow-less quick finish: drop its hp and hit
await p.evaluate(() => { const d = window.__duel; d.p.invulnUntil = 1e12; d.b.hp = 3; d.boss.x = d.player.x + 40; d.boss.y = d.player.y; d.b.mode = "idle"; d.b.held = false; d.b.move = null; d.b.nextThink = 1e12; d.b.auto = false; });
await p.keyboard.down("j"); await p.waitForTimeout(40); await p.keyboard.up("j");
await p.waitForFunction(() => window.__duel.b.mode === "dead", null, { timeout: 8000 }).then(() => 0, () => 0);
s = await st(); check("a defeated grunt is saved, awards no skill point, opens no shrine", s.mode === "dead" && s.cleared.includes("bone-soldier") && s.pts === 2 && s.shrine === false, s);
const next = await p.waitForFunction(() => window.__duel.def.id === "spear-bearer" && window.__duel.b.awake, null, { timeout: 40000 }).then(() => true, () => false);
check("the Spear Bearer rises right after, awake", next, await st());

// red stab
await p.evaluate(() => { const d = window.__duel; d.b.auto = false; d.b.mode = "idle"; d.b.nextThink = 1e12; d.player.x = d.boss.x - 100; d.player.y = d.boss.y; d.p.invulnUntil = 1e12; d.forceMove("STAB"); });
await p.waitForTimeout(250); s = await st(); check("the Spear Bearer's stab telegraphs as a perilous thrust (red glyph)", s.glyph === "thrust", s);
await p.waitForTimeout(2000);
await p.evaluate(() => { const d = window.__duel; d.b.hp = 3; d.boss.x = d.player.x + 40; d.boss.y = d.player.y; d.b.mode = "idle"; d.b.held = false; d.b.move = null; d.b.nextThink = 1e12; });
await p.keyboard.down("j"); await p.waitForTimeout(40); await p.keyboard.up("j");
const cap = await p.waitForFunction(() => window.__duel.def.id === "captain" && window.__duel.b.awake, null, { timeout: 40000 }).then(() => true, () => false);
s = await st(); check("then the Captain, still with no shrine and no points awarded for the grunts", cap && s.pts === 2 && s.shrine === false, s);
console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
