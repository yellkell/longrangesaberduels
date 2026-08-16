/**
 * The saber's hardware materials.
 *
 * The blade is a GLASS VESSEL, not a beam. That means the shell has to do two
 * contradictory things: stay clear enough that the liquid inside is the star,
 * and still catch enough light to read as a solid object with walls when the
 * blade runs dry. The Valve answer — used for SPLASH WARS' pistol tanks and
 * kept here — is FROST: a rough base under a glossy clearcoat, tinted milky,
 * held at low opacity. It scatters the surface just enough to say "there is
 * real glass here" while the juice still reads at a glance.
 *
 * No physical transmission anywhere: it is far too heavy in stereo WebXR, and
 * the opaque liquid behind the frost already does the entire job.
 */

import { MeshPhysicalMaterial, MeshStandardMaterial, type ColorRepresentation } from 'three';
import { PALETTE } from '../config.js';

/** The blade's frosted shell. */
export function bladeGlass(tint: ColorRepresentation = PALETTE.glass): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: tint,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    transparent: true,
    // Lower than a pistol tank's frost: a blade is read edge-on constantly, and
    // at 0.34 the accumulated depth of two walls hid the liquid completely.
    opacity: 0.22,
    depthWrite: false,
    envMapIntensity: 1.6,
  });
}

/** Machined hilt metal — the only cold, hard surface on the weapon. */
export function hiltMetal(color: ColorRepresentation = PALETTE.steel): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    metalness: 0.94,
    roughness: 0.31,
  });
}

/** The hilt's dark grip wrap and inlays. */
export function hiltDark(color: ColorRepresentation = PALETTE.hiltDark): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    metalness: 0.35,
    roughness: 0.72,
  });
}
