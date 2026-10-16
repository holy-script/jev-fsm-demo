"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BossDecision } from "@/game/boss/brain";

type Entry = BossDecision & { boss: string; from: string; id: number; t: string };
type Status = { boss: number; bossName: string; phase: string; deaths: number; hitsTaken: number; seconds: number };

export default function BossRushClient() {
  const parent = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [mode, setMode] = useState<"JEV" | "RULES">("JEV");
  const [status, setStatus] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let destroy: (() => void) | undefined;
    let id = 0;
    let cancelled = false;
    import("@/game/boss/createBossGame").then(({ createBossGame }) => {
      if (cancelled || !parent.current) return;
      destroy = createBossGame(parent.current, {
        onDecision: (d) => setLog((l) => [{ ...d, id: id++, t: new Date().toLocaleTimeString() }, ...l].slice(0, 60)),
        onMode: setMode,
        onStatus: setStatus,
        onMissingAssets: () => setMissing(true),
      });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  const last = log.find((e) => e.probabilities);
  const probs = last?.probabilities ? Object.entries(last.probabilities).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div style={{ display: "flex", gap: 16, padding: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 640px", maxWidth: 960 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <Link href="/" style={{ color: "#58a6ff" }}>← back</Link>
        </div>
        {missing && (
          <div style={{ border: "1px solid #d29922", padding: 12, marginBottom: 8, fontSize: 13 }}>
            Game assets not found. Download the packs (see <code>tools/README.md</code>), then run <code>npm run assets</code> and reload.
          </div>
        )}
        <div ref={parent} style={{ width: "100%", aspectRatio: "640 / 368", background: "#10151c", border: "1px solid #30363d" }} />
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          <b>A/D</b> move · <b>W/Space</b> jump (+<b>S</b> to drop through ledges) · <b>J</b> or click attack · <b>K/Shift</b> dash (invulnerable) ·{" "}
          <b>T</b> swap brain (Jev / Rules) · <b>R</b> retry · <b>1-4</b> pick a boss · <b>H</b> hide labels
        </p>
      </div>

      <div style={{ width: 360, fontSize: 12 }}>
        <h2 style={{ margin: "0 0 8px" }}>Jev Boss Rush</h2>
        <div>
          Brain: <b style={{ color: mode === "JEV" ? "#58a6ff" : "#d29922" }}>{mode}</b>
          {status && (
            <>
              {" "}· Boss {status.boss + 1}/4 · deaths {status.deaths} · hits taken {status.hitsTaken}
            </>
          )}
        </div>

        <h3 style={{ margin: "14px 0 4px" }}>Jev&apos;s last read</h3>
        {probs.length === 0 && <div style={{ opacity: 0.5 }}>waiting for a decision…</div>}
        {probs.map(([name, p]) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <div style={{ flex: 1, background: "#21262d", height: 8 }}>
              <div style={{ width: `${Math.round(p * 100)}%`, background: name === last?.state ? "#58a6ff" : "#6e7681", height: 8 }} />
            </div>
            <span style={{ width: 32, textAlign: "right" }}>{Math.round(p * 100)}%</span>
          </div>
        ))}

        <h3 style={{ margin: "14px 0 4px" }}>Decision log</h3>
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {log.map((e) => (
            <div key={e.id} style={{ padding: "3px 0", borderBottom: "1px solid #21262d" }}>
              <span style={{ opacity: 0.5 }}>{e.t}</span> {e.boss}: {e.from} → <b>{e.state}</b>{" "}
              <span style={{ opacity: 0.6 }}>
                [{e.source}
                {e.latencyMs ? ` ${e.latencyMs}ms` : ""}]
              </span>
              {e.error && <div style={{ color: "#f85149" }}>{e.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
