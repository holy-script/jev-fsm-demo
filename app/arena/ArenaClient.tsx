"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function ArenaClient() {
  const parent = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import("@/game/v4/createArenaGame").then(({ createArenaGame }) => {
      if (cancelled || !parent.current) return;
      destroy = createArenaGame(parent.current, { onMissingAssets: () => setMissing(true) });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#05070a" }}>
      <div ref={parent} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, opacity: 0.8 }}>
        <Link href="/" style={{ color: "#58a6ff" }}>← back</Link>
      </div>
      {missing && (
        <div style={{ position: "absolute", top: 50, left: 12, border: "1px solid #d29922", background: "#161b22", padding: 12, fontSize: 13 }}>
          Arena assets not found. See <code>tools/README.md</code>, then run <code>npm run assets:arena</code> and reload.
        </div>
      )}
    </div>
  );
}
