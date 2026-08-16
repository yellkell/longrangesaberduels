/**
 * THE RIVAL — a suited duelist on the far pad.
 *
 * The important thing about this opponent is what it does NOT do: it never
 * spawns an attack out of thin air. It holds a real saber with real liquid in
 * it, it physically swings that saber through the air, a SwingTrace records the
 * swept surface exactly as it does for your hands, and the release goes through
 * the same arc bus yours does. Everything you can read off your own weapon —
 * the wind-up glow, the swing's shape, how much juice is left — is legible on
 * the rival's too, because it is the same weapon.
 *
 * That has a second payoff: when it runs dry it has to SHAKE, in plain sight,
 * for about a second. So the game teaches its own reload by making the enemy
 * perform it, and hands you the opening at the same time.
 *
 * The swing geometry is aimed, not scripted. Given the arm vector r (shoulder
 * to blade tip) and the direction d to your head, the rotation axis
 *
 *     a = normalise( r × (d − r (d·r)/|r|²) )
 *
 * makes the tip's velocity point exactly along d at the moment the arm passes
 * through the pose r. So the bot winds BACK from that pose, swings forward
 * through it, and releases as it arrives — a genuine slash whose release frame
 * happens to be aimed at you.
 */

import { createSystem } from '@iwsdk/core';
import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { ARENA_GAP, ATTACK, BOT, OCTAGON_HALF_WIDTH, PALETTE, SABER, bladeColors } from '../config.js';
import { EnergyArc } from '../components/EnergyArc.js';
import { createSaber, type SaberRig } from '../weapons/saber.js';
import { SwingTrace } from '../combat/sweep.js';
import { requestArc } from '../combat/arcBus.js';
import { bodies } from '../combat/bodies.js';
import { duel } from '../combat/matchState.js';
import { HandMotion } from '../input/motion.js';
import * as sfx from '../audio/sfx.js';

type Mode = 'ready' | 'windup' | 'swing' | 'recover' | 'shaking';

/** How far back it winds before cutting. */
const WINDUP_ANGLE = 2.0;
/** Largest angular gap between two traced rungs of the bot's swing. */
const SWING_STEP = 0.12;
/** Shoulder pivot to blade tip — the radius the swing turns through. */
const ARM_REACH = 0.72 + SABER.bladeLength;

const _r = new Vector3();
const _d = new Vector3();
const _perp = new Vector3();
const _shoulderPos = new Vector3();
const _tip = new Vector3();
const _base = new Vector3();
const _core = new Vector3();
const _scale = new Vector3();
const _bladeAxis = new Vector3();
const _quat = new Quaternion();
const _q2 = new Quaternion();
const _vel = new Vector3();
const _arcPos = new Vector3();
const _toArc = new Vector3();
const _aimAt = new Vector3();

/** Suit materials — bright shell, dark joints, so the silhouette reads at 7.5 m. */
function suitShell(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xd9dde4, roughness: 0.62, metalness: 0.08 });
}
function suitJoint(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.75, metalness: 0.2 });
}

