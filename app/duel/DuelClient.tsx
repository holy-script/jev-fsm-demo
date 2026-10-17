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
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  const last = decisions.find((d) => d.probabilities);
  const probs = last?.probabilities ? Object.entries(last.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const key = (k: string, d: string) => (
    <div style={{ display: "flex", gap: 8, padding: "1px 0" }}>
      <b style={{ width: 64, color: "#e3b341", flexShrink: 0 }}>{k}</b>
      <span style={{ opacity: 0.85 }}>{d}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 16, padding: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 640px", maxWidth: 1000 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <Link href="/" style={{ color: "#58a6ff" }}>← back</Link>
        </div>
        {missing && (
          <div style={{ border: "1px solid #d29922", padding: 12, marginBottom: 8, fontSize: 13 }}>
            Duel assets not found. See <code>tools/README.md</code>, then run <code>npm run assets:duel</code> and reload.
          </div>
        )}
        <div ref={parent} style={{ width: "100%", aspectRatio: "16 / 9", background: "#0b0d12", border: "1px solid #30363d" }} />
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          Walk north through the gate to wake the first boss. Deflect (tap guard just before impact) to break its posture, then land the deathblow. Beat the Skeleton Captain to face the Mecha-Stone Golem.{" "}
          <b>F</b> swaps the boss&apos;s brain between Jev and a fixed-priority rules bot.
        </p>
      </div>

      <div style={{ width: 360, fontSize: 12 }}>
        <h2 style={{ margin: "0 0 8px" }}>Posture Duel</h2>

        <h3 style={{ margin: "8px 0 4px" }}>Jev&apos;s read of you</h3>
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
        <div style={{ maxHeight: 190, overflowY: "auto" }}>
          {decisions.map((d) => (
            <div key={d.id} style={{ padding: "2px 0", borderBottom: "1px solid #21262d" }}>
              <b>{d.label}</b>{" "}
              <span style={{ opacity: 0.6 }}>[{d.source}{d.latencyMs ? ` ${d.latencyMs}ms` : ""}]</span>
              {d.error && <div style={{ color: "#f85149" }}>{d.error}</div>}
            </div>
          ))}
        </div>

        <h3 style={{ margin: "12px 0 4px" }}>Controls</h3>
        {key("WASD", "move (auto-faces boss)")}
        {key("J / click", "light chain · K heavy")}
        {key("SPACE", "tap = deflect · hold = block")}
        {key("SHIFT", "roll · dodge a red thrust = SLIP")}
        {key("E / Q", "kick (breaks guard) / heal")}
        {key("F / R / M", "brain / retry / music")}
        <div style={{ opacity: 0.55, marginTop: 4 }}>dev: Z X C V B force the boss's moves in order · G guard · N auto · T refill · Y wake · 1/2 pick boss</div>

        <h3 style={{ margin: "12px 0 4px" }}>Events</h3>
        <div style={{ maxHeight: 120, overflowY: "auto", opacity: 0.8 }}>
          {log.map((l, i) => (
            <div key={i} style={{ padding: "1px 0" }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
