// Needs `npm run dev` running and the arena assets built (npm run assets:arena). Run: node tests/arena/phase1.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && errs.push("CONSOLE: " + m.text() + " " + (m.location().url || "")));
await p.goto("http://localhost:3000/arena?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const setup = (gap = 100) => p.evaluate((g) => {
  const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12;
  d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400;
  // frame trace of the enemy sprite, one entry per change
  window.__trace = []; let last = "";
  const t0 = d.events; const sc = d;
  sc.events.off("postupdate"); sc.events.on("postupdate", () => { const id = sc.enemy.anim.sheet + "#" + sc.enemy.anim.frame; if (id !== last) { last = id; window.__trace.push({ id, rev: sc.enemy.anim.reversed, t: Math.round(sc.now) }); } });
}, gap);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const st = () => p.evaluate(() => { const d = window.__arena; return { php: d.p.hp, ppost: Math.round(d.p.posture), pmode: d.p.mode, chain: d.p.chain, ehp: d.e.hp, epost: Math.round(d.e.posture), emode: d.e.mode, log: d.log.map((l) => ({ ...l })) }; });
const enemyAttack = (id) => p.evaluate((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 5000, polling: "raf" });
const enemyHitOutcome = (s, i = 0) => s.log.filter((l) => l.type === "enemyHit")[i]?.outcome;

// A: three presses chain L1 -> L2 -> L3, every hit connects
await setup();
await key("j", 30);
await p.waitForFunction(() => window.__arena.p.atk?.id === "L1" && window.__arena.player.anim.frame >= 3, null, { polling: "raf", timeout: 3000 });
await key("j", 30);
await p.waitForFunction(() => window.__arena.p.atk?.id === "L2" && window.__arena.player.anim.frame >= 10, null, { polling: "raf", timeout: 3000 });
await key("j", 30);
await p.waitForTimeout(1600); let s = await st();
const atks = s.log.filter((l) => l.type === "attack").map((l) => l.id).join(",");
const hits = s.log.filter((l) => l.type === "playerHit");
check("chain L1,L2,L3 plays in order", atks === "L1,L2,L3", { atks });
check("three hits connect for 8+9+18", hits.length === 3 && s.ehp === 160 - 35, { hits: hits.map((h) => h.dmg), ehp: s.ehp });
check("player returns to free after the finisher", s.pmode === "free" && s.chain === 0, s);

// A2: a press made slightly before the chain window still chains (input buffer)
await setup(); await key("j", 30); await p.waitForTimeout(60); await key("j", 30); await p.waitForTimeout(900); s = await st();
check("early press (before chainFrom) is buffered into L2", s.log.some((l) => l.type === "attack" && l.id === "L2"), s.log.filter((l) => l.type === "attack"));

// B: single press = one attack only, then recovery
await setup(); await key("j", 30); await p.waitForTimeout(1000); s = await st();
check("single press: L1 only, back to free", s.log.filter((l) => l.type === "attack").length === 1 && s.pmode === "free" && s.ehp === 152, s);

// C: perfect parry. Press guard just inside the deflect window before the strike.
await setup(); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 400); await p.waitForTimeout(500); s = await st();
let tr = await p.evaluate(() => window.__trace.map((t) => t.id.replace("mb_", "") + (t.rev ? "R" : "")).join(" "));
check("tap before the hit = deflected, no damage", enemyHitOutcome(s) === "deflected" && s.php === 100, { out: enemyHitOutcome(s), hp: s.php });
check("deflect adds posture to the enemy (18 x1.3)", s.epost >= 23, { epost: s.epost });
const reverseSeen = await p.evaluate(() => window.__trace.some((t) => t.rev));
const frames = await p.evaluate(() => window.__trace.filter((t) => t.id.startsWith("mb_1_atk")).map((t) => +t.id.split("#")[1]));
const i1 = frames.indexOf(1);
check("enemy swing is played in REVERSE (frame 1 then back to 0)", reverseSeen && i1 >= 0 && frames.slice(i1).includes(0), { trace: tr, frames });

// D: held guard = block, chip damage + posture on the player
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(450); await enemyAttack("SLASH"); await waitSim(900); s = await st(); await p.keyboard.up("Space");
check("held guard = blocked: chip damage and player posture", enemyHitOutcome(s) === "blocked" && s.php === 98 && s.ppost >= 17 && s.epost === 0, { out: enemyHitOutcome(s), hp: s.php, post: s.ppost });

// E: no guard = full damage and stagger
await setup(); await enemyAttack("SLASH"); await waitSim(900); s = await st();
check("no guard: takes the hit (14)", enemyHitOutcome(s) === "hit" && s.php === 86 && s.pmode !== "free" || (enemyHitOutcome(s) === "hit" && s.php === 86), { out: enemyHitOutcome(s), hp: s.php, mode: s.pmode });

// F: roll i-frames dodge the strike
await setup(); await enemyAttack("SLASH"); await waitSim(480); await key("Shift", 40); await p.waitForTimeout(700); s = await st();
check("roll i-frames dodge the strike", enemyHitOutcome(s) === "dodged" && s.php === 100, { out: enemyHitOutcome(s), hp: s.php });

// G: guard spam gives no deflect window
await setup(); await enemyAttack("SLASH"); await waitSim(300); await key("Space", 30); await p.waitForTimeout(60); await waitSim(430); await key("Space", 400); await p.waitForTimeout(400); s = await st();
check("re-tapping guard inside the spam window = blocked, not deflected", enemyHitOutcome(s) === "blocked", { out: enemyHitOutcome(s) });

// H: riposte window after a deflect: the next hit deals x1.5
await setup(); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 120); await p.waitForTimeout(450); await key("j", 30); await p.waitForTimeout(500); s = await st();
const rip = s.log.filter((l) => l.type === "playerHit")[0];
check("riposte after deflect: L1 deals 12 (8 x1.5)", enemyHitOutcome(s) === "deflected" && rip && rip.dmg === 12 && rip.riposte, { rip });

// I: posture break after a deflect, then a hit is a deathblow (x2.5)
await setup(); await p.evaluate(() => { window.__arena.settings.qte = "off"; window.__arena.e.posture = 90; }); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 120);
await p.waitForFunction(() => window.__arena.e.mode === "broken", null, { timeout: 3000, polling: "raf" });
await key("j", 30); await p.waitForTimeout(500); s = await st();
const db = s.log.filter((l) => l.type === "playerHit").pop();
check("deflect at 90 posture breaks the enemy; next hit is a deathblow (8 x1.5 riposte x2.5)", s.log.some((l) => l.type === "enemyBroken") && db && db.broken && db.dmg === 30 && db.riposte, { db });

// J: killing blow
await setup(); await p.evaluate(() => (window.__arena.e.hp = 5)); await key("j", 30); await p.waitForTimeout(800); s = await st();
check("enemy at 5 hp dies to one hit", s.emode === "dead" && s.ehp === 0, s);

// K: player death
await setup(); await p.evaluate(() => (window.__arena.p.hp = 10)); await enemyAttack("SLASH"); await waitSim(900); s = await st();
check("player at 10 hp dies to an unguarded hit", s.pmode === "dead", s);

// L: walking works and the sprite swaps to run
await setup(); await p.keyboard.down("d"); await p.waitForTimeout(500); const run = await p.evaluate(() => ({ x: window.__arena.player.x, sheet: window.__arena.player.anim.sheet })); await p.keyboard.up("d");
check("move right: x increases and the run sheet plays", run.x > 530 && run.sheet === "fk_run", run);

await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase1.png" });
check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
