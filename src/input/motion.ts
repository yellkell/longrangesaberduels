/**
 * Hand motion: the two derivatives everything else in the game is built on.
 *
 * `HandMotion` smooths a world-space position into a velocity and an
 * acceleration. The acceleration drives the liquid's slosh; the velocity
 * drives the shake detector and, at the tip, the thrown attack.
 *
 * `ShakeDetector` is how you reload. It counts REVERSALS — the moment the hand
 * flips direction while still moving fast — because that is the one signal
 * that separates a deliberate shake from a swing, a walk, or a hand simply
 * held out in front of you. A swing is fast but goes one way. Walking is
 * slow. A shake is fast AND repeatedly changes its mind, which is exactly what
 * you do to a bottle you want mixed.
 *
 * Rhythm is rewarded: reversals that keep arriving inside SHAKE.comboWindow
 * build a multiplier, so two committed seconds of wrist-shaking refills far
 * faster than the same count of lazy waves. Let the rhythm lapse and the
 * multiplier bleeds away.
 */

import { Vector3 } from 'three';
import { SHAKE } from '../config.js';

const _v = new Vector3();

export class HandMotion {
  readonly vel = new Vector3();
  readonly accel = new Vector3();
  private readonly prevPos = new Vector3();
  private readonly prevVel = new Vector3();
  private primed = false;

  update(pos: Vector3, dt: number): void {
    if (!this.primed || dt <= 0) {
      this.prevPos.copy(pos);
      this.primed = true;
      return;
    }
    _v.copy(pos).sub(this.prevPos).divideScalar(dt);
    // Smooth both derivatives — controller pose jitter would otherwise read as
    // constant slosh energy and as a permanent, free reload.
    this.vel.lerp(_v, 0.5);
    this.accel.lerp(_v.sub(this.prevVel).divideScalar(dt), 0.25);
    this.prevVel.copy(this.vel);
    this.prevPos.copy(pos);
  }

  reset(): void {
    this.vel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.primed = false;
  }
}

export class ShakeDetector {
  /** Rhythm multiplier, 1..SHAKE.comboMax. */
  combo = 1;
  /** 0..1, decayed — drives the shake-flare on the glass. */
  intensity = 0;

  private readonly lastDir = new Vector3();
  private hasDir = false;
  private lastShakeAt = -Infinity;

  /**
   * Feed the hand's smoothed velocity. Returns the fill to ADD this frame
   * (0 on most frames — refills arrive as discrete shakes, not a trickle).
   */
  update(vel: Vector3, now: number, dt: number): number {
    this.intensity = Math.max(0, this.intensity - dt * 2.6);

    // The combo only survives while the shakes keep coming.
    if (now - this.lastShakeAt > SHAKE.comboWindow) {
      this.combo = Math.max(1, this.combo - SHAKE.comboDecay * dt);
    }

    const speed = vel.length();
    if (speed < SHAKE.minSpeed) {
      // Too slow to be a shake — but don't forget which way we were going, or
      // every pause would manufacture a free reversal on the way out.
      return 0;
    }

    _v.copy(vel).divideScalar(speed);
    if (!this.hasDir) {
      this.lastDir.copy(_v);
      this.hasDir = true;
      return 0;
    }

    const dot = _v.dot(this.lastDir);
    if (dot > SHAKE.reversalDot) {
      // Still travelling roughly the same way: track the drift so a curved
      // shake still registers its turn-around at the end of each stroke.
      this.lastDir.copy(_v);
      return 0;
    }
    if (now - this.lastShakeAt < SHAKE.minInterval) return 0;

    // A reversal. Bank it.
    this.lastDir.copy(_v);
    this.lastShakeAt = now;
    this.combo = Math.min(SHAKE.comboMax, this.combo + SHAKE.comboGainPerShake);
    this.intensity = 1;
    return SHAKE.fillPerShake * this.combo;
  }

  reset(): void {
    this.combo = 1;
    this.intensity = 0;
    this.hasDir = false;
    this.lastShakeAt = -Infinity;
  }
}
