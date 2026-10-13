"use client";

import { useEffect, useRef, useState } from "react";
import type { Decision } from "@/game/types";

type LogEntry = Decision & { id: number; from: string; t: string };

export default function GameClient() {
  const parent = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [score, setScore] = useState({ human: 0, enemy: 0 });
  const [mode, setMode] = useState<"JEV" | "RULES">("JEV");

  useEffect(() => {
    let destroy: (() => void) | undefined;
    let id = 0;
    import("@/game/createGame").then(({ createGame }) => {
      if (!parent.current) return;
      destroy = createGame(parent.current, {
        onDecision: (d, from) =>
          setLog((l) => [{ ...d, from, id: id++, t: new Date().toLocaleTimeString() }, ...l].slice(0, 40)),
        onScore: setScore,
        onMode: setMode,
      });
    });
    return () => destroy?.();
  }, []);

  return (
    <div style={{ display: "flex", gap: 16, padding: 16, flexWrap: "wrap" }}>
      <div>
        <div ref={parent} style={{ border: "1px solid #30363d" }} />
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          WASD move · mouse aim · click shoot · <b>T</b> toggle brain (Jev / Rules) · <b>R</b> restart round
        </p>
      </div>
      <div style={{ width: 380, fontSize: 12 }}>
        <h2 style={{ margin: "0 0 8px" }}>Jev vs Human</h2>
        <div>
          Brain: <b style={{ color: mode === "JEV" ? "#58a6ff" : "#d29922" }}>{mode}</b> · Human {score.human} –{" "}
          {score.enemy} Enemy
        </div>
        <h3 style={{ marginBottom: 4 }}>Decision log</h3>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {log.map((e) => (
            <div key={e.id} style={{ padding: "3px 0", borderBottom: "1px solid #21262d" }}>
              <span style={{ opacity: 0.5 }}>{e.t}</span> {e.from} → <b>{e.state}</b>{" "}
              <span style={{ opacity: 0.6 }}>
                [{e.source}
                {e.latencyMs ? ` ${e.latencyMs}ms` : ""}]
              </span>
              <div style={{ opacity: 0.8 }}>{e.error ? <span style={{ color: "#f85149" }}>{e.error}</span> : e.reason}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