export class RivalSystem extends createSystem({
  arcs: { required: [EnergyArc] },
}) {
  private root?: Group;
  private head?: Object3D;
  private shoulder?: Object3D;
  private saber?: SaberRig;
  private readonly trace = new SwingTrace();
  private readonly motion = new HandMotion();

  private mode: Mode = 'ready';
  private timer = 0;
  private angle = 0;
  private omega = 0;
  private charge = 0;
  private fill = 1;
  private shakeLeft = 0;
  private strafe = 0;
  private strafePhase = 0;
  private dodge = 0;
  private lastResetCount = -1;

  /** Read by the dev hooks — the bot's brain, without exposing its guts. */
  get debugState(): Record<string, number | string> {
    return {
      mode: this.mode,
      timer: +this.timer.toFixed(2),
      angle: +this.angle.toFixed(2),
      charge: +this.charge.toFixed(2),
      fill: +this.fill.toFixed(2),
      traced: this.trace.length,
    };
  }

  init(): void {
    this.build();
  }

  private build(): void {
    const root = new Group();
    root.name = 'rival';
    root.position.set(0, 0, -ARENA_GAP);

    const shell = suitShell();
    const joint = suitJoint();
    const accent = new MeshStandardMaterial({
      color: PALETTE.ember,
      roughness: 0.45,
      metalness: 0.3,
      emissive: PALETTE.ember,
      emissiveIntensity: 0.35,
    });

    // Legs — planted, so the figure has weight on the deck.
    for (const side of [-1, 1]) {
      const leg = new Mesh(new CapsuleGeometry(0.085, 0.5, 4, 10), shell);
      leg.position.set(side * 0.14, 0.42, 0);
      root.add(leg);
      const boot = new Mesh(new CapsuleGeometry(0.09, 0.1, 3, 8), joint);
      boot.position.set(side * 0.14, 0.1, 0.02);
      root.add(boot);
    }

    const torso = new Mesh(new CapsuleGeometry(0.19, 0.36, 5, 14), shell);
    torso.position.y = 1.03;
    root.add(torso);

    // The life-support pack — the shape that says SPACE SUIT from behind.
    const pack = new Mesh(new CapsuleGeometry(0.14, 0.26, 4, 10), joint);
    pack.position.set(0, 1.06, -0.18);
    root.add(pack);

    // A chest lamp in its own colour: at this range the rival is mostly a
    // silhouette against the stars, and this is what makes it a PRESENCE.
    const lamp = new Mesh(new SphereGeometry(0.045, 12, 10), new MeshBasicMaterial({ color: PALETTE.ember }));
    lamp.position.set(0, 1.14, 0.18);
    root.add(lamp);
    const collar = new Mesh(new TorusGeometry(0.14, 0.022, 8, 20), accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.3;
    root.add(collar);

    const head = new Object3D();
    head.position.y = 1.47;
    root.add(head);
    const helmet = new Mesh(new SphereGeometry(0.145, 20, 16), shell);
    head.add(helmet);
    // The visor: a dark bubble on the front of the helmet, faintly lit from
    // inside so there is a face-shaped thing to aim at.
    const visor = new Mesh(
      new SphereGeometry(0.132, 20, 16, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.28, Math.PI * 0.44),
      new MeshStandardMaterial({
        color: 0x0b1016,
        roughness: 0.08,
        metalness: 0.9,
        emissive: PALETTE.ember,
        emissiveIntensity: 0.12,
      }),
    );
    visor.rotation.y = Math.PI / 2;
    head.add(visor);

    // The sword arm. The pivot IS the shoulder: everything about the swing is
    // a rotation of this one node, which is what makes the traced surface real.
    const shoulder = new Object3D();
    shoulder.position.set(-0.24, 1.24, 0);
    root.add(shoulder);

    const upper = new Mesh(new CylinderGeometry(0.058, 0.05, 0.62, 10), shell);
    upper.position.y = -0.31; // hangs down the arm's local -Y
    shoulder.add(upper);
    const elbow = new Mesh(new SphereGeometry(0.058, 12, 10), joint);
    elbow.position.y = -0.62;
    shoulder.add(elbow);
    const glove = new Mesh(new SphereGeometry(0.07, 12, 10), joint);
    glove.position.y = -0.7;
    shoulder.add(glove);

    // The saber, held at the end of the arm. The rig's blade runs along its
    // own -Z, so it is turned to continue down the arm's -Y.
    const c = bladeColors(1);
    const saber = createSaber(c.juice, c.deep, c.foam);
    saber.group.position.y = -0.72;
    saber.group.rotation.x = -Math.PI / 2;
    shoulder.add(saber.group);

    // The other arm, just hanging — asymmetry reads as a person.
    const offArm = new Mesh(new CylinderGeometry(0.055, 0.048, 0.6, 10), shell);
    offArm.position.set(0.25, 0.94, 0.02);
    offArm.rotation.z = 0.16;
    root.add(offArm);

    this.scene.add(root);
    this.root = root;
    this.head = head;
    this.shoulder = shoulder;
    this.saber = saber;
    this.restPose();
  }

  /** The idle guard, which is also the RELEASE pose: every swing winds back
   *  from here and is let go the instant it arrives back. */
  private restPose(): void {
    this.shoulder?.quaternion.copy(this.restQuat);
    this.angle = 0;
    this.swingAxis.set(1, 0, 0);
  }

  /** Set the shoulder to `angle` radians about the swing axis, on top of rest. */
  private poseShoulder(shoulder: Object3D, angle: number): void {
    shoulder.quaternion.copy(_q2.setFromAxisAngle(this.swingAxis, angle)).multiply(this.restQuat);
  }

  update(delta: number, time: number): void {
    const root = this.root;
    const head = this.head;
    const shoulder = this.shoulder;
    const saber = this.saber;
    if (!root || !head || !shoulder || !saber) return;

    if (this.lastResetCount !== duel.resetCount) {
      this.lastResetCount = duel.resetCount;
      this.fill = 1;
      this.mode = 'ready';
      this.timer = 1.2;
      this.charge = 0;
      this.dodge = 0;
      this.trace.reset();
      this.restPose();
    }

    const down = duel.duelists[1].health <= 0;
    const live = duel.phase === 'playing' && !down;

    // --- Where it stands: a slow patrol along its pad, plus a dodge. ---
    if (live) {
      this.strafePhase += delta * BOT.strafeRate;
      this.strafe = Math.sin(this.strafePhase) * BOT.strafeRange;
      this.dodge = this.dodgeOffset(root.position, delta);
    }
    const wantX = Math.max(
      -OCTAGON_HALF_WIDTH + 0.2,
      Math.min(OCTAGON_HALF_WIDTH - 0.2, this.strafe + this.dodge),
    );
    root.position.x += (wantX - root.position.x) * Math.min(1, delta * 4.5);
    // Down duelists slump: the pose IS the scoreboard at this distance.
    root.position.y += ((down ? -0.55 : 0) - root.position.y) * Math.min(1, delta * 3);
    root.rotation.z = down ? 0.35 : 0;

    // It looks at you — the head turns even while the body patrols.
    const target = bodies[0].head;
    root.rotation.y = Math.atan2(target.x - root.position.x, target.z - root.position.z);

    // --- Publish the hitbox. ---
    head.getWorldPosition(bodies[1].head);
    bodies[1].active = !down;

    // --- Liquid, always, in every mode. ---
    saber.coreMarker.getWorldPosition(_core);
    this.motion.update(_core, delta);
    saber.coreMarker.getWorldQuaternion(_quat);
    saber.coreMarker.getWorldScale(_scale);
    _bladeAxis.set(0, 0, 1).applyQuaternion(_quat);
    const across = SABER.bladeHalfWidth * 2;
    const worldHeight = (across + (saber.interiorLength - across) * Math.abs(_bladeAxis.y)) * _scale.x;
    saber.liquid.update(time, delta, this.fill, this.charge, _core, worldHeight, this.motion.accel);
    saber.setCharge(this.charge);

    if (!live) {
      if (down) saber.group.visible = false;
      return;
    }
    saber.group.visible = true;

    this.runBrain(delta, time, shoulder, saber);
  }

  /** The attack state machine. */
  private runBrain(delta: number, time: number, shoulder: Object3D, saber: SaberRig): void {
    this.timer -= delta;

    switch (this.mode) {
      case 'ready': {
        this.charge = Math.max(0, this.charge - delta * 2);
        if (this.timer > 0) break;
        if (this.fill < ATTACK.costBase + ATTACK.costPerCharge * 0.5) {
          this.mode = 'shaking';
          this.shakeLeft = 1.15;
          break;
        }
        this.beginSwing(shoulder);
        break;
      }

      case 'windup': {
        // Rock back to the wound pose and glow while it does — the tell.
        this.charge = Math.min(1, this.charge + delta / (ATTACK.chargeTime * 0.9));
        const step = Math.min(1, delta * 7);
        this.angle += (-WINDUP_ANGLE - this.angle) * step;
        this.poseShoulder(shoulder, this.angle);
        if (this.timer <= 0) {
          this.mode = 'swing';
          // Fast enough that the traced tip clears ATTACK.minSwingSpeed by a
          // wide margin — a bot that fizzles its own swings is just a bug.
          this.omega = WINDUP_ANGLE / 0.26;
          this.trace.reset();
        }
        break;
      }

      case 'swing': {
        // SUB-STEPPED, unlike your hands.
        //
        // A cut takes about a quarter of a second, so at 90 Hz it would trace
        // twenty-odd rungs — but on a frame-starved device it might get two,
        // and two rungs is not a surface. Your swing has no cure for that:
        // real hand poses only exist once per frame. The bot's does, because
        // its swing is an analytic rotation, so it can evaluate its own pose
        // at any angle it likes. Stepping in fixed ANGULAR increments makes
        // the shape it throws identical at 20 fps and at 120.
        const target = Math.min(0, this.angle + this.omega * delta);
        const sweep = target - this.angle;
        const steps = Math.max(1, Math.ceil(sweep / SWING_STEP));
        for (let i = 1; i <= steps; i++) {
          const a = this.angle + (sweep * i) / steps;
          this.poseShoulder(shoulder, a);
          // Force the matrices down to the blade markers NOW: the trace reads
          // world positions immediately, and a stale matrix would record the
          // swing one step behind the pose that actually threw it.
          shoulder.updateMatrixWorld(true);
          saber.baseMarker.getWorldPosition(_base);
          saber.tipMarker.getWorldPosition(_tip);
          // Stamp each sub-sample with its true share of the frame, so the
          // velocity fit sees the real angular rate rather than a stack of
          // samples that all claim to have happened at once.
          this.trace.push(_base, _tip, time - delta + (delta * i) / steps);
        }
        this.angle = target;
        if (this.angle >= -1e-4) this.release(time);
        break;
      }

      case 'recover': {
        this.charge = Math.max(0, this.charge - delta * 3);
        const step = Math.min(1, delta * 5);
        this.angle += (0 - this.angle) * step;
        this.poseShoulder(shoulder, this.angle);
        if (this.timer <= 0) {
          this.mode = 'ready';
          this.timer = BOT.attackIntervalMin + Math.random() * (BOT.attackIntervalMax - BOT.attackIntervalMin);
        }
        break;
      }

      case 'shaking': {
        // A visible, honest reload: the arm shakes, the juice climbs back.
        this.shakeLeft -= delta;
        this.swingAxis.set(1, 0, 0);
        this.poseShoulder(shoulder, Math.sin(time * 26) * 0.42);
        this.fill = Math.min(1, this.fill + delta * 0.85);
        if (this.shakeLeft <= 0 || this.fill >= 1) {
          this.restPose();
          this.mode = 'ready';
          this.timer = 0.35;
        }
        break;
      }
    }
  }

  private readonly restQuat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.55);
  /** The swing's rotation axis, expressed in the SHOULDER'S PARENT frame —
   *  which is the frame `shoulder.quaternion` is actually interpreted in. */
  private readonly swingAxis = new Vector3(1, 0, 0);

  /**
   * Pick the rotation axis that aims this swing at the player, then wind back
   * along it. See the header for the derivation.
   *
   * Everything here happens in the shoulder's parent frame. Doing the maths in
   * world space and then assigning the result to a local quaternion is the
   * classic way to get a swing that aims correctly only when the body happens
   * to face down the world's -Z, and this body turns to track you.
   */
  private beginSwing(shoulder: Object3D): void {
    const parent = shoulder.parent;
    if (!parent) return;
    parent.getWorldQuaternion(_quat);
    shoulder.getWorldPosition(_shoulderPos);

    // The arm+blade vector at the RELEASE pose. The arm hangs down the
    // shoulder's local -Y, so the rest rotation applied to -Y IS the reach.
    _r.set(0, -1, 0).applyQuaternion(this.restQuat).multiplyScalar(ARM_REACH);

    // Direction to the player's head, brought back into the parent frame.
    _d.copy(bodies[0].head).sub(_shoulderPos).applyQuaternion(_q2.copy(_quat).invert()).normalize();
    // Scatter the aim by however far short of perfect BOT.aim is, so a lower
    // skill setting genuinely misses rather than being told to miss.
    const spread = 1 - BOT.aim;
    _d.x += spread * (Math.random() - 0.5) * 0.55;
    _d.y += spread * (Math.random() - 0.5) * 0.3;
    _d.normalize();

    // Strip the component along the arm: a rotation cannot produce velocity
    // along its own radius, so only the perpendicular part is achievable.
    _perp.copy(_d).addScaledVector(_r, -_d.dot(_r) / _r.lengthSq());
    if (_perp.lengthSq() < 1e-6) {
      // The player is exactly down the arm's axis — no aimable swing exists.
      // Fall back to a plain overhead cut and let the shot go wide.
      this.swingAxis.set(1, 0, 0);
    } else {
      _perp.normalize();
      this.swingAxis.copy(_r).cross(_perp).normalize();
      if (!Number.isFinite(this.swingAxis.x)) this.swingAxis.set(1, 0, 0);
    }

    this.mode = 'windup';
    this.timer = 0.42;
    this.charge = 0;
  }

  private release(time: number): void {
    this.mode = 'recover';
    this.timer = 0.55;

    const surface = this.trace.build();
    this.trace.tipVelocity(_vel, time);
    const speed = _vel.length();
    if (!surface || speed < ATTACK.minSwingSpeed) return;

    // Aim the thing that actually flies, from where it actually leaves. See
    // BOT.aimAssist for why the swing's own direction is not enough.
    const arcSpeed = Math.min(ATTACK.speedMax, Math.max(ATTACK.speedMin, BOT.arcSpeed));
    _vel.divideScalar(speed);
    _aimAt.copy(bodies[0].head).sub(surface.centroid);
    // Lead for the drop: a sheet crossing the gap falls by ½gt², so aim that
    // much high and the shot arrives at head height instead of at the knees.
    const flight = _aimAt.length() / arcSpeed;
    _aimAt.y += 0.5 * ATTACK.gravity * flight * flight;
    _aimAt.normalize();
    _vel.lerp(_aimAt, BOT.aimAssist).normalize();

    // Whatever accuracy it is short of, it pays for in scatter.
    const spread = (1 - BOT.aim) * 0.5;
    if (spread > 0) {
      _vel.x += (Math.random() - 0.5) * spread;
      _vel.y += (Math.random() - 0.5) * spread * 0.6;
      _vel.z += (Math.random() - 0.5) * spread;
      _vel.normalize();
    }

    const wanted = ATTACK.costBase + ATTACK.costPerCharge * this.charge;
    const spent = Math.min(this.fill, wanted);
    if (spent <= 0.001) return;
    const potency = spent / wanted;
    this.fill -= spent;

    const c = bladeColors(1);
    requestArc({
      surface,
      dir: _vel.clone(),
      speed: arcSpeed,
      owner: 1,
      damage:
        (ATTACK.damageMin + (ATTACK.damageMax - ATTACK.damageMin) * this.charge) * potency * BOT.damageScale,
      charge: this.charge * potency,
      juice: c.juice,
      foam: c.foam,
    });
    sfx.throwArc(this.charge * 0.6, speed);
  }

  /**
   * How far sideways it wants to be. Any of YOUR arcs whose path passes close
   * to the rival within BOT.dodgeLead seconds pushes it the other way, so it
   * slides out of the line of a shot rather than teleporting off it.
   */
  private dodgeOffset(here: Vector3, delta: number): number {
    let push = 0;
    for (const e of this.queries.arcs.entities) {
      if ((e.getValue(EnergyArc, 'owner') ?? 0) !== 0) continue;
      if (e.getValue(EnergyArc, 'dying') === 1) continue;
      const obj = e.object3D;
      if (!obj) continue;
      const v = e.getVectorView(EnergyArc, 'velocity');
      _arcPos.copy(obj.position);
      _toArc.set(here.x - _arcPos.x, 0, here.z - _arcPos.z);
      const closing = -(v[0] * -_toArc.x + v[2] * -_toArc.z);
      if (closing <= 0) continue;
      const dist = _toArc.length();
      const speed = Math.hypot(v[0], v[2]) || 1;
      const eta = dist / speed;
      if (eta > BOT.dodgeLead) continue;
      // Where it will cross this depth, laterally.
      const missBy = _arcPos.x + v[0] * eta - here.x;
      if (Math.abs(missBy) > 1.1) continue;
      push += (missBy >= 0 ? -1 : 1) * (1 - eta / BOT.dodgeLead);
    }
    const want = Math.max(-1, Math.min(1, push)) * BOT.strafeRange * 1.6;
    return this.dodge + (want - this.dodge) * Math.min(1, delta * BOT.dodgeSpeed * 2.2);
  }
}
