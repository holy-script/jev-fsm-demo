// Balance levers, perks and the shrine, the guided demo, menu navigation, the bot hook. Needs `npm run dev`. Jev is mocked.
// Run: node tests/arena/phase6.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  window.__pad = { id: "fake pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(window.__pad, "timestamp", { get: () => performance.now() });
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", async (route) => {
  const q = JSON.parse(route.request().postData()).questions, answers = {};
  const pick = (n) => { const o = Object.keys(q[n].criteria), c = o.includes("WAIT") ? "WAIT" : o[0]; return { type: "choice", choice: c, confidence: 0.9, probabilities: Object.fromEntries(o.map((k) => [k, k === c ? 0.7 : 0.3 / Math.max(1, o.length - 1)])) }; };
  if (q.next_action) answers.next_action = pick("next_action");
  if (q.gate_choice) answers.gate_choice = pick("gate_choice");
  for (const n of ["turtling", "roll_reliant", "trade_hungry", "panicking"]) if (q[n]) answers[n] = { type: "noul", noul: 0.3 };
  if (q.taunt) answers.taunt = { type: "choice", choice: "NONE", confidence: 1, probabilities: { NONE: 1 } };
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const scr = () => p.getAttribute("[data-screen]", "data-screen");
const waitScreen = (s, t = 8000) => p.waitForFunction((x) => document.querySelector("[data-screen]")?.getAttribute("data-screen") === x, s, { timeout: t });
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), k);
const sc = (fn, arg) => p.evaluate(fn, arg);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const boot = async (url, clear = true) => {
  await p.goto("http://localhost:3000" + url, { waitUntil: "load" });
  if (clear) { await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "load" }); }
  await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
  await p.waitForTimeout(600);
};
const setup = (boss = "mb", gap = 100, perks = []) => sc(({ id, g, pk }) => {
  const d = window.__arena; d.demo = false; d.settings.assist = false;
  d.run = pk === null ? null : { slot: 9, bossIndex: 0, cleared: [], deaths: 0, playMs: 0, finished: false, perks: pk, updated: 0 };
  if (d.boss.id !== id) d.loadBoss(id); else d.reset();
  d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400;
}, { id: boss, g: gap, pk: perks });
const enemyAttack = (id) => sc((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 8000, polling: "raf" });
const waitStrike = (lead) => p.waitForFunction((l) => window.__arena.e.strikeAt - window.__arena.now <= l, lead, { timeout: 8000, polling: "raf" });
const log = () => sc(() => window.__arena.log.map((l) => ({ ...l })));
const outcome = (L, i = 0) => L.filter((l) => l.type === "enemyHit")[i]?.outcome;

await boot("/arena?dev=1&nocard=1&qte=on");

// ---------------------------------------------------------------- balance levers
await setup("mb"); await enemyAttack("SLASH"); await waitStrike(255); await key("Space", 400); await p.waitForTimeout(300);
check("without assist a guard tap 200+ ms early is only a block", outcome(await log()) === "blocked", outcome(await log()));
await setup("mb"); await sc(() => { window.__arena.settings.assist = true; }); await enemyAttack("SLASH"); await waitStrike(225); await key("Space", 400); await p.waitForTimeout(300);
check("combat assist widens the deflect window (the same early tap deflects)", outcome(await log()) === "deflected", outcome(await log()));
await setup("mb"); await sc(() => { window.__arena.settings.assist = true; }); await enemyAttack("SLASH"); await waitSim(900);
check("combat assist softens boss damage (14 -> 10)", (await sc(() => window.__arena.p.hp)) === 90, await sc(() => window.__arena.p.hp));
await setup("wh", 100); await enemyAttack("FLICK"); await waitSim(900);
check("per-boss damage multiplier: Hashashin FLICK 9 x1.4 = 13", (await sc(() => window.__arena.p.hp)) === 87, await sc(() => window.__arena.p.hp));
await setup("cm", 100); await enemyAttack("SWING"); await waitSim(1500);
check("Mauler SWING 20 x0.62 = 12", (await sc(() => window.__arena.p.hp)) === 88, await sc(() => window.__arena.p.hp));
await setup("cm", 100); await key("j", 30); await p.waitForTimeout(400);
const post = await sc(() => window.__arena.e.posture);
check("Mauler takes 30% of a hit's posture (L1 14 -> 4)", Math.round(post) === 4, post);
await setup("cm", 100); await sc(() => { const d = window.__arena; d.qteKeys = ["J", "K", "L"]; d.e.posture = 100; d.breakEnemy(); }); await key("j", 30);
await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 });
for (const k of ["j", "k", "l"]) { await p.waitForFunction(() => { const q = window.__arena.qte; return q && q.current && q.t >= q.current.windowMs - 25; }, null, { polling: "raf", timeout: 4000 }); await key(k, 30); }
await p.waitForTimeout(500);
const db = (await log()).find((l) => l.type === "deathblow");
check("an EXECUTE removes 20% of the boss's max HP (160 of 800 on the Mauler)", db && db.grade === "execute" && db.dmg === 160, db);

