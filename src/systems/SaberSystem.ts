/**
 * YOUR SABERS — one in each hand, and every mechanic that touches them.
 *
 * Per hand, every frame:
 *
 *  1. The rig is parented under the controller's GRIP space and rotated onto
 *     the platform's own aim axis (input/aim.ts), so the blade points where
 *     the runtime says you are pointing rather than where the handle happens
 *     to be tilted.
 *  2. The blade's world motion is differentiated once for velocity and twice
 *     for acceleration. Acceleration drives the liquid's slosh; velocity
 *     drives the shake detector.
 *  3. The liquid is updated with the current fill, the current charge, and the
 *     blade's world-space centre and height — the height being computed from
 *     the blade's ORIENTATION, so a level saber's juice spreads along it and
 *     an upright one's pools at the guard.
 *  4. Trigger down starts a charge and opens a swept-surface trace.
 *  5. Trigger up throws whatever the blade carved.
 *
 * And when the trigger is NOT down, the same velocity that would have been a
 * swing is read as a SHAKE, which is how the blade refills. The two gestures
 * never compete for the same input: one happens with the trigger held, the
 * other with it released.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { ATTACK, SABER, SHAKE, bladeColors } from '../config.js';
import { createSaber, type SaberRig } from '../weapons/saber.js';
import { heldAimQuat } from '../input/aim.js';
import { pulseHand } from '../input/haptics.js';
import { HandMotion, ShakeDetector } from '../input/motion.js';
import { SwingTrace } from '../combat/sweep.js';
import { requestArc } from '../combat/arcBus.js';
import { duel } from '../combat/matchState.js';
import * as sfx from '../audio/sfx.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

const _core = new Vector3();
const _base = new Vector3();
const _tip = new Vector3();
const _axis = new Vector3();
const _scale = new Vector3();
const _quat = new Quaternion();
const _vel = new Vector3();
const _dir = new Vector3();

/** Everything the system tracks for one hand. */
class HandState {
  rig?: SaberRig;
  readonly motion = new HandMotion();
  readonly shake = new ShakeDetector();
  readonly trace = new SwingTrace();
  /** 0..1 tank. This IS the ammo. */
  fill = SABER.startFill;
  /** 0..1 attack wind-up; -1 when the trigger is not held. */
  charge = -1;
  /** Guards the audio grain rate while charging. */
  nextChargeTick = 0;
  /** Guards the "your tank just filled" chime to one per refill. */
  wasFull = true;
  lastResetCount = -1;
}

export class SaberSystem extends createSystem({}) {
  private readonly hands: [HandState, HandState] = [new HandState(), new HandState()];

  /** Read by the HUD. */
  fillOf(hand: Hand): number {
    return this.hands[hand].fill;
  }

  chargeOf(hand: Hand): number {
    return Math.max(0, this.hands[hand].charge);
  }

  shakeComboOf(hand: Hand): number {
    return this.hands[hand].shake.combo;
  }

  update(delta: number, time: number): void {
    for (const hand of [0, 1] as const) {
      this.updateHand(hand, delta, time);
    }
  }

