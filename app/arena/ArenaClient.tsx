"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Decision } from "@/game/v4/brain";
import type { ArenaApi, FightResult } from "@/game/v4/createArenaGame";
import { ACTIONS, ACTION_LABEL, DEFAULT_KEYMAP, codeToKey, keyLabel, type Action, type Keymap } from "@/game/v4/keymap";
import { listSaves, deleteSave, SLOTS, type RunSave } from "@/game/v4/save";
import { loadSettings, saveSettings, type ArenaSettings } from "@/game/v4/settings";
import { aggregate, loadStats, type BrainSummary, type FightRecord } from "@/game/v4/stats";
import { BOSSES, ENCOUNTERS } from "@/game/v4/bosses";
import { MAX_PERKS, PERKS, offer } from "@/game/v4/perks";

type Screen = "briefing" | "shrine" | "playing" | "title" | "slots" | "settings" | "stats" | "credits" | "paused" | "victory" | "defeat" | "ending";
type Entry = Decision & { id: number };

const UI = "/arena-assets/env/ui";

/** What the guided demo tells the audience before each boss. */
const DEMO_NOTES: Record<string, { watch: string[] }> = {
  mb: { watch: ["Tap guard (Space) just before a dagger lands: a perfect parry rewinds the boss's own swing.", "Open the Jev panel with Tab: every boss decision comes from Jev in about a third of a second, while the boss is still recovering.", "Press F to swap Jev for the old rules bot, then compare them on the stats screen."] },
  cm: { watch: ["The Mauler telegraphs everything and Jev knows it: watch for DELAY on its slam, a pause that beats players who roll early.", "Two red rings (!!) mean an unblockable move. Press attack just before it lands to counter, or roll through it."] },
  wh: { watch: ["After the first slash Jev picks how the combo continues. FEINT rewinds the swing to bait a reaction.", "When the boss is staggered, attack: the deathblow asks for three timed key presses."] },
  echo: { watch: ["Echo uses your own moves. Jev has been watching how you roll, how early you parry and whether you turtle, across every boss.", "Break its posture with parries, then finish it with the deathblow."] },
};
const SOURCE_COLOR: Record<string, string> = { jev: "#58a6ff", rules: "#9aa0a6", fallback: "#d29922" };

const CSS = `
.ar-root { font-family: ui-monospace, Menlo, Consolas, monospace; color: #2f2012; image-rendering: pixelated; }
.ar-parch { border-style: solid; border-width: 16px; border-image: url(${UI}/01.png) 16 fill / 16px stretch; image-rendering: pixelated; background: none; padding: 6px 16px; }
.ar-dark { border-style: solid; border-width: 12px; border-image: url(${UI}/30.png) 12 fill / 12px stretch; image-rendering: pixelated; color: #e8dcc0; padding: 4px 10px; }
.ar-btn { display: block; width: 100%; margin: 6px 0; padding: 9px 12px; font: inherit; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2f2012; background: #d9cca4; border: 3px solid #6d5535; border-bottom-width: 5px; cursor: pointer; text-align: left; }
.ar-btn:hover { background: #f1e5bd; transform: translateY(-1px); }
.ar-btn:disabled { opacity: 0.45; cursor: default; transform: none; }
.ar-btn.small { display: inline-block; width: auto; padding: 4px 10px; margin: 2px; font-size: 12px; }
.ar-btn.on { background: #b9d3a0; border-color: #4a6a35; }
.ar-h1 { font-size: 46px; letter-spacing: 10px; margin: 0; text-shadow: 2px 2px 0 #e9dcc0, 4px 4px 0 #8b7550; }
.ar-h2 { font-size: 20px; letter-spacing: 3px; margin: 4px 0 10px; text-transform: uppercase; }
.ar-sub { font-style: italic; opacity: 0.8; margin-bottom: 14px; }
.ar-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.ar-row > label { flex: 1; }
.ar-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ar-table td, .ar-table th { padding: 3px 6px; text-align: right; border-bottom: 1px solid rgba(60,40,20,0.25); }
.ar-table td:first-child, .ar-table th:first-child { text-align: left; }
.ar-bar { height: 8px; background: rgba(0,0,0,0.35); flex: 1; }
.ar-bar > i { display: block; height: 8px; }
`;

