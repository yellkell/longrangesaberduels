/**
 * Where the two duelists physically ARE, in world space.
 *
 * WebXR gives us exactly one reliable joint for a body: the head. Everything
 * else — shoulders, chest, hips — is inferred from it, and inferring more than
 * a chest sphere from a head pose is guesswork that plays worse than it reads.
 * So a duelist is two spheres hung off the head, and both sides use the same
 * two, which means a hit on you and a hit on the rival are resolved by
 * identical code and cannot drift apart.
 *
 * Owners write; ArcSystem and the HUD read.
 */

import { Vector3 } from 'three';

export interface BodyPose {
  /** World-space head centre. */
  head: Vector3;
  /** False while a duelist is down or not yet posed — nothing can hit them. */
  active: boolean;
}

export const bodies: [BodyPose, BodyPose] = [
  { head: new Vector3(0, 1.6, 0), active: false },
  { head: new Vector3(0, 1.6, -7.5), active: false },
];
