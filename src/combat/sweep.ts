/**
 * THE SWEPT SURFACE — what makes an attack yours.
 *
 * While the trigger is held, the saber records where its BASE went and where
 * its TIP went, in world space, every frame. Those two polylines bound a
 * ribbon: the actual surface the blade carved through the air. On release we
 * cut that ribbon loose and throw it.
 *
 * So the shape of the attack is not chosen from a list — it is measured. A
 * short flick throws a stubby dart. A full overhead cut throws a tall curved
 * sheet. A wrist-rolled figure-of-eight throws something with a twist in it,
 * because the blade genuinely twisted. And because the ribbon carries the tip
 * path on one edge and the base path on the other, an attack thrown from a
 * long arm-swing is bigger than one thrown from the wrist — for free, from the
 * geometry, without a single special case.
 *
 * Three details earn their keep:
 *
 *  - We trim the stroke at the front. Everything before the blade actually
 *    started moving is dropped, so a slow wind-up followed by a fast cut
 *    throws only the cut.
 *  - We resample by ARC LENGTH along the tip path, not by time. A swing that
 *    accelerates would otherwise bunch its rungs at the slow end and the
 *    energy sheet would look lumpy where the player was merely gathering.
 *  - The geometry is baked relative to its own centroid. The projectile is
 *    then a rigid body: one position, one rotation, and the swing's shape
 *    is preserved exactly as it was cut.
 */

import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { ATTACK } from '../config.js';

interface Sample {
  base: Vector3;
  tip: Vector3;
  t: number;
}

export interface SweptSurface {
  /** Ribbon geometry, centred on its own centroid. */
  geometry: BufferGeometry;
  /** World-space centroid the geometry was baked around. */
  centroid: Vector3;
  /** Rung midpoints in LOCAL space — the collision spine. */
  spine: Vector3[];
  /** Total length of the stroke along the tip path (m). */
  strokeLength: number;
  /** The blade's mean length across the stroke (m) — the ribbon's height. */
  span: number;
  /**
   * Unit normal of the surface's best-fit plane — the swing plane.
   *
   * This matters more than it sounds. A swing is a rotation, so the blade
   * sweeps a flat fan and the release tangent lies IN that fan. Thrown exactly
   * as carved, the sheet therefore flies edge-on: a razor blade travelling
   * inside its own plane, showing its target a line a couple of centimetres
   * thick. It is very nearly invisible, from both ends. ArcSystem uses this
   * normal to turn the sheet face-on before launching it — see the note there.
   */
  planeNormal: Vector3;
}

const _d = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/** How far back tipVelocity's quadratic fit reaches. */
const VELOCITY_WINDOW = 0.09;

export class SwingTrace {
  private samples: Sample[] = [];
  private lastSampleTime = -Infinity;

