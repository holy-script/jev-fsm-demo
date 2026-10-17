"use client";
import { useEffect, useRef, useState } from "react";

// Phase 0 asset lab for v4 ("ARENA", docs/09-v4-plan.md). Plays every character animation and VFX sheet from
// public/arena-assets/manifest.json (built by `npm run assets:arena`) so slicing, frame counts and orientation can be checked by eye.
// Not part of the game: throwaway tooling, kept because new packs will need the same check.

type Sheet = { file: string; frameW: number; frameH: number; frames: number; bbox: number[]; first: number[]; cols?: number; rows?: number; confident?: boolean; auto?: boolean };
type Manifest = { sheets: Record<string, Sheet>; vfx: Record<string, Sheet>; raw: Record<string, { file: string; size: number[] }[]>; chars: Record<string, string> };
type Mode = "fwd" | "rev" | "pingpong";

const imgCache = new Map<string, HTMLImageElement>();
function loadImg(src: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(src);
  if (hit) return Promise.resolve(hit);
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { imgCache.set(src, im); res(im); };
    im.src = "/" + src;
  });
}

function frameIndex(t: number, n: number, fps: number, mode: Mode, loop: boolean): number {
  const f = Math.floor((t / 1000) * fps);
  if (mode === "pingpong") { const p = f % (n * 2 - 2 || 1); return p < n ? p : n * 2 - 2 - p; }
  const i = loop ? f % n : Math.min(f, n - 1);
  return mode === "rev" ? n - 1 - i : i;
}

function Sprite({ s, scale, fps, mode, fixed, bg, crop }: { s: Sheet; scale: number; fps: number; mode: Mode; fixed?: number; bg?: string; crop?: boolean }) {
  const [bx0, by0, bx1, by1] = crop ? s.bbox : [0, 0, s.frameW, s.frameH];
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0, alive = true;
    const t0 = performance.now();
    loadImg(s.file).then((im) => {
      const c = ref.current; if (!c || !alive) return;
      const g = c.getContext("2d")!; g.imageSmoothingEnabled = false;
      const cols = s.cols ?? s.frames;
      const draw = (now: number) => {
        if (!alive) return;
        const i = fixed ?? frameIndex(now - t0, s.frames, fps, mode, true);
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(im, (i % cols) * s.frameW + bx0, Math.floor(i / cols) * s.frameH + by0, bx1 - bx0, by1 - by0, 0, 0, c.width, c.height);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    });
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [s, fps, mode, fixed, bx0, by0, bx1, by1]);
  return <canvas ref={ref} width={(bx1 - bx0) * scale} height={(by1 - by0) * scale} style={{ background: bg ?? "#2a2a38", imageRendering: "pixelated" }} />;
}

export default function Lab() {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"chars" | "vfx" | "raw">("chars");
  const [who, setWho] = useState("fk");
  const [mode, setMode] = useState<Mode>("fwd");
  const [fps, setFps] = useState(12);
  const [sel, setSel] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [pack, setPack] = useState("");

  useEffect(() => {
    fetch("/arena-assets/manifest.json").then((r) => r.json()).then((j: Manifest) => { setM(j); setPack(Object.keys(j.raw)[0] ?? ""); }).catch(() => setErr("manifest missing: run npm run assets:arena"));
  }, []);
  if (err) return <pre style={{ color: "#f88", padding: 20 }}>{err}</pre>;
  if (!m) return <pre style={{ padding: 20 }}>loading…</pre>;

  const anims = Object.entries(m.sheets).filter(([k]) => k.startsWith(who + "_"));
  const vfx = Object.entries(m.vfx).filter(([k]) => k.includes(q.toLowerCase()));
  const picked = sel ? m.sheets[sel] ?? m.vfx[sel] : null;
  const btn = (on: boolean) => ({ padding: "4px 10px", margin: 2, background: on ? "#58f" : "#334", color: "#fff", border: 0, cursor: "pointer" } as const);

  return (
    <div style={{ font: "12px monospace", color: "#ddd", background: "#14141c", minHeight: "100vh", padding: 12 }}>
      <h3 style={{ margin: 0 }}>ARENA asset lab (phase 0)</h3>
      <div>
        {(["chars", "vfx", "raw"] as const).map((t) => <button key={t} style={btn(tab === t)} onClick={() => setTab(t)}>{t}</button>)}
        {" | "}
        {(["fwd", "rev", "pingpong"] as const).map((x) => <button key={x} style={btn(mode === x)} onClick={() => setMode(x)}>{x}</button>)}
        {" fps "}<input type="range" min={2} max={30} value={fps} onChange={(e) => setFps(+e.target.value)} /> {fps}
      </div>

      {picked && sel && (
        <div style={{ position: "sticky", top: 0, background: "#1c1c28", padding: 8, margin: "8px 0", border: "1px solid #446", display: "flex", gap: 16, alignItems: "center", zIndex: 5 }}>
          <Sprite s={picked} scale={Math.max(2, Math.min(6, Math.floor(300 / (picked.bbox[3] - picked.bbox[1]))))} fps={fps} mode={mode} fixed={scrub ?? undefined} crop={!!m.sheets[sel]} />
          <div>
            <b>{sel}</b><br />{picked.frames} frames, {picked.frameW}x{picked.frameH}, bbox [{picked.bbox.join(",")}]<br />
            scrub <input type="range" min={0} max={picked.frames - 1} value={scrub ?? 0} onChange={(e) => setScrub(+e.target.value)} />
            <button style={btn(false)} onClick={() => setScrub(null)}>play</button>
            <button style={btn(false)} onClick={() => setSel(null)}>close</button>
          </div>
        </div>
      )}

      {tab === "chars" && (
        <>
          <div>{Object.entries(m.chars).map(([k, n]) => <button key={k} style={btn(who === k)} onClick={() => setWho(k)}>{n}</button>)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            {anims.map(([k, s]) => (
              <div key={k} onClick={() => { setSel(k); setScrub(null); }} style={{ cursor: "pointer" }}>
                <Sprite s={s} scale={2} fps={fps} mode={mode} crop />
                <div>{k.slice(who.length + 1)} ({s.frames})</div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "vfx" && (
        <>
          filter <input value={q} onChange={(e) => setQ(e.target.value)} /> {vfx.length} sheets
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            {vfx.map(([k, s]) => (
              <div key={k} onClick={() => { setSel(k); setScrub(null); }} style={{ cursor: "pointer", width: Math.max(96, s.frameW * 2) }}>
                <Sprite s={s} scale={Math.max(1, Math.min(3, Math.floor(96 / Math.max(s.frameW, s.frameH))))} fps={fps} mode={mode} />
                <div style={{ color: s.confident === false ? "#fa6" : undefined, wordBreak: "break-all" }}>{k} ({s.frames})</div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "raw" && (
        <>
          <div>{Object.keys(m.raw).map((k) => <button key={k} style={btn(pack === k)} onClick={() => setPack(k)}>{k}</button>)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            {(m.raw[pack] ?? []).slice(0, 80).map((r) => (
              <div key={r.file}><img src={"/" + r.file} style={{ imageRendering: "pixelated", maxWidth: 480, background: "#2a2a38" }} alt="" /><div>{r.file.split("/").slice(-2).join("/")} {r.size.join("x")}</div></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
