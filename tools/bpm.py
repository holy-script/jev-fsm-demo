#!/usr/bin/env python3
"""Estimate tempo AND beat phase of audio files by fitting a beat grid to the onset strength of the whole track.

Usage: python3 tools/bpm.py file1 file2 ...   (add --json to print machine-readable lines)

For every candidate tempo (60-180 BPM, 0.05 steps) and phase, the score is the summed onset strength at the predicted beat times;
the best (bpm, phase) wins. `conf` compares the winner with the median candidate, so values above ~2 mean a clear steady pulse.
Output: bpm, phase (seconds from the start of the file to the first beat), and a beat-count check against the track length.
"""
import json, os, subprocess, sys
import numpy as np

SR, HOP, N = 22050, 128, 1024


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    if len(x) < SR * 5:
        raise SystemExit(f"could not decode {path}")
    return x


def onset_env(x):
    win = np.hanning(N)
    frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP]
    spec = np.abs(np.fft.rfft(frames * win, axis=1))
    low = np.log1p(spec[:, 1:120])                  # roughly 20 Hz - 2.5 kHz: kicks, snares, plucks
    flux = np.maximum(0, np.diff(low, axis=0)).sum(axis=1)
    flux = flux - np.convolve(flux, np.ones(40) / 40, "same")
    flux = np.maximum(flux, 0)
    return flux / (flux.max() + 1e-9), SR / HOP


def fit(env, fps):
    n = len(env)
    best = (0.0, 0.0, -1.0)
    scores = []
    t = np.arange(n) / fps
    for bpm in np.arange(60.0, 180.0, 0.05):
        period = 60.0 / bpm
        nb = int((n / fps) // period) - 1
        if nb < 8:
            continue
        # phase scan in 8 ms steps
        phases = np.arange(0, period, 0.008)
        beats = phases[:, None] + period * np.arange(nb)[None, :]
        idx = np.clip((beats * fps).astype(int), 0, n - 1)
        sc = env[idx].mean(axis=1)
        k = int(np.argmax(sc))
        scores.append(sc[k])
        if sc[k] > best[2]:
            best = (bpm, phases[k], sc[k])
    return best, float(np.median(scores))


def analyse(path):
    x = load(path)
    env, fps = onset_env(x)
    (bpm, phase, sc), med = fit(env, fps)
    return {"file": os.path.basename(path), "bpm": round(float(bpm), 2), "phase": round(float(phase), 3), "conf": round(sc / (med + 1e-9), 2), "seconds": round(len(x) / SR, 1)}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for f in args:
        r = analyse(f)
        if "--json" in sys.argv:
            print(json.dumps(r))
        else:
            beats = r["seconds"] / (60 / r["bpm"])
            print(f"{r['bpm']:7.2f} BPM  phase {r['phase']:5.3f}s  conf {r['conf']:4.2f}  {r['seconds']:6.1f}s = {beats:6.1f} beats   {r['file']}")