// ---------------------------------------------------------------- perks
await setup("mb", 100, ["keen"]); await enemyAttack("SLASH"); await waitStrike(190); await key("Space", 400); await p.waitForTimeout(300);
check("Keen Eye: a deflect tap up to 200 ms early works", outcome(await log()) === "deflected", outcome(await log()));
await setup("mb", 100, ["ember"]);
check("Warm Ember: a fight starts with 2 spirit", (await sc(() => window.__arena.p.spirit)) === 2, await sc(() => window.__arena.p.spirit));
await setup("mb", 100, ["kindled"]); await sc(() => { window.__arena.p.spirit = 1; }); await key("e", 30); await p.waitForTimeout(300);
check("Kindled Blade: Flame Burst works at 1 spirit", (await log()).some((l) => l.type === "skill"), "");
await setup("mb", 175, []); await key("j", 30); await p.waitForTimeout(500);
const miss = (await log()).filter((l) => l.type === "playerHit").length;
await setup("mb", 175, ["reach"]); await key("j", 30); await p.waitForTimeout(500);
check("Long Reach: a swing that whiffs at 175 px (after its 26 px lunge) connects with the perk", miss === 0 && (await log()).filter((l) => l.type === "playerHit").length === 1, { miss });
await setup("mb", 100, ["wrist"]); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 400); await p.waitForTimeout(300);
const wp = await sc(() => window.__arena.e.posture);
check("Iron Wrist: a deflect adds 30% more posture (18 x1.3 x1.3 = 30)", wp >= 29 && wp <= 31, wp);
const rate = async (perks) => { await setup("mb", 100, perks); await sc(() => { const d = window.__arena; d.p.posture = 60; d.p.lastHitAt = -1e9; }); await p.waitForTimeout(1000); return 60 - (await sc(() => window.__arena.p.posture)); };
const r0 = await rate([]), r1 = await rate(["breath"]);
check("Steady Breath: posture recovers faster", r1 > r0 + 5, { r0: Math.round(r0), r1: Math.round(r1) });
await setup("mb", 100, ["keen", "ember", "breath"]);
await sc(() => window.__arena.choosePerk("reach")); await sc(() => window.__arena.choosePerk("keen"));
check("a run keeps at most 3 perks and no duplicates", (await sc(() => window.__arena.run.perks)).join() === "keen,ember,breath", await sc(() => window.__arena.run.perks));

// ---------------------------------------------------------------- bot hook
await setup("mb", 100, null); await sc(() => { const d = window.__arena; let n = 0; d.botFrame = () => ({ attack: n++ === 3 }); }); await p.waitForTimeout(500); await sc(() => { window.__arena.botFrame = null; });
check("scene.botFrame injects input (a scripted attack is performed)", (await log()).some((l) => l.type === "attack"), "");

