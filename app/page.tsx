import Link from "next/link";

const card = { display: "block", padding: 20, border: "1px solid #30363d", borderRadius: 8, color: "inherit", textDecoration: "none", maxWidth: 420 } as const;

export default function Home() {
  return (
    <main style={{ padding: 32, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Jev vs Human</h1>
      <p style={{ margin: 0, opacity: 0.7 }}>Jev picks the enemy FSM&apos;s next state. You try to beat it.</p>
      <Link href="/boss-rush" style={card}>
        <b>Boss Rush</b>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>
          Side-view hack &amp; slash. Four bosses with their own state machines (Slime, Fire Worm, Evil Wizard, Bringer of Death), each driven by Jev.
        </div>
      </Link>
      <Link href="/duel" style={card}>
        <b>Posture Duel</b>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>
          Sekiro-style duel on a large top-down map: deflect, posture bars, deathblows, perilous attacks. Jev picks the boss's moves, branches its combos and reads your play style.
        </div>
      </Link>
      <Link href="/basic" style={card}>
        <b>Basic duel (v1)</b>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>Top-down shooter duel against a Jev-driven enemy with six states.</div>
      </Link>
    </main>
  );
}
