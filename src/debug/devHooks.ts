/**
 * Dev-only inspection hooks, hung on `window.LRSD`.
 *
 * A headset has no console, and the desktop WebXR emulator cannot swing a
 * controller anywhere near hard enough to throw a real attack — the minimum
 * swing speed is about two metres per second at the blade's tip, and dragging
 * a mouse does not come close. So the whole swing → surface → flight →
 * collision → damage chain would be untestable without hardware unless
 * something could drive it synthetically. This is that something.
 *
 * `testSwing` is careful to be an HONEST stand-in: it does not fabricate a
 * projectile, it feeds a genuine arm-sweep into the same SwingTrace the real
 * hands use and lets the ordinary release path do the rest. If the trace, the
 * ribbon builder or the arc bus break, this breaks with them, which is the
 * only reason it is worth having.
 *
 * The whole module is behind `import.meta.env.DEV` at the call site, so it is
 * tree-shaken out of production builds.
 */

import type { World } from '@iwsdk/core';
import { Vector3 } from 'three';
import { bodies } from '../combat/bodies.js';
import { duel } from '../combat/matchState.js';
import { arcQueue, requestArc } from '../combat/arcBus.js';
import { SwingTrace } from '../combat/sweep.js';
import { ShakeDetector } from '../input/motion.js';
import { ArcSystem } from '../systems/ArcSystem.js';
import { RivalSystem } from '../systems/RivalSystem.js';
import { SaberSystem } from '../systems/SaberSystem.js';
import { PALETTE } from '../config.js';

type Vec3Tuple = [number, number, number];

export function installDevHooks(world: World): void {
  const arcSystem = (): ArcSystem | undefined =>
    world.getSystems().find((s) => s instanceof ArcSystem) as ArcSystem | undefined;
  const saberSystem = (): SaberSystem | undefined =>
    world.getSystems().find((s) => s instanceof SaberSystem) as SaberSystem | undefined;

  /**
   * Carve a synthetic slash and release it.
   *
   * The arm sweeps through the plane spanned by `dir` and a perpendicular
   * `rise`, ENDING WITH THE ARM ALONG `rise` rather than along `dir`. That is
   * not a quirk of the test: a rotation's velocity is perpendicular to its own
   * radius, so the blade has to be square to the throw at the instant of
   * release. Aim the arm at the target and the attack leaves at right angles
   * to where you meant.
   */
  function testSwing(
    dir: Vec3Tuple = [0, 0, -1],
    charge = 1,
    radius = 0.9,
    speed = 12,
    owner: 0 | 1 = 0,
    from: Vec3Tuple = [0, 1.4, 0],
  ) {
    const trace = new SwingTrace();
    const d = new Vector3(...dir).normalize();
    const side = new Vector3(0, 1, 0).cross(d);
    const rise = (side.lengthSq() < 1e-6 ? new Vector3(1, 0, 0) : side.clone().cross(d)).normalize();
    const origin = new Vector3(...from);

    const STEPS = 26;
    const SPAN = Math.PI * 0.55;
    let t = 0;
    for (let i = 0; i <= STEPS; i++) {
      // arm(a) = rise·cos a + d·sin a, so d(arm)/da = −rise·sin a + d·cos a,
      // which at the final a = 0 is exactly d.
      const a = -SPAN + (i / STEPS) * SPAN;
      const arm = new Vector3().addScaledVector(rise, Math.cos(a)).addScaledVector(d, Math.sin(a)).normalize();
      const base = origin.clone().addScaledVector(arm, radius - 0.78);
      const tip = origin.clone().addScaledVector(arm, radius);
      t += 0.014;
      trace.push(base, tip, t);
    }

    const surface = trace.build();
    const vel = trace.tipVelocity(new Vector3(), t);
    const aimError = +((Math.acos(Math.min(1, Math.max(-1, vel.clone().normalize().dot(d)))) * 180) / Math.PI).toFixed(1);
    if (!surface) return { thrown: false, speed: +vel.length().toFixed(2), aimErrorDeg: aimError };

    requestArc({
      surface,
      dir: vel.clone().normalize(),
      speed,
      owner,
      damage: 20,
      charge,
      juice: owner === 0 ? PALETTE.plasma : PALETTE.ember,
      foam: owner === 0 ? PALETTE.plasmaFoam : PALETTE.emberFoam,
    });
    return {
      thrown: true,
      speed: +vel.length().toFixed(2),
      /** Angle between where the swing was aimed and where it actually left. */
      aimErrorDeg: aimError,
      strokeLength: +surface.strokeLength.toFixed(3),
      span: +surface.span.toFixed(3),
      rungs: surface.spine.length,
      verts: surface.geometry.attributes.position.count,
    };
  }

  (window as unknown as { LRSD: unknown }).LRSD = {
    world,
    duel,
    bodies,
    testSwing,

    arcs: () => arcSystem()?.queries.arcs.entities.size ?? -1,
    rival: () =>
      (world.getSystems().find((s) => s instanceof RivalSystem) as RivalSystem | undefined)?.debugState ?? null,
    queued: () => arcQueue.length,
    fills: () => {
      const s = saberSystem();
      return s ? [+s.fillOf(0).toFixed(3), +s.fillOf(1).toFixed(3)] : null;
    },

    /**
     * Run the reload against a synthetic shake: `hz` back-and-forth strokes a
     * second at `peak` metres per second, for `seconds`. Reports how much tank
     * that wins and how many reversals were counted, which is the only way to
     * check the refill rate without a headset and a tired arm.
     *
     * A believable wrist-shake is roughly 3 Hz at 2 m/s.
     */
    testShake(seconds = 2, hz = 3, peak = 2) {
      const shake = new ShakeDetector();
      const vel = new Vector3();
      const dt = 1 / 90;
      let gained = 0;
      let reversals = 0;
      for (let t = 0; t < seconds; t += dt) {
        // A pure back-and-forth along one axis: velocity flips sign twice per
        // cycle, which is exactly what the detector is meant to catch.
        vel.set(Math.sin(t * hz * Math.PI * 2) * peak, 0, 0);
        const got = shake.update(vel, t, dt);
        if (got > 0) reversals++;
        gained += got;
      }
      return {
        reversals,
        fillGained: +gained.toFixed(3),
        endCombo: +shake.combo.toFixed(2),
        /** Seconds of this shake needed to refill an empty saber. */
        secondsToFull: gained > 0 ? +(seconds / gained).toFixed(2) : Infinity,
      };
    },

    /**
     * Throw from one duelist's stance straight at the other's live head, fast
     * enough that the dodge cannot save them. The end-to-end damage check.
     */
    testHit(owner: 0 | 1 = 0) {
      const from = owner === 0 ? bodies[0].head : bodies[1].head;
      const to = owner === 0 ? bodies[1].head : bodies[0].head;
      const dir = new Vector3().copy(to).sub(from).normalize();
      return testSwing([dir.x, dir.y, dir.z], 1, 0.9, 30, owner, from.toArray() as Vec3Tuple);
    },

    /** Where things actually are, for eyeballing scale and placement. */
    probe() {
      const cam = new Vector3();
      world.camera.getWorldPosition(cam);
      return {
        camera: cam.toArray().map((n) => +n.toFixed(2)),
        rivalHead: bodies[1].head.toArray().map((n) => +n.toFixed(2)),
        gap: +cam.distanceTo(bodies[1].head).toFixed(2),
        health: duel.duelists.map((d) => Math.round(d.health)),
        rounds: duel.duelists.map((d) => d.rounds),
        phase: duel.phase,
        arcs: arcSystem()?.queries.arcs.entities.size ?? -1,
      };
    },
  };
}