// ---------------------------------------------------------------- shrine through the real UI
await boot("/arena?nocard=1");
await p.getByTestId("new-game").click(); await p.getByTestId("slot-1").getByRole("button", { name: "New" }).click(); await waitScreen("playing");
const killBoss = async () => { await sc(() => { const d = window.__arena; d.e.auto = false; d.e.hp = 0; d.killEnemy(); }); await waitScreen("victory", 6000); };
await killBoss(); await p.getByTestId("next").click(); await waitScreen("shrine");
const offered = await p.locator('[data-testid^="perk-"]').count();
check("after the first boss the shrine offers three gifts", offered === 3, offered);
const first = (await p.locator('[data-testid^="perk-"]').first().getAttribute("data-testid")).replace("perk-", "");
await p.locator('[data-testid^="perk-"]').first().click(); await waitScreen("playing");
const sv = await ls("arena.save.1");
check("choosing a gift saves it to the run and loads the Mauler", sv.perks.join() === first && (await sc(() => window.__arena.boss.id)) === "cm", sv.perks);
await killBoss(); await p.getByTestId("next").click(); await waitScreen("shrine");
const second = await p.locator('[data-testid^="perk-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("perk-", "")));
check("the second shrine never re-offers a gift you hold", !second.includes(first) && second.length === 3, { first, second });
await p.locator('[data-testid^="perk-"]').nth(1).click(); await waitScreen("playing");
await killBoss(); await p.getByTestId("next").click(); await waitScreen("shrine");
await p.locator('[data-testid^="perk-"]').nth(2).click(); await waitScreen("playing");
check("three gifts after three bosses; the fourth fight is Echo", (await ls("arena.save.1")).perks.length === 3 && (await sc(() => window.__arena.boss.id)) === "echo", (await ls("arena.save.1")).perks);
await p.keyboard.press("Escape"); await waitScreen("paused");
check("the pause menu lists your gifts", (await p.getByTestId("perks").innerText()).startsWith("Gifts:"), await p.getByTestId("perks").innerText());
await p.getByTestId("resume").click(); await waitScreen("playing");
await sc(() => { const d = window.__arena; d.e.auto = false; d.e.hp = 0; d.killEnemy(); }); await waitScreen("ending", 6000);
check("beating Echo goes straight to the ending (no shrine)", (await scr()) === "ending", await scr());

// ---------------------------------------------------------------- settings toggle for assist
await p.getByTestId("quit").click(); await waitScreen("title");
await p.getByRole("button", { name: /Settings/ }).click(); await waitScreen("settings");
await p.getByTestId("assist").click();
check("Combat assist toggle is saved and applied", (await ls("arena.settings")).assist === true && (await sc(() => window.__arena.settings.assist)) === true, "");
await p.getByTestId("assist").click(); await p.getByRole("button", { name: "Back", exact: true }).click(); await waitScreen("title");

// ---------------------------------------------------------------- guided demo
await p.getByTestId("demo").click(); await waitScreen("briefing");
const br = await sc(() => ({ paused: window.__game.scene.isPaused("arena"), assist: window.__arena.assist, demo: window.__arena.demo, boss: window.__arena.boss.id }));
check("guided demo opens a briefing for boss 1 with the scene paused and assist forced on", br.paused && br.assist && br.demo && br.boss === "mb", br);
const txt = await p.getByTestId("briefing").locator("xpath=..").innerText();
check("the briefing tells the audience what to watch (parry, Jev panel, F swap)", /Tap guard/.test(txt) && /Jev panel/.test(txt) && /F to swap/.test(txt), txt.slice(0, 80));
await p.getByTestId("begin").click(); await waitScreen("playing");
check("Begin resumes the fight", !(await sc(() => window.__game.scene.isPaused("arena"))), "");
await sc(() => { const d = window.__arena; d.e.auto = false; d.e.hp = 0; d.killEnemy(); }); await waitScreen("victory", 6000);
const fl = await p.getByTestId("fightline").innerText();
await p.getByTestId("next").click(); await waitScreen("shrine"); await p.locator('[data-testid^="perk-"]').first().click(); await waitScreen("briefing");
check("in the demo, after the shrine comes the Mauler's briefing (paused)", (await sc(() => window.__arena.boss.id)) === "cm" && (await sc(() => window.__game.scene.isPaused("arena"))), fl.replace(/\n/g, " "));
await p.getByTestId("begin").click(); await waitScreen("playing");
await p.keyboard.press("Escape"); await waitScreen("paused"); await p.getByTestId("quit").click(); await waitScreen("title");
check("quitting leaves demo mode (assist off again)", !(await sc(() => window.__arena.demo)) && !(await sc(() => window.__arena.assist)), "");

// ---------------------------------------------------------------- menu navigation
await p.keyboard.press("ArrowDown"); await p.waitForTimeout(100);
const f1 = await p.evaluate(() => document.activeElement?.textContent);
await p.keyboard.press("ArrowDown"); await p.waitForTimeout(100);
const f2 = await p.evaluate(() => document.activeElement?.textContent);
check("arrow keys move focus through the menu buttons", f1 !== f2 && !!f1 && !!f2, { f1, f2 });
await p.evaluate(() => { [...document.querySelectorAll(".ar-parch button")].find((b) => /settings/i.test(b.textContent))?.focus(); });
await p.keyboard.press("Enter"); await waitScreen("settings");
check("Enter activates the focused button", (await scr()) === "settings", await scr());
await p.keyboard.press("Escape"); await waitScreen("title");
const padBtn = (i, v) => sc(({ i, v }) => { window.__pad.buttons[i] = { pressed: v, touched: v, value: v ? 1 : 0 }; }, { i, v });
await p.waitForTimeout(150);
const g0 = await p.evaluate(() => document.activeElement?.textContent);
await padBtn(13, true); await p.waitForTimeout(100); await padBtn(13, false); await p.waitForTimeout(100);
const g1 = await p.evaluate(() => document.activeElement?.textContent);
check("gamepad d-pad down moves the menu focus", g0 !== g1, { g0, g1 });
await p.evaluate(() => { [...document.querySelectorAll(".ar-parch button")].find((b) => /credits/i.test(b.textContent))?.focus(); });
await padBtn(0, true); await p.waitForTimeout(100); await padBtn(0, false);
await waitScreen("credits");
check("gamepad A presses the focused button", (await scr()) === "credits", await scr());
await padBtn(1, true); await p.waitForTimeout(100); await padBtn(1, false);
await waitScreen("title");
check("gamepad B goes back", (await scr()) === "title", await scr());

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase6.png" });
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
