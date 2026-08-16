/**
 * A thrown energy sheet in flight.
 *
 * The SHAPE lives system-side (ArcSystem holds the spine and the material
 * handle in a Map keyed by entity) because it is per-attack geometry, not
 * numeric state worth packing into a typed array. What lives here is only what
 * the flight integrator touches every frame.
 */

import { createComponent, Types } from '@iwsdk/core';

export const EnergyArc = createComponent(
  'EnergyArc',
  {
    /** 0 = thrown by you, 1 = thrown by the rival. */
    owner: { type: Types.Int8, default: 0 },
    velocity: { type: Types.Vec3, default: [0, 0, 0] },
    damage: { type: Types.Float32, default: 10 },
    charge: { type: Types.Float32, default: 0 },
    age: { type: Types.Float32, default: 0 },
    lifetime: { type: Types.Float32, default: 4 },
    /** Radians per second of roll about the travel axis. */
    roll: { type: Types.Float32, default: 0 },
    /** Set once a hit lands so the sheet can flare out instead of vanishing. */
    dying: { type: Types.Int8, default: 0 },
  },
  'A thrown sheet of saber energy.',
);
