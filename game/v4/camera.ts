/** Camera effects: shake on hits, punch on key moments, zoom on kills. */

export interface ShakeConfig {
  durationMs: number;
  intensity: number; // max offset in pixels
  frequency?: number; // hz, defaults to 15
}

export interface PunchConfig {
  durationMs: number;
  strength: number; // 0-1, how far to move
  direction: { x: number; y: number }; // normalized
}

export class CameraEffects {
  private shakes: (ShakeConfig & { startedAt: number })[] = [];
  private punches: (PunchConfig & { startedAt: number })[] = [];
  private baseX: number = 0;
  private baseY: number = 0;
  private currentNow: number = 0;

  constructor(private scene: Phaser.Scene) {}

  /** Add screen shake (rapid vibration) */
  shake(config: ShakeConfig) {
    this.shakes.push({ ...config, startedAt: this.currentNow });
  }

  /** Add screen punch (quick directional move) */
  punch(config: PunchConfig) {
    this.punches.push({ ...config, startedAt: this.currentNow });
  }

  /** Update camera position based on active effects */
  update(now: number) {
    this.currentNow = now;
    let offsetX = 0;
    let offsetY = 0;

    // Process shakes
    this.shakes = this.shakes.filter((s) => {
      const elapsed = now - s.startedAt;

      if (elapsed >= s.durationMs) return false;

      const freq = s.frequency ?? 15;
      const phase = (elapsed / 1000) * freq * Math.PI * 2;
      const intensity = s.intensity * (1 - elapsed / s.durationMs); // fade out
      offsetX += Math.sin(phase) * intensity;
      offsetY += Math.cos(phase * 0.7) * intensity;

      return true;
    });

    // Process punches
    this.punches = this.punches.filter((p) => {
      const elapsed = now - p.startedAt;

      if (elapsed >= p.durationMs) return false;

      const easing = 1 - elapsed / p.durationMs; // quadratic ease-out
      const distance = p.strength * easing;
      offsetX += p.direction.x * distance * 20; // 20px per strength unit
      offsetY += p.direction.y * distance * 20;

      return true;
    });

    // Apply camera offset
    this.scene.cameras.main.setScroll(this.baseX - offsetX, this.baseY - offsetY);
  }

  /** Shorthand: small shake on normal hits */
  hitShake() {
    this.shake({ durationMs: 80, intensity: 3 });
  }

  /** Shorthand: medium shake on parries */
  parryShake() {
    this.shake({ durationMs: 120, intensity: 5, frequency: 20 });
  }

  /** Shorthand: punch toward a direction (knockback feel) */
  punchToward(x: number, y: number, distance: number = 0.5) {
    const mag = Math.hypot(x, y) || 1;
    this.punch({ durationMs: 150, strength: distance, direction: { x: x / mag, y: y / mag } });
  }

  clear() {
    this.shakes = [];
    this.punches = [];
  }
}