  /** Record the blade's pose. Cheap enough to call every frame. */
  push(base: Vector3, tip: Vector3, t: number): void {
    // Fixed minimum spacing: at 90 Hz an unthrottled trace would fill the
    // window with near-duplicate rungs and the resample would have nothing
    // extra to work with anyway.
    if (t - this.lastSampleTime < ATTACK.traceInterval) return;
    this.lastSampleTime = t;
    this.samples.push({ base: base.clone(), tip: tip.clone(), t });
    // Drop anything older than the window.
    const cutoff = t - ATTACK.traceWindow;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  /**
   * The tip's velocity AT THE MOMENT OF RELEASE — the direction the attack
   * flies.
   *
   * The obvious implementation, averaging over the last tenth of a second, is
   * wrong in a way that ruins the game: a swing is an ARC, so the average of
   * its recent velocity points somewhere back along the curve rather than
   * along the tangent you just let go of. A brisk 8 rad/s cut biases roughly
   * 25° backward, which across the arena is a miss by metres — the attack
   * visibly does not go where you swung.
   *
   * Shrinking the window trades that bias for controller noise. Instead we fit
   * a QUADRATIC through three samples and take its derivative at the newest
   * one: exact for motion with constant curvature (which is what a swing very
   * nearly is), unbiased at the endpoint, and still averaging over enough
   * samples to ignore tracker jitter. Written with the general unequal-spacing
   * Lagrange derivative because XR frame times are not uniform.
   */
  tipVelocity(out: Vector3, now: number): Vector3 {
    out.set(0, 0, 0);
    const s = this.samples;
    const p0 = s[s.length - 1];
    if (!p0) return out;

    // Anchors at the newest sample, half a window back, and a full window back.
    const pick = (age: number): Sample => {
      let best = s[0];
      let bestErr = Infinity;
      for (const c of s) {
        const err = Math.abs(now - c.t - age);
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
      return best;
    };
    const p1 = pick(VELOCITY_WINDOW * 0.5);
    const p2 = pick(VELOCITY_WINDOW);

    const t0 = p0.t;
    const t1 = p1.t;
    const t2 = p2.t;
    // Degenerate spacing (only one or two distinct samples) — fall back to the
    // plain two-point difference over whatever span actually exists.
    if (Math.abs(t0 - t1) < 1e-4 || Math.abs(t0 - t2) < 1e-4 || Math.abs(t1 - t2) < 1e-4) {
      let oldest = p0;
      for (const c of s) {
        if (now - c.t <= VELOCITY_WINDOW) {
          oldest = c;
          break;
        }
      }
      const dt = t0 - oldest.t;
      if (dt < 1e-3) return out;
      return out.copy(p0.tip).sub(oldest.tip).multiplyScalar(1 / dt);
    }

    const w0 = (2 * t0 - t1 - t2) / ((t0 - t1) * (t0 - t2));
    const w1 = (t0 - t2) / ((t1 - t0) * (t1 - t2));
    const w2 = (t0 - t1) / ((t2 - t0) * (t2 - t1));
    return out
      .copy(p0.tip)
      .multiplyScalar(w0)
      .addScaledVector(p1.tip, w1)
      .addScaledVector(p2.tip, w2);
  }

  /**
   * The stroke: the run of samples, ending at the newest, over which the blade
   * was genuinely moving. Returns the index the stroke starts at, or -1 when
   * there is no stroke worth throwing.
   */
  private strokeStart(): number {
    const s = this.samples;
    if (s.length < 3) return -1;
    let i = s.length - 1;
    while (i > 0) {
      const dt = s[i].t - s[i - 1].t;
      if (dt <= 1e-4) {
        i--;
        continue;
      }
      const speed = _d.copy(s[i].tip).sub(s[i - 1].tip).length() / dt;
      if (speed < ATTACK.traceMinSpeed) break;
      i--;
    }
    // Need at least three rungs of real movement to have a surface at all.
    return s.length - i >= 3 ? i : -1;
  }

  /**
   * Build the ribbon. Returns null when the swing was too short, too slow, or
   * too still to have carved anything.
   */
  build(segments = ATTACK.ribbonSegments): SweptSurface | null {
    const start = this.strokeStart();
    if (start < 0) return null;
    const stroke = this.samples.slice(start);

    // --- Arc length along the tip path, for an even resample. ---
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < stroke.length; i++) {
      total += _d.copy(stroke[i].tip).sub(stroke[i - 1].tip).length();
      cum.push(total);
    }
    if (total < 0.08) return null; // barely moved — nothing to throw

    const rungBase: Vector3[] = [];
    const rungTip: Vector3[] = [];
    let cursor = 1;
    for (let r = 0; r <= segments; r++) {
      const want = (r / segments) * total;
      while (cursor < cum.length - 1 && cum[cursor] < want) cursor++;
      const lo = cursor - 1;
      const span = cum[cursor] - cum[lo];
      const f = span > 1e-6 ? (want - cum[lo]) / span : 0;
      rungBase.push(_a.copy(stroke[lo].base).lerp(stroke[cursor].base, f).clone());
      rungTip.push(_b.copy(stroke[lo].tip).lerp(stroke[cursor].tip, f).clone());
    }

    // --- Centroid, so the thrown sheet is a rigid body about its own middle.
    const centroid = new Vector3();
    for (let r = 0; r <= segments; r++) centroid.add(rungBase[r]).add(rungTip[r]);
    centroid.multiplyScalar(1 / ((segments + 1) * 2));

    // --- Bake the quad strip. uv.x runs along the stroke (0 = where the cut
    // began, 1 = where it ended), uv.y across the blade (0 = base, 1 = tip).
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const spine: Vector3[] = [];
    let span = 0;
    for (let r = 0; r <= segments; r++) {
      const u = r / segments;
      const b = rungBase[r];
      const tp = rungTip[r];
      pos.push(b.x - centroid.x, b.y - centroid.y, b.z - centroid.z);
      uv.push(u, 0);
      pos.push(tp.x - centroid.x, tp.y - centroid.y, tp.z - centroid.z);
      uv.push(u, 1);
      span += b.distanceTo(tp);
      spine.push(
        new Vector3(
          (b.x + tp.x) / 2 - centroid.x,
          (b.y + tp.y) / 2 - centroid.y,
          (b.z + tp.z) / 2 - centroid.z,
        ),
      );
    }
    for (let r = 0; r < segments; r++) {
      const a = r * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    // The swing plane: across the blade (base → tip) crossed with along the
    // stroke (start → end). Taken at the middle rung, where a curved swing is
    // most representative of the whole.
    const mid = segments >> 1;
    const planeNormal = new Vector3()
      .copy(rungTip[mid])
      .sub(rungBase[mid])
      .cross(_d.copy(spine[spine.length - 1]).sub(spine[0]));
    if (planeNormal.lengthSq() < 1e-8) planeNormal.set(0, 1, 0);
    else planeNormal.normalize();

    return { geometry, centroid, spine, strokeLength: total, span: span / (segments + 1), planeNormal };
  }

  reset(): void {
    this.samples.length = 0;
    this.lastSampleTime = -Infinity;
  }

  get length(): number {
    return this.samples.length;
  }
}
