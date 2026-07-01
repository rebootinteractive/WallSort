// Tiny time-based tween system. No deps. Driven each frame from the RAF loop.

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: Ease = (t) => t * t * t;
export const easeInOutCubic: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Anim {
  /** Advance by `dtMs`; return true when finished. */
  update(dtMs: number): boolean;
}

export class Tween implements Anim {
  private elapsed = 0;
  constructor(
    private dur: number,
    private onUpdate: (p: number) => void,
    private ease: Ease = easeOutCubic,
    private onDone?: () => void,
    private delay = 0,
  ) {}

  update(dt: number): boolean {
    this.elapsed += dt;
    if (this.elapsed < this.delay) return false;
    const raw = Math.min(1, (this.elapsed - this.delay) / this.dur);
    this.onUpdate(this.ease(raw));
    if (raw >= 1) {
      this.onDone?.();
      return true;
    }
    return false;
  }
}

/** Holds and advances active animations. */
export class Runner {
  private anims: Anim[] = [];

  add(a: Anim): void {
    this.anims.push(a);
  }

  get busy(): boolean {
    return this.anims.length > 0;
  }

  tick(dt: number): void {
    if (this.anims.length === 0) return;
    this.anims = this.anims.filter((a) => !a.update(dt));
  }

  clear(): void {
    this.anims = [];
  }
}
