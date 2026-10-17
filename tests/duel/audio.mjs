// Renders every sound cue offline and prints peak / loudness / brightness, so levels can be balanced without listening. Needs `npm run dev`.
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const errs = []; p.on("pageerror", e => errs.push("PAGEERR: " + e.message));
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const rows = await p.evaluate(async () => {
  const d = window.__duel, sfx = d.sfx; const out = [];
  const cues = { swingLight: () => sfx.swing(false), swingHeavy: () => sfx.swing(true), bossSwing: () => sfx.swing(true, true), hitLight: () => sfx.hit(false), hitHeavy: () => sfx.hit(true), deflect: () => sfx.deflect(), block: () => sfx.block(1),
    guardBreak: () => sfx.guardBreak(), postureBreak: () => sfx.postureBreak(), deathblow: () => sfx.deathblow(), hurt: () => sfx.hurt(), roll: () => sfx.roll(), heal: () => sfx.heal(), slip: () => sfx.slip(),
    stoneHit: () => sfx.stoneHit(), throwFist: () => sfx.throwFist(), buff: () => sfx.buff(), beamFire: () => sfx.beamFire(),
    "WARN thrust": () => sfx.warn("thrust"), "WARN sweep": () => sfx.warn("sweep"), "WARN grab": () => sfx.warn("grab"), "WARN beam": () => sfx.warn("beam") };
  const sampleOk = ["clash1", "clash10", "blade1", "blade10"].map(k => { const a = d.cache.audio.get(k); return k + ":" + (a && a.getChannelData ? a.duration.toFixed(2) + "s" : "MISSING"); });
  for (const [name, fn] of Object.entries(cues)) {
    const off = new OfflineAudioContext(1, 44100 * 2, 44100);
    Object.defineProperty(sfx, "ctx", { get: () => off, configurable: true }); sfx.bus = undefined; sfx.noiseBuf = undefined;
    fn(); const buf = await off.startRendering(); const x = buf.getChannelData(0);
    let pk = 0, sq = 0, last = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; sq += x[i] * x[i]; if (a > 0.01) last = i; }
    // spectral centroid over the loudest 250ms window
    const w = 11025; let best = 0, bi = 0; for (let i = 0; i + w < x.length; i += 2205) { let e = 0; for (let j = 0; j < w; j += 8) e += x[i + j] * x[i + j]; if (e > best) { best = e; bi = i; } }
    const N = 2048; let num = 0, den = 0; for (let k = 1; k < 512; k++) { let re = 0, im = 0; for (let n = 0; n < N; n += 2) { const v = x[bi + n] * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / N)); re += v * Math.cos(2 * Math.PI * k * n / N); im -= v * Math.sin(2 * Math.PI * k * n / N); } const m = Math.hypot(re, im); num += m * k * 44100 / N; den += m; }
    out.push({ name, peak: pk, rmsDb: 20 * Math.log10(Math.sqrt(sq / Math.max(1, last)) + 1e-9), lenMs: Math.round(last / 44.1), cen: Math.round(num / Math.max(den, 1e-9)) });
    delete sfx.ctx;
  }
  return { out, sampleOk };
});
console.log("samples:", rows.sampleOk.join("  "));
console.log("cue".padEnd(14), "peak".padStart(6), "rms dB".padStart(7), "len ms".padStart(7), "centroid Hz".padStart(12));
for (const r of rows.out) console.log(r.name.padEnd(14), r.peak.toFixed(2).padStart(6), r.rmsDb.toFixed(1).padStart(7), String(r.lenMs).padStart(7), String(r.cen).padStart(12), r.peak > 0.98 ? " <-- clipping" : "");
console.log(errs.join("\n") || "no page errors"); await b.close();
