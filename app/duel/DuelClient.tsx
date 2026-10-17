"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Decision, Reads } from "@/game/duel/brain";

type Entry = Decision & { t: number; id: number };

const READS: [keyof Reads, string][] = [
  ["turtling", "turtling"],
  ["rollReliant", "roll-reliant"],
  ["tradeHungry", "trade-hungry"],
  ["panicking", "panicking"],
];

function Bar({ label, value, color = "#58a6ff", right }: { label: string; value: number; color?: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
      <span style={{ width: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, background: "#21262d", height: 8 }}>
        <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color, height: 8 }} />
      </div>
      <span style={{ width: 34, textAlign: "right" }}>{right ?? `${Math.round(value * 100)}%`}</span>
    </div>
  );
}

export default function DuelClient() {
  const parent = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Entry[]>([]);
  const [reads, setReads] = useState<Reads | null>(null);
  const [missing, setMissing] = useState(false);
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    let id = 0;
    import("@/game/duel/createDuelGame").then(({ createDuelGame }) => {
      if (cancelled || !parent.current) return;
      destroy = createDuelGame(parent.current, {
        onMissingAssets: () => setMissing(true),
        onLog: (line) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 30)),
        onDecision: (d) => {
          if (d.reads) setReads(d.reads);
          setDecisions((l) => [{ ...d, id: id++ }, ...l].slice(0, 60));
        },
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

  const last = decisions.find((d) => d.probabilities);
  const probs = last?.probabilities ? Object.entries(last.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#05070a" }}>
      <div ref={parent} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, display: "flex", gap: 12, alignItems: "center", opacity: 0.8 }}>
        <Link href="/" style={{ color: "#58a6ff" }}>← back</Link>
        <button onClick={() => setPanel((v) => !v)} style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", padding: "3px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
          Jev panel [Tab]
        </button>
      </div>
      {missing && (
        <div style={{ position: "absolute", top: 50, left: 12, border: "1px solid #d29922", background: "#161b22", padding: 12, fontSize: 13 }}>
          Duel assets not found. See <code>tools/README.md</code>, then run <code>npm run assets:duel</code> and reload.
        </div>
      )}
      {panel && (
        <div style={{ position: "absolute", top: 44, right: 12, bottom: 12, width: 340, overflowY: "auto", background: "rgba(13,17,23,0.88)", border: "1px solid #30363d", padding: 12, fontSize: 12 }}>
          <h3 style={{ margin: "0 0 4px" }}>Jev&apos;s read of you</h3>
          {!reads && <div style={{ opacity: 0.5 }}>wake the boss and fight…</div>}
          {reads && (
            <>
              {READS.map(([k, label]) => (
                <Bar key={k} label={label} value={reads[k]} color={reads[k] > 0.66 ? "#f0883e" : "#58a6ff"} />
              ))}
              <Bar label="predictable" value={reads.predictability / 3} color="#bc8cff" right={reads.predictability.toFixed(1)} />
            </>
          )}
          <h3 style={{ margin: "12px 0 4px" }}>Last decision{last ? `: ${last.label}` : ""}</h3>
          {probs.map(([name, p]) => (
            <Bar key={name} label={name} value={p} color={name === last?.choice ? "#58a6ff" : "#6e7681"} />
          ))}
          <h3 style={{ margin: "12px 0 4px" }}>Decision log</h3>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {decisions.map((d) => (
              <div key={d.id} style={{ padding: "2px 0", borderBottom: "1px solid #21262d" }}>
                <b>{d.label}</b> <span style={{ opacity: 0.6 }}>[{d.source}{d.latencyMs ? ` ${d.latencyMs}ms` : ""}]</span>
                {d.error && <div style={{ color: "#f85149" }}>{d.error}</div>}
              </div>
            ))}
          </div>
          <h3 style={{ margin: "12px 0 4px" }}>Events</h3>
          <div style={{ maxHeight: 130, overflowY: "auto", opacity: 0.8 }}>
            {log.map((l, i) => (
              <div key={i} style={{ padding: "1px 0" }}>{l}</div>
            ))}
          </div>
          <div style={{ opacity: 0.55, marginTop: 10 }}>dev keys: Z X C V B force the boss&apos;s moves · G guard · N auto · T refill · Y wake · 1/2 pick boss · F brain</div>
        </div>
      )}
    </div>
  );
}
