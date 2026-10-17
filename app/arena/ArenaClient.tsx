"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Decision } from "@/game/v4/brain";

type Entry = Decision & { id: number };

function Bar({ label, value, color = "#58a6ff" }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
      <span style={{ width: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, background: "#21262d", height: 8 }}>
        <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color, height: 8 }} />
      </div>
      <span style={{ width: 34, textAlign: "right" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

const SOURCE_COLOR: Record<string, string> = { jev: "#58a6ff", rules: "#8b949e", fallback: "#d29922" };

/** Phase 3 shell: the game canvas plus a basic Jev panel (Tab). Phase 5 replaces it with the designed UI. */
export default function ArenaClient() {
  const parent = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState(false);
  const [panel, setPanel] = useState(false);
  const [boss, setBoss] = useState("");
  const [decisions, setDecisions] = useState<Entry[]>([]);

  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    let id = 0;
    import("@/game/v4/createArenaGame").then(({ createArenaGame }) => {
      if (cancelled || !parent.current) return;
      destroy = createArenaGame(parent.current, {
        onMissingAssets: () => setMissing(true),
        onBoss: (n) => { setBoss(n); setDecisions([]); },
        onDecision: (d) => setDecisions((l) => [{ ...d, id: id++ }, ...l].slice(0, 40)),
      });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setPanel((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      destroy?.();
    };
  }, []);

  const jev = decisions.filter((d) => d.source === "jev");
  const avg = jev.length ? Math.round(jev.reduce((s, d) => s + d.latencyMs, 0) / jev.length) : 0;
  const fb = decisions.filter((d) => d.source === "fallback").length;
  const last = decisions.find((d) => d.probabilities);
  const probs = last?.probabilities ? Object.entries(last.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const reads = decisions.find((d) => d.reads)?.reads;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#05070a" }}>
      <div ref={parent} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, display: "flex", gap: 12, alignItems: "center", opacity: 0.85 }}>
        <Link href="/" style={{ color: "#58a6ff" }}>← back</Link>
        <button onClick={() => setPanel((v) => !v)} style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", padding: "3px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
          Jev panel [Tab]
        </button>
      </div>
      {missing && (
        <div style={{ position: "absolute", top: 50, left: 12, border: "1px solid #d29922", background: "#161b22", padding: 12, fontSize: 13 }}>
          Arena assets not found. See <code>tools/README.md</code>, then run <code>npm run assets:arena</code> and reload.
        </div>
      )}
      {panel && (
        <div style={{ position: "absolute", top: 44, right: 12, bottom: 12, width: 320, overflowY: "auto", background: "rgba(13,17,23,0.88)", border: "1px solid #30363d", padding: 12, fontSize: 12, color: "#e6edf3" }}>
          <h3 style={{ margin: "0 0 4px" }}>{boss || "…"}: brain</h3>
          <div style={{ opacity: 0.8 }}>
            Jev answers {jev.length} · avg {avg} ms · fallbacks {fb} · <b>F</b> switches to the rules bot
          </div>
          {reads && (
            <>
              <h3 style={{ margin: "10px 0 4px" }}>Jev&apos;s read of you</h3>
              <Bar label="turtling" value={reads.turtling} color={reads.turtling > 0.66 ? "#f0883e" : "#58a6ff"} />
              <Bar label="roll-reliant" value={reads.rollReliant} color={reads.rollReliant > 0.66 ? "#f0883e" : "#58a6ff"} />
              <Bar label="trade-hungry" value={reads.tradeHungry} color={reads.tradeHungry > 0.66 ? "#f0883e" : "#58a6ff"} />
              <Bar label="panicking" value={reads.panicking} color={reads.panicking > 0.66 ? "#f0883e" : "#58a6ff"} />
            </>
          )}
          <h3 style={{ margin: "10px 0 4px" }}>Last decision{last ? `: ${last.label}` : ""}</h3>
          {probs.map(([name, p]) => (
            <Bar key={name} label={name} value={p} color={name === last?.choice ? "#58a6ff" : "#6e7681"} />
          ))}
          <h3 style={{ margin: "10px 0 4px" }}>Decision log</h3>
          {decisions.map((d) => (
            <div key={d.id} style={{ padding: "2px 0", borderBottom: "1px solid #21262d" }}>
              <b>{d.label}</b> <span style={{ color: SOURCE_COLOR[d.source] }}>[{d.source}{d.latencyMs ? ` ${d.latencyMs}ms` : ""}]</span>
              {d.taunt && d.taunt !== "NONE" && <span style={{ color: "#ffd166" }}> says {d.taunt}</span>}
              {d.error && <div style={{ color: "#f85149" }}>{d.error}</div>}
            </div>
          ))}
          <div style={{ opacity: 0.55, marginTop: 10 }}>F brain · N next boss (after a win) · R restart · P toggle AI (dev) · O/I force attacks (dev)</div>
        </div>
      )}
    </div>
  );
}
