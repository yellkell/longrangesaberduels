/**
 * THE THROWN ENERGY — flight, collision and death for every sheet in the air.
 *
 * An arc is a rigid body. Its geometry was baked around its own centroid when
 * the swing was cut loose (combat/sweep.ts), so flying it is nothing more than
 * moving one transform: translate along the release velocity, sag very
 * slightly under lunar gravity, and roll slowly about the travel axis so the
 * sheet catches the sun as it crosses the gap.
 *
 * Collision uses the arc's SPINE — the rung midpoints of the ribbon — tested
 * as a polyline against the target's two spheres. That is the honest test for
 * a sheet: a wide slash genuinely covers more of the gap than a flick, because
 * its spine is genuinely longer, and no bounding volume had to be invented to
 * make that true.
 *
 * Arcs do not collide with each other. Two sheets crossing mid-gap simply pass
 * through one another, which keeps a long-range duel about reading the shape
 * and stepping aside rather than about parrying at a distance.
 */

import { createSystem, type Entity } from '@iwsdk/core';
import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { ARENA_BOUNDS, ATTACK, HITBOX } from '../config.js';
import { EnergyArc } from '../components/EnergyArc.js';
import { arcQueue } from '../combat/arcBus.js';
import { bodies } from '../combat/bodies.js';
import { damage, duel } from '../combat/matchState.js';
import { createArcMaterial, type ArcMaterialHandle } from '../materials/liquid.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';

/** Per-arc data too structural to live in a typed-array component. */
interface ArcShape {
  spine: Vector3[];
  handle: ArcMaterialHandle;
  mesh: Mesh;
  /** Unit travel axis at release — the roll axis. */
  axis: Vector3;
  /** Seconds spent dying, once a hit or a timeout has started the fade. */
  fading: number;
}

const _q = new Vector3();
const _seg = new Vector3();
const _to = new Vector3();
const _chest = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _axis = new Vector3();

/** Squared distance from `point` to segment a→b. */
function distSqToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  _seg.copy(b).sub(a);
  const len2 = _seg.lengthSq();
  if (len2 < 1e-9) return point.distanceToSquared(a);
  const t = Math.max(0, Math.min(1, _to.copy(point).sub(a).dot(_seg) / len2));
  return _q.copy(a).addScaledVector(_seg, t).distanceToSquared(point);
}

/** How long a sheet takes to burn out once it is done. */
const FADE_TIME = 0.32;