function Bar({ label, value, color = "#58a6ff" }: { label: string; value: number; color?: string }) {
  return (
    <div className="ar-row" style={{ margin: "2px 0", fontSize: 11 }}>
      <span style={{ width: 84, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div className="ar-bar"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color }} /></div>
      <span style={{ width: 32, textAlign: "right" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, "0")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Compare({ list }: { list: FightRecord[] }) {
  const a = aggregate(list);
  const rows: [string, (s: BrainSummary) => string][] = [
    ["Fights", (s) => String(s.fights)],
    ["Boss wins (you lost)", (s) => (s.fights ? pct(s.bossWinRate) : "-")],
    ["Avg fight length", (s) => (s.fights ? `${s.avgSeconds.toFixed(0)} s` : "-")],
    ["Avg HP you lost", (s) => (s.fights ? s.avgHpLost.toFixed(0) : "-")],
    ["Attacks you parried", (s) => (s.fights ? pct(s.parryRate) : "-")],
    ["Attacks that landed", (s) => (s.fights ? pct(s.hitRate) : "-")],
    ["Jev answer time", (s) => (s.avgJevMs ? `${Math.round(s.avgJevMs)} ms` : "-")],
  ];
  return (
    <table className="ar-table" data-testid="compare">
      <thead><tr><th /><th>Jev</th><th>Rules bot</th></tr></thead>
      <tbody>{rows.map(([l, f]) => <tr key={l}><td>{l}</td><td>{f(a.jev)}</td><td>{f(a.rules)}</td></tr>)}</tbody>
    </table>
  );
}

export default function ArenaClient() {
  const parent = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ArenaApi | null>(null);
  const screenRef = useRef<Screen>("title");
  const [dev, setDev] = useState(false);
  const [screen, setScreenState] = useState<Screen>("title");
  const [from, setFrom] = useState<Screen>("title");
  const [missing, setMissing] = useState(false);
  const [settings, setSettings] = useState<ArenaSettings | null>(null);
  const [saves, setSaves] = useState<(RunSave | null)[]>([null, null, null]);
  const [stats, setStats] = useState<FightRecord[]>([]);
  const [result, setResult] = useState<FightResult | null>(null);
  const [panel, setPanel] = useState(false);
  const [demo, setDemoState] = useState(false);
  const demoRef = useRef(false);
  const [perks, setPerks] = useState<string[]>([]);
  const [boss, setBoss] = useState("");
  const [brain, setBrain] = useState<"jev" | "rules">("jev");
  const [decisions, setDecisions] = useState<Entry[]>([]);
  const [listening, setListening] = useState<{ action: Action; slot: number } | null>(null);

  const setScreen = useCallback((s: Screen) => {
    screenRef.current = s;
    setScreenState(s);
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);
  const refresh = useCallback(() => {
    setSaves(listSaves());
    setStats(loadStats());
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    const isDev = new URLSearchParams(window.location.search).has("dev");
    setDev(isDev);
    refresh();
    if (isDev) setScreen("playing");
    let destroy: (() => void) | undefined;
    let cancelled = false;
    let id = 0;
    import("@/game/v4/createArenaGame").then(({ createArenaGame }) => {
      if (cancelled || !parent.current) return;
      const g = createArenaGame(parent.current, {
        onMissingAssets: () => setMissing(true),
        onBoss: (n) => { setBoss(n); setDecisions([]); },
        onDecision: (d) => setDecisions((l) => [{ ...d, id: id++ }, ...l].slice(0, 40)),
        onBrain: (m) => setBrain(m),
        onPause: () => { if (screenRef.current === "playing") { apiRef.current?.pause(); setScreen("paused"); } },
        onFight: (r) => {
          refresh();
          setResult(r);
          setScreen(r.won ? (r.final ? "ending" : "victory") : "defeat");
        },
      });
      apiRef.current = g.api;
      destroy = g.destroy;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setPanel((v) => !v);
      } else if (e.key === "Escape") {
        const s = screenRef.current;
        if (s === "playing") { apiRef.current?.pause(); setScreen("paused"); }
        else if (s === "paused") { apiRef.current?.resume(); setScreen("playing"); }
        else if (s === "settings" || s === "stats" || s === "credits" || s === "slots") setScreen(s === "settings" && from === "paused" ? "paused" : "title");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // key capture for rebinding
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return setListening(null);
      const k = codeToKey(e.code);
      if (!k) return;
      setSettings((s) => {
        if (!s) return s;
        const km: Keymap = { ...s.keymap, [listening.action]: [...s.keymap[listening.action]] };
        // a key can drive only one action: take it away from any other
        for (const a of ACTIONS) if (a !== listening.action) km[a] = km[a].filter((n) => n !== k);
        for (const a of ACTIONS) if (!km[a].length) km[a] = [DEFAULT_KEYMAP[a].find((n) => n !== k) ?? DEFAULT_KEYMAP[a][0]];
        km[listening.action][listening.slot] = k;
        km[listening.action] = km[listening.action].filter((n, i, arr) => n && arr.indexOf(n) === i);
        const next = { ...s, keymap: km };
        saveSettings(next);
        apiRef.current?.settingsChanged();
        return next;
      });
      setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  const update = (patch: Partial<ArenaSettings>) => {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      saveSettings(next);
      apiRef.current?.settingsChanged();
      return next;
    });
  };
  const brief = () => { apiRef.current?.pause(); setScreen("briefing"); };
  const start = (slot: number, fresh: boolean, asDemo = false) => {
    demoRef.current = asDemo;
    setDemoState(asDemo);
    apiRef.current?.setDemo(asDemo);
    apiRef.current?.start(slot, fresh);
    setDecisions([]);
    setPerks(apiRef.current?.perks() ?? []);
    if (asDemo) { setPanel(true); brief(); } else setScreen("playing");
  };
  const goNext = () => {
    apiRef.current?.next();
    setDecisions([]);
    if (demoRef.current) brief(); else setScreen("playing");
  };
  /** After a victory: the shrine (a perk) for the first three bosses, then the next fight. */
  const proceed = () => {
    const pk = apiRef.current?.perks() ?? [];
    setPerks(pk);
    if (result && !result.final && pk.length < MAX_PERKS) setScreen("shrine"); else goNext();
  };
  const resume = () => { apiRef.current?.resume(); setScreen("playing"); };
  const toTitle = () => { apiRef.current?.setDemo(false); demoRef.current = false; setDemoState(false); apiRef.current?.toTitle(); refresh(); setScreen("title"); };
  const openFrom = (s: Screen, to: Screen) => { setFrom(s); refresh(); setScreen(to); };

  // keyboard and gamepad navigation for every menu screen
  useEffect(() => {
    if (screen === "playing") return;
    const focusables = () => [...document.querySelectorAll<HTMLElement>(".ar-parch button:not(:disabled), .ar-parch input")];
    const move = (d: number) => { const els = focusables(); if (!els.length) return; const i = els.indexOf(document.activeElement as HTMLElement); els[(i + d + els.length) % els.length].focus(); };
    const t = setTimeout(() => focusables()[0]?.focus(), 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); } };
    window.addEventListener("keydown", onKey);
    let raf = 0;
    let prev: boolean[] = (navigator.getGamepads?.()[0]?.buttons ?? []).map((b) => !!b.pressed);
    const poll = () => {
      const gp = navigator.getGamepads?.()[0];
      if (gp) {
        const down = (i: number) => !!gp.buttons[i]?.pressed;
        const edge = (i: number) => down(i) && !prev[i];
        if (edge(13)) move(1);
        if (edge(12)) move(-1);
        if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
        if (edge(1) || edge(9)) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        prev = gp.buttons.map((b) => !!b.pressed);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); };
  }, [screen]);

  const lastSave = saves.filter((s): s is RunSave => !!s && !s.finished).sort((a, b) => b.updated - a.updated)[0];
  const jev = decisions.filter((d) => d.source === "jev");
  const avg = jev.length ? Math.round(jev.reduce((s, d) => s + d.latencyMs, 0) / jev.length) : 0;
  const last = decisions.find((d) => d.kind === "idle") ?? decisions[0];
  const probs = last?.probabilities ? Object.entries(last.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  const reads = decisions.find((d) => d.reads)?.reads;
  const playing = screen === "playing";

  const center = (children: React.ReactNode, w = 460) => (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,6,4,0.55)" }}>
      <div className="ar-parch" style={{ width: w, maxHeight: "92%", overflowY: "auto" }}>{children}</div>
    </div>
  );

  return (
    <div className="ar-root" style={{ position: "fixed", inset: 0, background: "#05070a" }} data-screen={screen}>
      <style>{CSS}</style>
      <div ref={parent} style={{ position: "absolute", inset: 0 }} />
      {!playing && !missing && <div data-testid="screen" style={{ display: "none" }}>{screen}</div>}

      <div style={{ position: "absolute", top: 8, left: 10, fontSize: 12, display: "flex", gap: 10, opacity: 0.85 }}>
        <Link href="/" style={{ color: "#8fb8e8" }}>← back</Link>
        {playing && <button className="ar-btn small" onClick={() => { apiRef.current?.pause(); setScreen("paused"); }}>Menu [Esc]</button>}
        {playing && <button className="ar-btn small" onClick={() => setPanel((v) => !v)}>Jev [Tab]</button>}
      </div>

      {missing && center(<><h2 className="ar-h2">Assets missing</h2><p>Arena assets not found. See tools/README.md, then run <b>npm run assets:arena</b> and reload.</p></>)}

      {screen === "title" && !missing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", paddingLeft: "7%", background: "linear-gradient(90deg, rgba(8,6,4,0.55), rgba(8,6,4,0.05))" }}>
          <div className="ar-parch" style={{ width: 420, textAlign: "center" }}>
            <h1 className="ar-h1">ARENA</h1>
            <div className="ar-sub">a duel decided by Jev</div>
            <button className="ar-btn" disabled={!lastSave} onClick={() => lastSave && start(lastSave.slot, false)} data-testid="continue">Continue{lastSave ? ` (slot ${lastSave.slot}: ${BOSSES[ENCOUNTERS[Math.min(lastSave.bossIndex, ENCOUNTERS.length - 1)]].name})` : ""}</button>
            <button className="ar-btn" onClick={() => start(1, true, true)} data-testid="demo">Guided demo (about 12 min)</button>
            <button className="ar-btn" onClick={() => openFrom("title", "slots")} data-testid="new-game">New game / load</button>
            <button className="ar-btn" onClick={() => openFrom("title", "settings")}>Settings &amp; controls</button>
            <button className="ar-btn" onClick={() => openFrom("title", "stats")}>Jev vs the rules bot</button>
            <button className="ar-btn" onClick={() => openFrom("title", "credits")}>Credits</button>
          </div>
          <div style={{ marginTop: 14, color: "#e8dcc0", fontSize: 12, textShadow: "1px 1px 0 #000" }}>Parry on the beat. Learn the pattern. Jev learns yours.</div>
        </div>
      )}

      {screen === "slots" && center(<>
        <h2 className="ar-h2">Choose a slot</h2>
        {SLOTS.map((s, i) => {
          const sv = saves[i];
          return (
            <div key={s} className="ar-row" style={{ borderBottom: "1px solid rgba(60,40,20,0.3)", padding: "6px 0" }} data-testid={`slot-${s}`}>
              <div style={{ flex: 1 }}>
                <b>Slot {s}</b>
                <div style={{ fontSize: 12 }}>{!sv ? "Empty" : sv.finished ? `Completed · ${sv.deaths} deaths · ${fmtTime(sv.playMs)}` : `${sv.cleared.length}/${ENCOUNTERS.length} bosses · next: ${BOSSES[ENCOUNTERS[sv.bossIndex]].name} · ${sv.deaths} deaths · ${fmtTime(sv.playMs)}`}</div>
              </div>
              {sv && !sv.finished && <button className="ar-btn small" onClick={() => start(s, false)}>Continue</button>}
              <button className="ar-btn small" onClick={() => start(s, true)}>{sv ? "Restart" : "New"}</button>
              {sv && <button className="ar-btn small" onClick={() => { deleteSave(s); refresh(); }}>Delete</button>}
            </div>
          );
        })}
        <button className="ar-btn" style={{ marginTop: 10 }} onClick={() => setScreen("title")}>Back</button>
      </>, 560)}

      {screen === "paused" && center(<>
        <h2 className="ar-h2">Paused</h2>
        {perks.length > 0 && <div className="ar-sub" data-testid="perks">Gifts: {perks.map((id) => PERKS.find((p) => p.id === id)?.name).join(", ")}</div>}
        <button className="ar-btn" onClick={resume} data-testid="resume">Resume</button>
        <button className="ar-btn" onClick={() => openFrom("paused", "settings")}>Settings &amp; controls</button>
        <button className="ar-btn" onClick={() => openFrom("paused", "stats")}>Jev vs the rules bot</button>
        <button className="ar-btn" onClick={toTitle} data-testid="quit">Quit to title</button>
      </>, 380)}

      {screen === "settings" && settings && center(<>
        <h2 className="ar-h2">Settings</h2>
        <div className="ar-row"><label>Sound effects</label><input type="range" min={0} max={1} step={0.05} value={settings.sfx} onChange={(e) => update({ sfx: +e.target.value })} data-testid="sfx" /><span style={{ width: 36 }}>{Math.round(settings.sfx * 100)}%</span></div>
        <div className="ar-row"><label>Music</label><button className={`ar-btn small ${settings.music ? "on" : ""}`} onClick={() => update({ music: !settings.music })} data-testid="music">{settings.music ? "On" : "Off"}</button></div>
        <div className="ar-row"><label>Screen shake</label><button className={`ar-btn small ${settings.shake ? "on" : ""}`} onClick={() => update({ shake: !settings.shake })}>{settings.shake ? "On" : "Off"}</button></div>
        <div className="ar-row"><label>Quick-time events</label>
          {(["on", "assist", "off"] as const).map((m) => <button key={m} className={`ar-btn small ${settings.qte === m ? "on" : ""}`} onClick={() => update({ qte: m })} data-testid={`qte-${m}`}>{m === "on" ? "Normal" : m === "assist" ? "Assist" : "Skip"}</button>)}
        </div>
        <div className="ar-row"><label>Combat assist (wider parry, softer bosses)</label><button className={`ar-btn small ${settings.assist ? "on" : ""}`} onClick={() => update({ assist: !settings.assist })} data-testid="assist">{settings.assist ? "On" : "Off"}</button></div>
        <div className="ar-row"><label>Bosses think with</label>
          {(["jev", "rules"] as const).map((m) => <button key={m} className={`ar-btn small ${settings.brain === m ? "on" : ""}`} onClick={() => update({ brain: m })} data-testid={`brain-${m}`}>{m === "jev" ? "Jev" : "Rules bot"}</button>)}
        </div>
        <h2 className="ar-h2" style={{ marginTop: 14 }}>Controls</h2>
        <div style={{ fontSize: 12, marginBottom: 6 }}>Click a key to rebind it (Esc cancels). Pad: stick or d-pad moves, X attack, A roll, B/shoulder guard, Y flame burst, Start pause.</div>
        {ACTIONS.map((a) => (
          <div className="ar-row" key={a}>
            <label>{ACTION_LABEL[a]}</label>
            {[0, 1].map((slot) => {
              const on = listening?.action === a && listening.slot === slot;
              const k = settings.keymap[a][slot];
              return <button key={slot} className={`ar-btn small ${on ? "on" : ""}`} style={{ minWidth: 70 }} disabled={slot === 1 && !settings.keymap[a][0]} onClick={() => setListening({ action: a, slot })} data-testid={`bind-${a}-${slot}`}>{on ? "press a key…" : k ? keyLabel(k) : "(add)"}</button>;
            })}
          </div>
        ))}
        <div className="ar-row" style={{ marginTop: 8 }}>
          <button className="ar-btn small" onClick={() => update({ keymap: { ...DEFAULT_KEYMAP } })} data-testid="reset-keys">Reset keys</button>
          <button className="ar-btn small" onClick={() => { apiRef.current?.clearMemory(); refresh(); }} data-testid="forget">Make the bosses forget me</button>
        </div>
        <button className="ar-btn" style={{ marginTop: 10 }} onClick={() => setScreen(from === "paused" ? "paused" : "title")}>Back</button>
      </>, 560)}

      {screen === "stats" && center(<>
        <h2 className="ar-h2">Jev vs the rules bot</h2>
        <div className="ar-sub">Every finished fight is recorded with the brain that ran the boss. Use F in a fight or Settings to switch brains and compare.</div>
        <Compare list={stats} />
        <h2 className="ar-h2" style={{ marginTop: 14, fontSize: 15 }}>Recent fights</h2>
        <table className="ar-table"><tbody>{stats.slice(-8).reverse().map((r, i) => (
          <tr key={i}><td>{BOSSES[r.boss]?.name ?? r.boss}</td><td>{r.brain}</td><td>{r.won ? "you won" : "you fell"}</td><td>{Math.round(r.ms / 1000)} s</td></tr>
        ))}{!stats.length && <tr><td>No fights yet.</td></tr>}</tbody></table>
        <button className="ar-btn" style={{ marginTop: 10 }} onClick={() => setScreen(from === "paused" ? "paused" : "title")}>Back</button>
      </>, 560)}

      {screen === "credits" && center(<>
        <h2 className="ar-h2">Credits</h2>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <b>Characters</b>: chierit (Elementals: Fire Knight, Metal Bladekeeper, Crystal Mauler, Wind Hashashin, and more), CC BY 4.0.<br />
          <b>Effects</b>: pimen (hit sparks, slashes, fire, ice, thunder, earth, wind, water, wood, acid, dark, holy, smoke), credited as requested.<br />
          <b>Environments, UI and icons</b>: immunitys (Forgotten Memories 32x32, Resurrected RPG, Pixel RPG UI Pack).<br />
          <b>Music</b>: Ninja Adventure Asset Pack by pixel-boy (CC0). <b>Sword sounds</b>: StarNinjas via OpenGameArt (CC0).<br />
          <b>The boss&apos;s mind</b>: Jev, by TypeSafe. Built with Phaser, Next.js and React.
        </div>
        <button className="ar-btn" style={{ marginTop: 10 }} onClick={() => setScreen(ending(result) ? "ending" : "title")}>Back</button>
      </>)}

      {screen === "briefing" && center(<>
        <h2 className="ar-h2" data-testid="briefing">{boss || "Next fight"}</h2>
        <div className="ar-sub">{demo ? "Guided demo (combat assist is on)" : ""}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          {(DEMO_NOTES[Object.values(BOSSES).find((b) => b.name === boss)?.id ?? "mb"]?.watch ?? []).map((w, i) => <p key={i} style={{ margin: "6px 0" }}>• {w}</p>)}
        </div>
        <button className="ar-btn" onClick={() => { apiRef.current?.resume(); setScreen("playing"); }} data-testid="begin">Begin the fight</button>
      </>, 500)}

      {screen === "shrine" && result && center(<>
        <h2 className="ar-h2" data-testid="shrine">The shrine</h2>
        <div className="ar-sub">A quiet place between fights. Keep one gift for the rest of the run ({perks.length}/{MAX_PERKS}).</div>
        {offer(perks, ENCOUNTERS.indexOf(result.boss)).map((pk) => (
          <button key={pk.id} className="ar-btn" onClick={() => { apiRef.current?.choosePerk(pk.id); setPerks(apiRef.current?.perks() ?? []); goNext(); }} data-testid={`perk-${pk.id}`}>
            {pk.name}<div style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{pk.desc}</div>
          </button>
        ))}
      </>, 480)}

      {screen === "victory" && result && center(<>
        <h2 className="ar-h2" data-testid="victory">{result.bossName} falls</h2>
        <div className="ar-sub">&ldquo;{result.outro}&rdquo;</div>
        <FightLine r={result.record} />
        <button className="ar-btn" onClick={proceed} data-testid="next">Next: {BOSSES[ENCOUNTERS[Math.min(ENCOUNTERS.indexOf(result.boss) + 1, ENCOUNTERS.length - 1)]].name}</button>
        <button className="ar-btn" onClick={toTitle} data-testid="quit">Quit to title</button>
      </>, 420)}

      {screen === "defeat" && result && center(<>
        <h2 className="ar-h2" data-testid="defeat">You fell</h2>
        <div className="ar-sub">{result.bossName} remembers how you fought. Jev will use it.</div>
        <FightLine r={result.record} />
        <button className="ar-btn" onClick={() => { apiRef.current?.retry(); setDecisions([]); setScreen("playing"); }} data-testid="retry">Try again</button>
        <button className="ar-btn" onClick={toTitle} data-testid="quit">Quit to title</button>
      </>, 420)}

      {screen === "ending" && result && center(<>
        <h2 className="ar-h2" data-testid="ending">The Echo fades</h2>
        <div className="ar-sub">&ldquo;{result.outro}&rdquo;</div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>Run complete in {fmtTime(result.playMs)} with {result.deaths} {result.deaths === 1 ? "death" : "deaths"}.</div>
        <h2 className="ar-h2" style={{ fontSize: 15 }}>Jev vs the rules bot</h2>
        <Compare list={stats} />
        <button className="ar-btn" style={{ marginTop: 10 }} onClick={() => setScreen("credits")}>Credits</button>
        <button className="ar-btn" onClick={() => { const sv = saves.find((s) => s?.finished); start(sv?.slot ?? 1, true); }} data-testid="ngplus">New run (the bosses remember you)</button>
        <button className="ar-btn" onClick={toTitle} data-testid="quit">Title</button>
      </>, 520)}

      {/* Jev strip: always visible while playing; Tab opens the full panel */}
      {playing && (
        <div className="ar-dark" style={{ position: "absolute", right: 8, bottom: 8, width: panel ? 330 : 270, maxHeight: panel ? "80%" : undefined, overflowY: panel ? "auto" : "hidden", fontSize: 11 }} data-testid="jev-strip">
          <div className="ar-row" style={{ margin: 0 }}>
            <b style={{ color: brain === "jev" ? "#58a6ff" : "#9aa0a6", letterSpacing: 1 }}>{brain === "jev" ? "JEV" : "RULES BOT"}</b>
            <span style={{ flex: 1, textAlign: "center", opacity: 0.8 }}>{boss}</span>
            <button className="ar-btn small" style={{ fontSize: 10, padding: "1px 6px" }} onClick={() => apiRef.current?.toggleBrain()} data-testid="brain-toggle">F: swap</button>
          </div>
          <div style={{ marginTop: 3, minHeight: 15 }} data-testid="jev-last">
            {last ? <><b>{last.label}</b> <span style={{ color: SOURCE_COLOR[last.source] }}>[{last.source}{last.latencyMs ? ` ${last.latencyMs}ms` : ""}]</span>{last.taunt && last.taunt !== "NONE" && <span style={{ color: "#ffd166" }}> says it</span>}</> : <span style={{ opacity: 0.6 }}>waiting for the boss to decide…</span>}
          </div>
          {probs.slice(0, panel ? 5 : 2).map(([n, p]) => <Bar key={n} label={n} value={p} color={n === last?.choice ? "#58a6ff" : "#6e7681"} />)}
          {panel && (
            <>
              {reads && <><div style={{ marginTop: 6, opacity: 0.8 }}>Jev&apos;s read of you</div>
                <Bar label="turtling" value={reads.turtling} color={reads.turtling > 0.66 ? "#f0883e" : "#58a6ff"} />
                <Bar label="roll-reliant" value={reads.rollReliant} color={reads.rollReliant > 0.66 ? "#f0883e" : "#58a6ff"} />
                <Bar label="trade-hungry" value={reads.tradeHungry} color={reads.tradeHungry > 0.66 ? "#f0883e" : "#58a6ff"} />
                <Bar label="panicking" value={reads.panicking} color={reads.panicking > 0.66 ? "#f0883e" : "#58a6ff"} /></>}
              <div style={{ marginTop: 6, opacity: 0.8 }}>{jev.length} Jev answers · avg {avg} ms · fallbacks {decisions.filter((d) => d.source === "fallback").length}</div>
              {decisions.slice(0, 14).map((d) => (
                <div key={d.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "1px 0" }}>
                  {d.label} <span style={{ color: SOURCE_COLOR[d.source] }}>[{d.source}{d.latencyMs ? ` ${d.latencyMs}ms` : ""}]</span>
                  {d.error && <div style={{ color: "#f85149" }}>{d.error}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {dev && null}
    </div>
  );
}

const ending = (r: FightResult | null) => !!r && r.won && r.final;

function FightLine({ r }: { r: FightRecord }) {
  return (
    <div style={{ fontSize: 13, margin: "6px 0 10px", lineHeight: 1.5 }} data-testid="fightline">
      Boss ran on <b>{r.brain === "jev" ? "Jev" : r.brain === "rules" ? "the rules bot" : "both brains"}</b> · {Math.round(r.ms / 1000)} s · you lost {r.hpLost} HP<br />
      Attacks thrown {r.thrown}: parried {r.deflected + r.countered}, blocked {r.blocked}, dodged {r.dodged}, landed {r.hit}
      {r.decisions.jev > 0 && <><br />Jev made {r.decisions.jev} decisions, {Math.round(r.jevMs / r.decisions.jev)} ms each{r.decisions.fallback ? ` (${r.decisions.fallback} fell back to rules)` : ""}</>}
    </div>
  );
}
