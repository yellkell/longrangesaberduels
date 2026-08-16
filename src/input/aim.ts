/**
 * WHERE THE HAND IS ACTUALLY POINTING.
 *
 * WebXR reports two poses per hand:
 *  - the GRIP pose — where the controller BODY is, -Z running along the
 *    handle like a held rod;
 *  - the TARGET RAY pose — where the platform says the user is AIMING.
 *
 * They are not the same. On Quest the handle sits well below the aim line, so
 * a blade parented raw to the grip points high, and no hand-picked tilt fixes
 * that across devices (or hand tracking, where the offset moves with your
 * fingers). So the saber carries the platform's own aim axis: it is rotated by
 * exactly the grip→ray delta, which is self-calibrating.
 *
 * Two guards keep that honest. The delta is CLAMPED (GRIP.aimMaxCorrection)
 * because the ray is tuned for UI pointing and can sit far enough off the grip
 * that an exactly-aligned blade would visibly droop in your real hand. And
 * when the runtime reports no distinct ray (the desktop emulator poses both
 * spaces identically), everything falls back to GRIP.heldPitch.
 */

import { Quaternion, Vector3 } from 'three';
import type { World } from '@iwsdk/core';
import { GRIP } from '../config.js';

const HANDS = ['left', 'right'] as const;
const X_AXIS = new Vector3(1, 0, 0);

const _gq = new Quaternion();
const _rq = new Quaternion();
const _delta = new Quaternion();
const _trim = new Quaternion();
const _aim = new Quaternion(); // handAimRay's own slot — never aliases _delta

/** Below this the ray is just the grip again — emulator, or no ray. */
const MEANINGFUL = 0.05;

export function gripOf(world: World, hand: 0 | 1) {
  return world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
}

function rayOf(world: World, hand: 0 | 1) {
  return world.playerSpaceEntities.raySpaces?.[HANDS[hand]]?.object3D;
}

/**
 * The LOCAL rotation for a saber parented under `hand`'s grip so its blade
 * (-Z) runs along the aim axis. Always writes a usable rotation.
 */
export function heldAimQuat(world: World, hand: 0 | 1, out: Quaternion): void {
  const grip = gripOf(world, hand);
  const ray = rayOf(world, hand);
  if (grip && ray) {
    grip.getWorldQuaternion(_gq);
    ray.getWorldQuaternion(_rq);
    _delta.copy(_gq).invert().multiply(_rq).normalize();
    // Double cover: |w| is what encodes the angle regardless of sign.
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_delta.w)));
    if (angle > MEANINGFUL) {
      const t = angle > GRIP.aimMaxCorrection ? GRIP.aimMaxCorrection / angle : 1;
      out.set(0, 0, 0, 1).slerp(_delta, t);
      if (GRIP.aimTrim !== 0) out.multiply(_trim.setFromAxisAngle(X_AXIS, GRIP.aimTrim));
      return;
    }
  }
  out.setFromAxisAngle(X_AXIS, GRIP.heldPitch + GRIP.aimTrim);
}

/**
 * The world-space aim ray for a hand: origin and unit direction, matching the
 * blade of a saber held in it. False when that hand isn't posed.
 */
export function handAimRay(world: World, hand: 0 | 1, outOrigin: Vector3, outDir: Vector3): boolean {
  const grip = gripOf(world, hand);
  if (!grip) return false;
  // Aim first (it owns _gq/_delta as scratch), then compose onto the grip.
  heldAimQuat(world, hand, _aim);
  grip.getWorldPosition(outOrigin);
  grip.getWorldQuaternion(_gq);
  outDir.set(0, 0, -1).applyQuaternion(_gq.multiply(_aim));
  return true;
}