  private updateHand(hand: Hand, delta: number, time: number): void {
    const state = this.hands[hand];
    const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
    if (!grip) return;

    // --- Build once, then live under the grip. ---
    let rig = state.rig;
    if (!rig) {
      const c = bladeColors(0);
      rig = createSaber(c.juice, c.deep, c.foam);
      grip.add(rig.group);
      state.rig = rig;
    }

    // A fresh round hands you a full tank and clears any half-made swing.
    if (state.lastResetCount !== duel.resetCount) {
      state.lastResetCount = duel.resetCount;
      state.fill = SABER.startFill;
      state.charge = -1;
      state.trace.reset();
      state.shake.reset();
      state.motion.reset();
      state.wasFull = true;
    }

    // The blade rides the platform's aim axis, not the raw handle tilt.
    heldAimQuat(this.world, hand, rig.group.quaternion);

    // --- Motion. Measured at the blade's CENTRE, which is what the liquid
    // actually experiences — measuring at the grip would under-read every
    // wrist flick, and the wrist is most of a saber's motion. ---
    rig.coreMarker.getWorldPosition(_core);
    state.motion.update(_core, delta);

    const live = duel.phase === 'playing';
    const gp = this.input.xr.gamepads[HANDS[hand]];
    const trigger = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
    const holding = live && trigger > 0.55;

    // --- SHAKE TO REPLENISH (only with the trigger released). ---
    if (!holding && !(SHAKE.blockedWhileCharging && state.charge >= 0)) {
      const gained = state.shake.update(state.motion.vel, time, delta);
      if (gained > 0) {
        const before = state.fill;
        state.fill = Math.min(1, state.fill + gained);
        sfx.shakeSlosh(state.shake.combo);
        pulseHand(this.world.session, HANDS[hand], 0.25 + Math.min(0.45, state.shake.combo * 0.16), 40);
        if (state.fill >= 1 && before < 1 && !state.wasFull) {
          sfx.refilled();
          state.wasFull = true;
        }
      }
      if (state.fill < 1) state.wasFull = false;
    } else {
      state.shake.update(_vel.set(0, 0, 0), time, delta);
    }

    // --- CHARGE / SWING / RELEASE. ---
    if (holding) {
      if (state.charge < 0) {
        // Trigger just went down: a new stroke starts here, so nothing the
        // blade did while idle can leak into the shape you are about to throw.
        state.charge = 0;
        state.trace.reset();
        pulseHand(this.world.session, HANDS[hand], 0.2, 30);
      }
      state.charge = Math.min(1, state.charge + delta / ATTACK.chargeTime);

      // Record the swept surface: where the blade's base went, and its tip.
      rig.baseMarker.getWorldPosition(_base);
      rig.tipMarker.getWorldPosition(_tip);
      state.trace.push(_base, _tip, time);

      if (time >= state.nextChargeTick) {
        state.nextChargeTick = time + 0.12;
        sfx.chargeTick(state.charge);
        // The hum you feel builds with the charge — the physical readout of
        // how much this cut is going to cost and to hurt.
        pulseHand(this.world.session, HANDS[hand], 0.06 + state.charge * 0.22, 45);
      }
    } else if (state.charge >= 0) {
      this.release(hand, state, rig, time);
      state.charge = -1;
      state.trace.reset();
    }

    rig.setTriggerPull(trigger);
    rig.setCharge(Math.max(0, state.charge));

    // --- Drive the liquid. ---
    // The blade's world height depends on how it is HELD: upright, the juice
    // has the full interior length to fall through; level, it only has the
    // blade's own thickness. Interpolating on the long axis' vertical
    // component is what keeps the fill level honest through a swing.
    rig.coreMarker.getWorldQuaternion(_quat);
    rig.coreMarker.getWorldScale(_scale);
    _axis.set(0, 0, 1).applyQuaternion(_quat);
    const across = SABER.bladeHalfWidth * 2;
    const worldHeight = (across + (rig.interiorLength - across) * Math.abs(_axis.y)) * _scale.x;
    rig.liquid.update(
      time,
      delta,
      state.fill,
      Math.max(0, state.charge),
      _core,
      worldHeight,
      state.motion.accel,
    );
  }

  /** The trigger came up. Throw whatever the blade carved — or cough. */
  private release(hand: Hand, state: HandState, rig: SaberRig, time: number): void {
    const charge = Math.max(0, state.charge);
    state.trace.tipVelocity(_vel, time);
    const speed = _vel.length();

    // Three ways a release comes to nothing, each with the same tell so the
    // player learns the difference from context rather than from a manual.
    if (speed < ATTACK.minSwingSpeed || state.fill < ATTACK.minFill) {
      sfx.fizzle();
      pulseHand(this.world.session, HANDS[hand], 0.15, 60);
      return;
    }
    const surface = state.trace.build();
    if (!surface) {
      sfx.fizzle();
      pulseHand(this.world.session, HANDS[hand], 0.15, 60);
      return;
    }

    // The cost: a base bite plus a share scaled by the wind-up, capped at
    // whatever is actually left — a nearly empty blade throws a weak attack
    // rather than refusing outright.
    const wanted = ATTACK.costBase + ATTACK.costPerCharge * charge;
    const spent = Math.min(state.fill, wanted);
    const potency = spent / wanted; // 1 on a full tank, less when scraping
    state.fill -= spent;

    const effCharge = charge * potency;
    _dir.copy(_vel).divideScalar(speed);
    const arcSpeed = Math.min(ATTACK.speedMax, Math.max(ATTACK.speedMin, speed * ATTACK.speedGain));

    const colors = bladeColors(0);
    requestArc({
      surface,
      dir: _dir.clone(),
      speed: arcSpeed,
      owner: 0,
      damage: (ATTACK.damageMin + (ATTACK.damageMax - ATTACK.damageMin) * charge) * potency,
      charge: effCharge,
      juice: colors.juice,
      foam: colors.foam,
    });

    sfx.throwArc(effCharge, speed);
    pulseHand(this.world.session, HANDS[hand], 0.45 + effCharge * 0.5, 110);
    // The blade rings empty for a moment after a cut — the slosh sim gets a
    // kick so the remaining juice visibly surges toward the guard.
    rig.liquid.slosh.energy = Math.max(rig.liquid.slosh.energy, 0.9);
  }
}
