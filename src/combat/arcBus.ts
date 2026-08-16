/**
 * The arc bus — one queue, so nothing that THROWS an attack needs to know
 * anything about the system that FLIES it.
 *
 * Your sabers and the rival's both push requests here; ArcSystem drains the
 * queue once a frame and turns each one into a live projectile. That keeps the
 * player's input code and the bot's brain completely independent of the
 * flight, collision and damage path — and means a networked opponent could be
 * bolted on later as nothing more than a third producer.
 */

import type { Vector3 } from 'three';
import type { SweptSurface } from './sweep.js';

export interface ArcRequest {
  /** The swept surface cut loose from the blade. */
  surface: SweptSurface;
  /** Unit travel direction — the way the blade was going at release. */
  dir: Vector3;
  /** Metres per second. */
  speed: number;
  /** Who threw it: 0 = you, 1 = the rival. */
  owner: 0 | 1;
  damage: number;
  /** 0..1 wind-up at release — drives brightness, size and damage. */
  charge: number;
  /** Blade colours, so the energy matches the liquid it came from. */
  juice: number;
  foam: number;
}

export const arcQueue: ArcRequest[] = [];

export function requestArc(req: ArcRequest): void {
  arcQueue.push(req);
}
