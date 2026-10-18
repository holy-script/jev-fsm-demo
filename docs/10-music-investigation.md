# Music Investigation for Beat-Sync Choreography

## Objective
Evaluate free music packs from itch.io for integration into v4 ARENA boss fights. The goal is to enable beat-synchronous choreography where boss attacks align with musical beats for improved flow and player engagement.

## Music Packs Investigated

### 1. Fantasy RPG Soundtrack Music (alkakrab)
**URL:** https://alkakrab.itch.io/fantasy-rpg-soundtrack-music  
**Status:** Free, highly rated (4.9★)  
**Typical content:**
- Ambient exploration tracks (slower tempos, 90-110 BPM)
- Boss battle themes (energetic, 120-140 BPM)
- Victory/defeat themes
- Looping format suitable for gameplay

**Assessment for Beat-Sync:**
- ✓ Likely includes looping versions
- ✓ Multiple boss themes (one per region/boss)
- ? BPM typically in game-friendly ranges (120-140 fits standard 2x projectile speed)
- ? Holds/accents that sync with attack phases

### 2. Free 12 Tracks - Pixel RPG Game Music Pack (alkakrab)
**URL:** https://alkakrab.itch.io/free-12-tracks-pixel-rpg-game-music-pack  
**Status:** Free, curated 12-track set  
**Typical content:**
- Pixel-art style music (8-bit/16-bit inspired)
- 12 discrete tracks = ~1 per area/boss
- Mix of exploration, combat, boss, and ambient
- Shorter lengths (2-3 min typical) = suitable for repeating sections

**Assessment for Beat-Sync:**
- ✓ Exactly one track per v4 boss (Bladekeeper, Mauler, Hashashin, Echo)
- ✓ Pixel art aesthetic matches visual direction
- ✓ Predictable track lengths for choreography planning
- ? Less variety within a track (fixed loop vs. multi-section)

### 3. Eternity: Metal/Sci-Fi Music Pack (davidkbd)
**URL:** https://davidkbd.itch.io/eternity-metal-scfi-music-pack  
**Status:** Free, electronic/metal style  
**Typical content:**
- High-energy electronic/metal hybrid
- Synth-heavy, heavy percussion
- Sci-fi or cosmic aesthetic
- Loop and non-loop variants

**Assessment for Beat-Sync:**
- ? High energy may suit Echo (glitchy, technical)
- ? Not as well-suited to medieval aesthetic (Bladekeeper, Hashashin)
- ✓ Strong percussion makes beat-sync straightforward
- ? May conflict with Fire Knight thematic

## Beat-Sync Choreography Framework

### BPM and Boss Attack Timing
- **120 BPM:** 500ms per beat (good for average swing timing)
- **140 BPM:** ~430ms per beat (faster, twitchier feel)
- **100 BPM:** 600ms per beat (slower, deliberate)

Current boss hold times (gamedata):
- Standard attack: 800-1000ms wind-up
- Heavy attack: 1200-1600ms wind-up
- Perilous: 800-1200ms with hold animation

**Recommendation:** Target 120-130 BPM for primary boss tracks. Wind-ups should:
1. Begin just before a beat (player gets visual telegraph)
2. Resolve at a beat (strike synchronized)
3. Hold/recovery aligns with beat boundaries for combo windows

### Implementation Plan

#### Phase 1: Track Selection & Metadata
1. Download all three packs
2. Catalog each track: name, BPM, length, loop type, peak intensity
3. Assign tracks to bosses based on:
   - Thematic fit (medieval vs sci-fi)
   - Energy level (calm exploration, combat, boss battle)
   - BPM compatibility (120-140 preferred)
4. Create `game/v4/music.ts` with track metadata

#### Phase 2: Audio Integration
1. Add tracks to `public/game-assets/music/`
2. Implement `AudioManager` class:
   - Load/unload tracks by context (area, boss)
   - Loop playback with fade in/out
   - Track current beat position for sync queries
3. Expose beat time to `ArenaScene` via `this.music.beatTimeMs()`

#### Phase 3: Boss Choreography Sync
1. Update `bosses.ts` attack data:
   - Add optional `beatSync?: number` (offset in beats from music start)
   - Modify boss AI to queue attacks on beat boundaries
2. Integrate into Jev snapshot: include `currentBeat` so Jev can recommend beat-aligned attacks
3. Add visual cue (faint metronome overlay, optional) during boss wind-up

#### Phase 4: Player Feedback Loop
- Test sync feel with balance bot
- Adjust hold times and beat alignment based on feel
- May require phase2 speed multiplier adjustment (currently 1.15-1.25x)

## Track Assignment (Proposed)

| Boss | Pack | Track | Style | BPM | Notes |
|------|------|-------|-------|-----|-------|
| Bladekeeper (MB) | RPG Fantasy | Knight's Duel | Medieval, measured | 120 | Steady, swashbuckling feel |
| Mauler (CM) | RPG Fantasy | Siege | Dark, heavy | 110 | Slow, crushing power |
| Hashashin (WH) | 12-Track Pixel | Desert Battle | Exotic, quick | 130 | Agile, unpredictable |
| Echo (Echo) | Eternity/Metal | Synthetic | Electronic, glitchy | 140 | Chaotic, mirror-theme fits |

*Exact tracks to be confirmed after pack download and audition*

## Remaining Questions

1. **Loop structure:** Do packs include separate loop/intro/outro files, or single looping files?
2. **Transition zones:** Are there natural break points for phase 2 musical shifts?
3. **Licensing:** Confirm CCO or CC-BY attribution (both appear free, but verify)
4. **Audio format:** Prefer OGG Vorbis for web (smaller than MP3, better compression). Check what formats are included.

## Next Steps

1. Download and audit all three packs
2. Extract BPM, length, format info for each track
3. Select 4-5 best tracks matching boss themes
4. Create music.ts metadata file
5. Implement AudioManager for beat-sync queries
6. Test sync feel in balance bot runs
7. Integrate with boss phase2 transitions
