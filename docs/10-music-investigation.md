# Music Integration Investigation & Audition Guide

**Phase**: v4 ARENA Music Integration (Phase 7l)  
**Status**: Audition planning + track selection  
**Estimated Time**: 3–4 hours (audition, select, integrate, test)

---

## Target Packs & Sourcing

### Pack 1: Fantasy RPG Soundtrack by alkakrab
**URL**: https://alkakrab.itch.io/  
**License**: Free, credit appreciated  
**Style**: Fantasy RPG ambient/exploration + action tracks  
**Format**: MP3, WAV, Ogg (236 MB zip)  
**Characteristics**: Pixel-style, original human-made compositions  
**Best for**: Bladekeeper (crafted, strategic), Mauler (heavy defense)  
**Notes**: Highly rated (5.0 from 32+ ratings), widely used in game jams

### Pack 2: 12-Track Pixel RPG Music Pack by alkakrab
**URL**: https://alkakrab.itch.io/free-12-tracks-pixel-rpg-game-music-pack  
**License**: Free for commercial use, credit not required  
**Style**: Pixel RPG action + exploration (12 distinct tracks)  
**Format**: MP3, WAV, Ogg (236 MB zip)  
**Characteristics**: Original compositions, no AI, consistent pixel aesthetic  
**Best for**: Hashashin (wind, swift), Echo (mirror/reflection)  
**Notes**: Extremely popular (5.0 from 35+ ratings), used in Brackeys Game Jam

### Pack 3: Eternity Metal/Sci-Fi Music Pack by davidkbd
**URL**: https://davidkbd.itch.io/eternity-metal-scfi-music-pack  
**License**: CC BY 4.0 (requires attribution)  
**Style**: Djent/metal-inspired action music (Doom Eternal vibe)  
**Format**: MP3, WAV (12 tracks + looping + one-shot versions)  
**Price**: Pay-what-you-want ($6.00 suggested)  
**Characteristics**: High-energy, cinematic metal, CC 4.0 licensed  
**Best for**: High-intensity boss phases, deathblow moments  
**Notes**: 5.0 rating from 30+ ratings, Celldweller/Tesseract inspired

---

## Audition Workflow

### Step 1: Download & Organize
```bash
# Create music workspace
mkdir -p /tmp/music-audit/{fantasy1,fantasy2,eternity}

# Download and extract packs:
# 1. Fantasy RPG Soundtrack → fantasy1/
# 2. 12-Track Pixel RPG → fantasy2/
# 3. Eternity Metal Pack → eternity/

# Organize by type:
# - fantasy1/action/ (combat tracks)
# - fantasy1/ambient/ (exploration tracks)
# - fantasy2/tracks/ (all 12 distinct tracks)
# - eternity/action/ (high-energy tracks)
# - eternity/ambient/ (tension/boss entrance tracks)
```

### Step 2: BPM Detection & Metadata Extraction
For each candidate track:
1. **Identify BPM**: Use Audacity or online BPM analyzer (e.g., moises.ai, dbx.app)
2. **Measure Loop Point**: Find where the track naturally loops (end-to-beginning seamless)
3. **Duration**: Total track length (in ms)
4. **Character**: Describe mood/intensity/instrumentation
5. **Boss Fit**: Evaluate match for each boss personality

**Target BPM Range**: 110–140 BPM (matches prior Duel game choreography baseline of 90–140)

---

## Boss-Specific Track Selection Criteria

### Bladekeeper (Metal Bladekeeper)
- **Personality**: Crafted, blade-focused, measured combos, predictable patterns
- **BPM Target**: 120–130 (moderate, focused)
- **Characteristics**: Clean, sword-centric instrumentation, steady rhythm
- **Desired Feel**: Duel-like, fencer's dance, deliberate
- **Candidates to Prioritize**:
  - [ ] Fantasy RPG "Blade/Combat" or "Duel" theme
  - [ ] Pixel RPG "Combat 1" or "Boss Theme"
  - [ ] Eternity "Action 1" (if melodic enough)

### Mauler (Crystal Mauler)
- **Personality**: Heavy, defensive, tanking, phase-2 aggressive rush
- **BPM Target**: 100–120 (heavier, slower, more powerful)
- **Characteristics**: Heavy orchestration, defensive stance vibes, crushing beats
- **Desired Feel**: Siege-like, monolithic, overpowering
- **Candidates to Prioritize**:
  - [ ] Fantasy RPG "Heavy Boss" or "Fortress" theme
  - [ ] Eternity "Heavy Metal" or "Ambient Action"
  - [ ] Pixel RPG "Heavy" or "Boss Phase 2"

### Hashashin (Wind Hashashin)
- **Personality**: Swift, wind-based, high-mobility, spins/rushes, dances
- **BPM Target**: 130–140 (faster, dancer-like, energetic)
- **Characteristics**: Percussive, rhythmic, wind/air elements, nimble
- **Desired Feel**: Chase sequence, acrobatic, unpredictable tempo
- **Candidates to Prioritize**:
  - [ ] Fantasy RPG "Wind" or "Swift" theme
  - [ ] Pixel RPG "Chase" or "Quick Combat"
  - [ ] Eternity "Fast Action" or "Percussion-heavy"

