/** Particle effects for weather and atmosphere (rain, dust, etc.). */

export interface ParticleConfig {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life: number; // ms
  color?: number;
  alpha?: number;
  scale?: number;
}

export class Particle {
  age: number = 0;
  alive: boolean = true;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    public life: number,
    public color: number,
    public alpha: number,
    public scale: number,
  ) {}

  update(dt: number) {
    this.age += dt;
    this.x += this.vx * (dt / 1000);
    this.y += this.vy * (dt / 1000);
    if (this.age >= this.life) this.alive = false;
  }

  getAlpha(): number {
    const frac = this.age / this.life;
    return this.alpha * (1 - frac); // fade out
  }
}

export class ParticleSystem {
  particles: Particle[] = [];

  spawn(config: ParticleConfig, count: number = 1) {
    for (let i = 0; i < count; i++) {
      const vx = (config.vx ?? 0) + (Math.random() - 0.5) * 20;
      const vy = (config.vy ?? 0) + (Math.random() - 0.5) * 10;
      const x = config.x + (Math.random() - 0.5) * 40;
      const y = config.y + (Math.random() - 0.5) * 40;
      const p = new Particle(x, y, vx, vy, config.life, config.color ?? 0x8899ff, config.alpha ?? 0.6, config.scale ?? 1);
      this.particles.push(p);
    }
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.update(dt);
    }
    this.particles = this.particles.filter((p) => p.alive);
  }

  clear() {
    this.particles = [];
  }
}

export class WeatherEmitter {
  private particles: ParticleSystem;
  private lastSpawnMs: number = 0;
  private spawnIntervalMs: number = 50; // spawn every 50ms

  constructor(
    private scene: Phaser.Scene,
    public kind: "rain" | "dust" | "ash",
    private x: number,
    private y: number,
    private width: number,
    private height: number,
  ) {
    this.particles = new ParticleSystem();
  }

  update(now: number) {
    const dt = now - this.lastSpawnMs;
    if (dt >= this.spawnIntervalMs) {
      this.spawnParticles();
      this.lastSpawnMs = now;
    }
    this.particles.update(dt);
  }

  private spawnParticles() {
    const spawnX = this.x + Math.random() * this.width;
    const spawnY = this.y - this.height; // spawn at top

    switch (this.kind) {
      case "rain":
        // Rain particles fall straight down with slight wind
        this.particles.spawn({
          x: spawnX,
          y: spawnY,
          vx: -60 + Math.random() * 20, // wind effect
          vy: 400, // fast fall
          life: 1500,
          color: 0x6699dd,
          alpha: 0.5,
          scale: 0.5,
        }, 3);
        break;

      case "dust":
        // Dust swirls with more horizontal movement
        this.particles.spawn({
          x: spawnX,
          y: spawnY,
          vx: Math.random() * 100 - 50,
          vy: Math.random() * 100 - 50,
          life: 2000,
          color: 0xccaa77,
          alpha: 0.4,
          scale: 0.8,
        }, 2);
        break;

      case "ash":
        // Ash drifts slowly
        this.particles.spawn({
          x: spawnX,
          y: spawnY,
          vx: Math.random() * 40 - 20,
          vy: 50,
          life: 3000,
          color: 0x555555,
          alpha: 0.3,
          scale: 1,
        }, 1);
        break;
    }
  }

  getParticles() {
    return this.particles.particles;
  }

  clear() {
    this.particles.clear();
  }
}
