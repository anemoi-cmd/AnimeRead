interface Streak {
  x: number;
  y: number;
  layer: number;
  speed: number;
  length: number;
  opacity: number;
}
interface GlassDrop {
  x: number;
  y: number;
  radius: number;
  speed: number;
  hold: number;
}

/** Independent Canvas renderer. References: mubaidr/rainyday.js (size-dependent
 * gravity and merging) and codrops/RainEffect (droplet sprites and trails).
 * No upstream source, shaders or textures are copied into the application. */
export class RainField {
  private width = 1;
  private height = 1;
  private strength = 0.5;
  private streaks: Streak[] = [];
  private drops: GlassDrop[] = [];
  private sprites = [0, 1, 2].map((layer) => this.streakSprite(layer));
  private glass = this.glassSprite();

  constructor(
    private canvas: HTMLCanvasElement,
    private context: CanvasRenderingContext2D,
  ) {}

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const scale = Math.min(
      dpr || 1,
      2,
      Math.sqrt(3_000_000 / (this.width * this.height)),
    );
    this.canvas.width = Math.max(1, Math.floor(this.width * scale));
    this.canvas.height = Math.max(1, Math.floor(this.height * scale));
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.setStrength(this.strength);
  }

  setStrength(strength: number) {
    this.strength = Math.max(0, Math.min(1, strength));
    const area = Math.sqrt((this.width * this.height) / 900000);
    const count = Math.min(320, Math.round((75 + this.strength * 175) * area));
    while (this.streaks.length < count) this.streaks.push(this.newStreak());
    this.streaks.length = count;
    const glassCount = Math.min(
      40,
      Math.round((10 + this.strength * 16) * area),
    );
    while (this.drops.length < glassCount) this.drops.push(this.newDrop());
    this.drops.length = glassCount;
  }

  draw(time: number, seconds: number) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    const wind = 20 + Math.sin(time / 6700) * 16 + Math.sin(time / 1700) * 5;
    for (const streak of this.streaks) {
      const drift = wind * (0.35 + streak.layer * 0.3);
      streak.x += (drift * seconds) / this.width;
      streak.y += (streak.speed * seconds) / this.height;
      if (streak.y > 1.06 || streak.x > 1.03) {
        streak.y = -0.06 - Math.random() * 0.1;
        streak.x = Math.random() * 1.05 - 0.05;
      }
      ctx.save();
      ctx.translate(streak.x * this.width, streak.y * this.height);
      ctx.rotate(-Math.atan2(drift, streak.speed));
      ctx.globalAlpha = streak.opacity * (0.65 + this.strength * 0.45);
      ctx.drawImage(
        this.sprites[streak.layer],
        -4,
        -streak.length,
        8,
        streak.length,
      );
      ctx.restore();
    }
    for (const drop of this.drops) {
      drop.hold -= seconds;
      if (drop.hold < 0 && drop.radius > 3) {
        const terminal = (drop.radius - 2) ** 1.6 * 5;
        drop.speed += (terminal - drop.speed) * Math.min(1, seconds * 1.5);
      }
      drop.y += (drop.speed * seconds) / this.height;
      drop.x += (wind * drop.speed * seconds) / (this.width * 1300);
      if (drop.y > 1.05) Object.assign(drop, this.newDrop(-0.025));
    }
    this.mergeDrops();
    ctx.lineCap = "round";
    for (const drop of this.drops) {
      const x = drop.x * this.width,
        y = drop.y * this.height;
      const radius = drop.radius;
      if (drop.speed > 10) {
        ctx.globalAlpha = 0.09 + this.strength * 0.05;
        ctx.strokeStyle = "rgb(135,152,160)";
        ctx.lineWidth = Math.max(0.6, radius * 0.23);
        ctx.beginPath();
        ctx.moveTo(x, y - radius * (2 + Math.min(2, drop.speed / 70)));
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.55 + this.strength * 0.2;
      const stretch = 1 + Math.min(0.5, drop.speed / 180);
      ctx.drawImage(
        this.glass,
        x - radius,
        y - radius * stretch,
        radius * 2,
        radius * 2.4 * stretch,
      );
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.streaks.length = this.drops.length = 0;
    this.canvas.width = this.canvas.height = 1;
  }

  private newStreak(): Streak {
    const layer = Math.floor(Math.random() * 3);
    return {
      x: Math.random(),
      y: Math.random(),
      layer,
      speed: 220 + layer * 220 + Math.random() * 180,
      length: 7 + layer * 10 + Math.random() * 14,
      opacity: 0.4 + layer * 0.16 + Math.random() * 0.15,
    };
  }
  private newDrop(y = Math.random()): GlassDrop {
    return {
      x: Math.random(),
      y,
      radius: 1.8 + Math.random() ** 2 * 5.2,
      speed: 0,
      hold: 1 + Math.random() * 5,
    };
  }
  private mergeDrops() {
    // At most 40 glass drops: bounded pair checks, with no growing trail nodes.
    for (let index = 0; index < this.drops.length; index++) {
      const drop = this.drops[index];
      if (drop.speed < 1) continue;
      for (let other = index + 1; other < this.drops.length; other++) {
        const next = this.drops[other];
        const distance = Math.hypot(
          (drop.x - next.x) * this.width,
          (drop.y - next.y) * this.height,
        );
        if (distance > (drop.radius + next.radius) * 0.7) continue;
        drop.radius = Math.min(8, Math.hypot(drop.radius, next.radius));
        drop.speed += next.radius * 2;
        Object.assign(next, this.newDrop(-0.025));
      }
    }
  }
  private streakSprite(layer: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 96);
    gradient.addColorStop(0, "rgba(145,165,177,0)");
    gradient.addColorStop(0.55, `rgba(123,147,163,${0.14 + layer * 0.05})`);
    gradient.addColorStop(0.9, `rgba(137,151,159,${0.55 + layer * 0.13})`);
    gradient.addColorStop(1, "rgba(235,243,248,0.08)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.3 + layer * 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(6, 1);
    ctx.lineTo(6, 94);
    ctx.stroke();
    return canvas;
  }
  private glassSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.ellipse(32, 40, 24, 31, 0, 0, Math.PI * 2);
    ctx.clip();
    const gradient = ctx.createRadialGradient(24, 27, 2, 33, 42, 33);
    gradient.addColorStop(0, "rgba(245,252,255,0.46)");
    gradient.addColorStop(0.32, "rgba(206,222,230,0.025)");
    gradient.addColorStop(0.72, "rgba(83,108,121,0.03)");
    gradient.addColorStop(1, "rgba(37,63,80,0.32)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 80);
    ctx.strokeStyle = "rgba(244,252,255,0.46)";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(32, 40, 21, 28, 0, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
    return canvas;
  }
}