### Echo (Mirror)
- **Personality**: Reflective, adaptable, learns player's style, phase-2 chaotic/glitchy
- **BPM Target**: 120–135 (versatile, can shift, evolving energy)
- **Characteristics**: Evolving, mirroring energy, build/release arcs, phase-2 distortion
- **Desired Feel**: Cinematic, learning/adaptation theme, final-boss epic
- **Candidates to Prioritize**:
  - [ ] Fantasy RPG "Adaptive" or "Rising Action" theme
  - [ ] Eternity "Cinematic" or "Evolving" theme
  - [ ] Pixel RPG "Final Boss" or "Epic" theme

---

## Track Selection & Metadata Template

Once auditioned, document each selected track:

```
Boss: [Name]
Track Title: [Official Name]
Artist: [alkakrab | davidkbd]
Pack: [Fantasy 1 | Pixel 12 | Eternity]
BPM: [Integer, e.g., 120]
Loop Point (ms): [When track repeats seamlessly, e.g., 8000]
Total Length (ms): [e.g., 16000]
Intensity (1-10): [Low: ambient/intro | High: full-energy boss]
Character: [Brief description: e.g., "Clean sword clashes, focused energy"]
License: [Free | CC BY 4.0]
Attribution Required: [Yes | No]
Audio Format: [MP3 | WAV | OGG]
Notes: [Any caveats, phase-2 suitability, loops per fight, etc.]
```

---

## Integration Checklist (After Track Selection)

- [ ] **1. Move tracks to `public/music/`**
  - Copy selected MP3/WAV files to `public/music/boss-{name}.mp3`
  - Verify all file paths match `game/v4/music.ts` entries

- [ ] **2. Update `game/v4/music.ts`**
  - Replace placeholder MUSIC record with real data
  - Set BPM, loop point, length for each boss track
  - Confirm all file paths resolve

- [ ] **3. Wire AudioManager Playback**
  - Call `AudioManager.play(trackId)` on boss enter (in ArenaScene.startBoss ~line 1000)
  - Test track loops correctly at loop-point boundary
  - Verify fade-in (500ms) and fade-out (500ms) on boss defeat
  - Check music volume doesn't drown combat SFX

- [ ] **4. Test Beat-Sync Queries**
  - Open dev console, call `audioManager.getBeatPhase()`
  - Verify BPM calculations are correct (beat duration = 60000 / BPM ms)
  - Test `isNearBeat()` for attack alignment (optional)
  - Confirm loop repeats seamlessly

- [ ] **5. Credits Update**
  - Add track titles and artists to README.md Credits section
  - Ensure CC BY 4.0 attribution visible (for davidkbd tracks)
  - Format: `"[Track Title]" by [Artist] from [Pack Name]`

---

## File Integration Points

### game/v4/music.ts
Current placeholder structure:
```typescript
export const MUSIC: Record<string, TrackMeta> = {
  bladekeeper: {
    bpm: 120,
    length: 16000,
    loopPoint: 8000,
    path: '/music/boss-bladekeeper.mp3',
    contexts: ['boss-bladekeeper'],
  },
  // ... mauler, hashashin, echo
};
```

Will be updated with real data after audition.

### game/v4/ArenaScene.ts
Integration point (around line 1000 in startBoss):
```typescript
if (this.audioManager) {
  const trackId = def.name.toLowerCase() // e.g., 'bladekeeper'
  this.audioManager.play(trackId)
}
```

### README.md Credits
Will add under v4 ARENA section:
```markdown
**Music Tracks (Boss Fights)**
- Bladekeeper: "[Track Title]" by alkakrab ([Pack Name])
- Mauler: "[Track Title]" by alkakrab ([Pack Name])
- Hashashin: "[Track Title]" by alkakrab ([Pack Name])
- Echo: "[Track Title]" by [Artist] ([Pack Name]) [CC BY 4.0]
```

---

## Decision Criteria for Track Selection

1. **BPM Appropriateness**: Matches boss personality
2. **Loop Seamlessness**: No click/gap at loop boundary
3. **Duration**: Reasonable fight length (8–16 second loop, 30–60s total)
4. **Instrumentation**: Clearly distinguishable from other bosses
5. **Intensity Curve**: Handles phase 2 escalation well
6. **Mixing**: Clear levels, no distortion
7. **Attribution**: License respected

---

## Timeline

- **Hour 1**: Download, extract, organize all packs (three folders, 20+ tracks to sort)
- **Hour 1**: Analyze BPM, loop points, duration for 15–20 candidates
- **Hour 1**: Audition rankings per boss, narrow to 4 final selections
- **Hour 1**: Move files to `public/music/`, update metadata, test, commit

**Total**: 3–4 hours (or compress to 2–2.5 with parallel listening)

---

## Resources & Tools

**BPM Detection**:
- [Audacity](https://www.audacityteam.org/) (free, desktop) - manual BPM tapping
- [moises.ai](https://moises.ai/) (free, web) - AI-powered BPM detection
- [dbx.app](https://www.dbx.app/) (free, web) - instant BPM analysis
- Adobe Audition (paid) - professional tempo analysis

**Loop Point Identification**:
- Audacity waveform view (visual + audio verification)
- VLC media player (loop/repeat settings to verify seamlessness)

**Audio Testing**:
- Chrome DevTools (muted audio, volume inspector)
- Phaser 3 Audio API documentation (play, stop, fade)

---

**Current Status**: Pack research complete, ready for audition  
**Next Action**: Download and organize packs, begin BPM analysis  
**Estimated Completion**: 3–4 hours hands-on work this session