export class ArcSystem extends createSystem({
  arcs: { required: [EnergyArc] },
}) {
  private shapes = new Map<Entity, ArcShape>();
  private lastResetCount = -1;

  update(delta: number, time: number): void {
    // A new round clears the sky — an arc thrown a frame before the bell must
    // not still be travelling when the next one starts.
    if (this.lastResetCount !== duel.resetCount) {
      this.lastResetCount = duel.resetCount;
      arcQueue.length = 0;
      for (const e of [...this.queries.arcs.entities]) this.retire(e);
    }

    this.drainQueue();

    for (const e of this.queries.arcs.entities) {
      const shape = this.shapes.get(e);
      const obj = e.object3D;
      if (!shape || !obj) continue;

      const age = (e.getValue(EnergyArc, 'age') ?? 0) + delta;
      e.setValue(EnergyArc, 'age', age);
      shape.handle.setTime(time);

      if (shape.fading > 0 || e.getValue(EnergyArc, 'dying') === 1) {
        shape.fading += delta;
        shape.handle.setFade(Math.max(0, 1 - shape.fading / FADE_TIME));
        // A dying sheet blooms outward as it goes — the energy letting go.
        obj.scale.setScalar(1 + shape.fading * 1.6);
        if (shape.fading >= FADE_TIME) this.retire(e);
        continue;
      }

      // --- Flight, in SUBSTEPS. ---
      // A sheet crossing the gap at 22 m/s covers about 30 cm per 72 Hz frame,
      // which is the same order as the whole collision reach — so a single
      // test per frame lets fast attacks pass clean THROUGH a duelist between
      // two samples. Splitting the frame's travel into steps no longer than
      // half the reach makes tunnelling impossible without paying for
      // continuous collision detection.
      const v = e.getVectorView(EnergyArc, 'velocity');
      v[1] -= ATTACK.gravity * delta;
      const travel = Math.hypot(v[0], v[1], v[2]) * delta;
      const steps = Math.max(1, Math.min(8, Math.ceil(travel / (ATTACK.hitRadius * 0.9))));
      const sub = delta / steps;

      const lifetime = e.getValue(EnergyArc, 'lifetime') ?? ATTACK.lifetime;
      const owner = (e.getValue(EnergyArc, 'owner') ?? 0) as 0 | 1;
      const target = (owner === 0 ? 1 : 0) as 0 | 1;
      const body = bodies[target];
      const canHit =
        body.active && duel.phase === 'playing' && duel.duelists[target].health > 0;
      _chest.copy(body.head).y -= HITBOX.chestDrop;

      let hitHead = false;
      let hitChest = false;
      for (let s = 0; s < steps; s++) {
        obj.position.x += v[0] * sub;
        obj.position.y += v[1] * sub;
        obj.position.z += v[2] * sub;
        obj.rotateOnWorldAxis(shape.axis, (e.getValue(EnergyArc, 'roll') ?? 0) * sub);
        obj.updateMatrixWorld();
        if (!canHit) continue;
        hitHead = this.sweepHits(shape, obj, body.head, HITBOX.headRadius);
        hitChest = hitHead || this.sweepHits(shape, obj, _chest, HITBOX.chestRadius);
        if (hitHead || hitChest) break;
      }

      // Sheets thin out over their life rather than snapping off at the end.
      shape.handle.setFade(Math.max(0.15, 1 - Math.pow(age / lifetime, 2.5)));

      if (!hitHead && !hitChest) {
        if (age >= lifetime || this.outOfBounds(obj)) {
          sfx.arcExpire();
          e.setValue(EnergyArc, 'dying', 1);
        }
        continue;
      }

      const base = e.getValue(EnergyArc, 'damage') ?? ATTACK.damageMin;
      const dealt = base * (hitHead ? HITBOX.headDamageScale : 1);
      damage(target, dealt);

      if (target === 0) {
        sfx.tookHit();
        for (const hand of ['left', 'right'] as const) {
          pulseHand(this.world.session, hand, hitHead ? 0.95 : 0.7, hitHead ? 200 : 150);
        }
      } else {
        sfx.hit(hitHead);
      }
      this.flash(obj.position, e.getValue(EnergyArc, 'charge') ?? 0, shape);
      e.setValue(EnergyArc, 'dying', 1);
    }
  }

  /** Turn every queued request into a live projectile. */
  private drainQueue(): void {
    while (arcQueue.length) {
      const req = arcQueue.shift()!;
      const { surface } = req;

      const handle = createArcMaterial(req.juice, req.foam, req.charge);
      const mesh = new Mesh(surface.geometry, handle.material);
      mesh.frustumCulled = false; // the geometry's bounds move with the body

      const holder = new Object3D();
      holder.position.copy(surface.centroid);
      // TURN THE SHEET FACE-ON.
      //
      // A swing is a rotation, so the surface it carves is a flat fan and the
      // release tangent lies inside that fan. Launched exactly as cut, the
      // sheet travels within its own plane and shows everyone — thrower and
      // target alike — nothing but its edge. It is invisible, and an attack
      // nobody can see is not an attack, it is a bug with a damage value.
      //
      // So the shortest arc that brings the swing plane's normal onto the line
      // of travel is applied once, at launch. The SHAPE is untouched: it is
      // still exactly the curve the blade carved, and because the rotation is
      // the minimal one, a vertical cut still arrives as a tall crescent and a
      // horizontal cut as a wide one. That is the whole defensive read — which
      // way to dodge is legible from the shape of the thing coming at you.
      _axis.copy(surface.planeNormal);
      if (Math.abs(_axis.dot(req.dir)) < 0.999) {
        holder.quaternion.setFromUnitVectors(_axis, req.dir);
      }
      holder.add(mesh);

      const entity = this.world.createTransformEntity(holder);
      entity.addComponent(EnergyArc, {
        owner: req.owner,
        damage: req.damage,
        charge: req.charge,
        lifetime: ATTACK.lifetime,
        // Roll direction alternates with the sign of the throw so a pair of
        // arcs from the same hand never look like the same object twice.
        roll: ATTACK.rollRate * (req.dir.x >= 0 ? 1 : -1),
      });
      const v = entity.getVectorView(EnergyArc, 'velocity');
      v[0] = req.dir.x * req.speed;
      v[1] = req.dir.y * req.speed;
      v[2] = req.dir.z * req.speed;

      this.shapes.set(entity, {
        spine: surface.spine,
        handle,
        mesh,
        axis: req.dir.clone().normalize(),
        fading: 0,
      });
    }
  }

  /** Does this sheet's spine pass within `radius` of a point? */
  private sweepHits(shape: ArcShape, obj: Object3D, point: Vector3, radius: number): boolean {
    const reach = radius + ATTACK.hitRadius;
    const reach2 = reach * reach;
    const spine = shape.spine;
    for (let i = 0; i < spine.length - 1; i++) {
      _a.copy(spine[i]).applyMatrix4(obj.matrixWorld);
      _b.copy(spine[i + 1]).applyMatrix4(obj.matrixWorld);
      if (distSqToSegment(point, _a, _b) <= reach2) return true;
    }
    return false;
  }

  private outOfBounds(obj: Object3D): boolean {
    const p = obj.position;
    if (p.y < ARENA_BOUNDS.floorY || p.y > ARENA_BOUNDS.ceilingY) return true;
    return p.x * p.x + p.z * p.z > ARENA_BOUNDS.radius * ARENA_BOUNDS.radius;
  }

  /** A short-lived bloom at the point of impact. */
  private flash(at: Vector3, charge: number, shape: ArcShape): void {
    const colour = new Color((shape.handle.material.uniforms.uHotColor.value as Color).getHex());
    const mesh = new Mesh(
      new SphereGeometry(0.16 + charge * 0.2, 14, 10),
      new MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.copy(at);
    this.scene.add(mesh);

    const started = performance.now();
    const tick = (): void => {
      const t = (performance.now() - started) / 260;
      if (t >= 1) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
        mesh.removeFromParent();
        return;
      }
      mesh.scale.setScalar(1 + t * 3.2);
      (mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private retire(entity: Entity): void {
    const shape = this.shapes.get(entity);
    if (shape) {
      shape.mesh.geometry.dispose();
      shape.handle.material.dispose();
      this.shapes.delete(entity);
    }
    entity.object3D?.removeFromParent();
    entity.destroy();
  }
}
