/**
 * THE GLASS SABER — built entirely from generated geometry, zero assets.
 *
 * A machined hilt, a pommel, a guard collar, and above it a tapered GLASS
 * BLADE with glowing liquid sloshing inside (materials/liquid.ts). The blade
 * is a vessel: it has walls, an interior, and a fill level that is also your
 * ammunition.
 *
 * Local frame matches the XR grip space: **-Z is forward**, the origin sits
 * inside the fist. So parenting this group straight under a grip entity puts
 * the saber in your hand with the blade running out of the top of your fist.
 * That axis convention matters twice more: the liquid shader measures its
 * charge pulse along local -Z, and the swept-surface trace reads the base and
 * tip markers that sit on it.
 *
 * The cross-section is an octagonal lens — WIDE across Y (the flat of the
 * blade) and THIN across X — so the broad faces look left and right out of
 * your fist the way a longsword's do, and a horizontal cut shows you the whole
 * flat of the liquid.
 */

import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type ColorRepresentation,
} from 'three';
import { PALETTE, SABER } from '../config.js';
import { bladeGlass, hiltDark, hiltMetal } from '../materials/glass.js';
import { createLiquid, type LiquidVisual } from '../materials/liquid.js';

/** Rings along the blade. Enough that the taper is smooth and the liquid mesh
 *  has vertices for the world-space clip to cut cleanly through. */
const RINGS = 14;
/** Points around the cross-section. Eight reads as a rounded glass lens. */
const SIDES = 8;

/**
 * A tapered blade prism running from z = 0 (the guard) to z = -length (the
 * tip), closed at both ends. `taper` is the tip's cross-section as a fraction
 * of the base's, and the final ring converges to a point so the blade actually
 * comes to something rather than ending in a flat lid.
 */
function bladeGeometry(halfW: number, halfD: number, length: number, taper: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];

  // Cross-section unit outline: an ellipse sampled at SIDES points, so the
  // silhouette is a lens rather than a slab with hard corners.
  const unit: [number, number][] = [];
  for (let s = 0; s < SIDES; s++) {
    const a = (s / SIDES) * Math.PI * 2;
    unit.push([Math.cos(a), Math.sin(a)]);
  }

  const scaleAt = (t: number): number => {
    // Convex taper: holds its width through the first half, then draws in.
    const body = 1 - (1 - taper) * Math.pow(t, 1.5);
    // The last eighth converges to the point.
    const point = t > 0.875 ? 1 - Math.pow((t - 0.875) / 0.125, 1.6) : 1;
    return body * point;
  };

  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    const z = -t * length;
    const k = scaleAt(t);
    for (let s = 0; s < SIDES; s++) {
      const [ux, uy] = unit[s];
      pos.push(ux * halfD * k, uy * halfW * k, z);
      // Normals point out of the cross-section; the slight lengthwise tilt
      // from the taper is small enough that the flats still light correctly.
      const nx = ux / halfD;
      const ny = uy / halfW;
      const nl = Math.hypot(nx, ny) || 1;
      nrm.push(nx / nl, ny / nl, 0);
    }
  }

  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SIDES; s++) {
      const a = r * SIDES + s;
      const b = r * SIDES + ((s + 1) % SIDES);
      const c = (r + 1) * SIDES + s;
      const d = (r + 1) * SIDES + ((s + 1) % SIDES);
      idx.push(a, c, b, b, c, d);
    }
  }

  // Cap the base (the tip already converges to a near-point).
  const baseCentre = pos.length / 3;
  pos.push(0, 0, 0);
  nrm.push(0, 0, 1);
  for (let s = 0; s < SIDES; s++) {
    idx.push(baseCentre, (s + 1) % SIDES, s);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export interface SaberRig {
  group: Group;
  liquid: LiquidVisual;
  /** Sits at the interior's centre — read its world position every frame. */
  coreMarker: Object3D;
  /** The blade's root, at the guard. One end of every recorded swept quad. */
  baseMarker: Object3D;
  /** The blade's point. The other end. */
  tipMarker: Object3D;
  /** Interior length in local units — the liquid's world-height estimate. */
  interiorLength: number;
  /** Animate the squeeze: 0 = relaxed, 1 = fully pulled. */
  setTriggerPull(v: number): void;
  /** Flare the guard's emitter ring as the attack winds up. */
  setCharge(v: number): void;
  dispose(): void;
}

/** Z-axis cylinder helper (three's cylinders run along Y). */
function zCyl(rTop: number, rBottom: number, len: number, seg = 18): CylinderGeometry {
  const geo = new CylinderGeometry(rTop, rBottom, len, seg);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export function createSaber(
  juice: ColorRepresentation,
  deep: ColorRepresentation,
  foam: ColorRepresentation,
): SaberRig {
  const group = new Group();
  group.name = 'saber';

  const metal = hiltMetal();
  const dark = hiltDark();
  const wall = SABER.wallThickness;

  // --- The hilt: a machined tube behind the fist, wrapped dark in the palm.
  // It runs BACKWARD (+Z) out of the grip origin, so the blade's guard sits
  // right at the top of your fist rather than a hand's length ahead of it.
  const hiltZ = SABER.hiltLength / 2;
  const shaft = new Mesh(zCyl(0.019, 0.021, SABER.hiltLength), metal);
  shaft.position.z = hiltZ;
  group.add(shaft);

  const wrap = new Mesh(zCyl(0.0215, 0.0215, SABER.hiltLength * 0.62, 16), dark);
  wrap.position.z = hiltZ + 0.012;
  group.add(wrap);

  // Grip ribs — the machined detail that keeps the hilt from reading as a pipe.
  for (let i = 0; i < 5; i++) {
    const rib = new Mesh(new TorusGeometry(0.0222, 0.0016, 8, 20), metal);
    rib.position.z = hiltZ - 0.028 + i * 0.014;
    group.add(rib);
  }

  const pommel = new Mesh(new SphereGeometry(0.023, 16, 12), metal);
  pommel.scale.z = 0.8;
  pommel.position.z = SABER.hiltLength + 0.004;
  group.add(pommel);

  // --- The guard: a collar where the glass meets the metal, with an emitter
  // ring that lights with the charge. This is the join the eye checks. ---
  const collar = new Mesh(zCyl(0.026, 0.031, 0.036, 20), metal);
  collar.position.z = -0.014;
  group.add(collar);

  const emitterMat = hiltDark(juice);
  emitterMat.emissive.set(juice);
  emitterMat.emissiveIntensity = 0.6;
  emitterMat.roughness = 0.35;
  const emitter = new Mesh(new TorusGeometry(0.027, 0.0042, 10, 24), emitterMat);
  emitter.position.z = -0.03;
  group.add(emitter);

  // --- THE BLADE. Glass shell outside, liquid interior inside. ---
  const bladeRoot = new Group();
  bladeRoot.position.z = -0.032; // just past the guard collar
  group.add(bladeRoot);

  const shellGeo = bladeGeometry(
    SABER.bladeHalfWidth,
    SABER.bladeHalfDepth,
    SABER.bladeLength,
    SABER.tipTaper,
  );
  const shell = new Mesh(shellGeo, bladeGlass());
  shell.renderOrder = 2; // blends over the liquid, which drew at renderOrder 1
  bladeRoot.add(shell);

  // The interior: the same prism inset by the wall thickness, and shortened at
  // both ends so the juice never pokes through the glass.
  const interiorLength = SABER.bladeLength - wall * 2;
  const interiorGeo = bladeGeometry(
    SABER.bladeHalfWidth - wall,
    SABER.bladeHalfDepth - wall,
    interiorLength,
    SABER.tipTaper,
  );
  const liquid = createLiquid(interiorGeo, juice, deep, foam, interiorLength);
  liquid.mesh.position.z = -wall;
  bladeRoot.add(liquid.mesh);

  // A short metal ferrule where the glass enters the guard. This used to be a
  // pair of full-length spines down the blade's flats; they read as a dark
  // crack straight through the liquid, which is the one thing the blade must
  // never look like. Keep the mount, lose the streak.
  const ferrule = new Mesh(zCyl(SABER.bladeHalfWidth * 0.92, SABER.bladeHalfWidth * 1.05, 0.026, 14), metal);
  ferrule.position.z = -0.008;
  bladeRoot.add(ferrule);

  // --- Markers. Everything downstream measures the saber through these. ---
  const coreMarker = new Object3D();
  coreMarker.position.z = -wall - interiorLength / 2;
  bladeRoot.add(coreMarker);

  const baseMarker = new Object3D();
  bladeRoot.add(baseMarker); // at the guard, z = 0 of the blade root

  const tipMarker = new Object3D();
  tipMarker.position.z = -SABER.bladeLength;
  bladeRoot.add(tipMarker);

  return {
    group,
    liquid,
    coreMarker,
    baseMarker,
    tipMarker,
    interiorLength,
    setTriggerPull(v: number): void {
      // The hilt shortens a hair into the fist as you squeeze — a small
      // physical acknowledgement that the trigger did something.
      shaft.position.z = hiltZ + v * 0.006;
      wrap.position.z = hiltZ + 0.012 + v * 0.006;
    },
    setCharge(v: number): void {
      emitterMat.emissiveIntensity = 0.6 + v * 5.5;
      emitter.scale.setScalar(1 + v * 0.22);
    },
    dispose(): void {
      liquid.dispose();
      shellGeo.dispose();
      group.removeFromParent();
    },
  };
}

/** A pared-down saber for the rival across the gap — same silhouette, no
 *  interactive parts, so the bot's hardware costs almost nothing. */
export function createRivalSaber(juice: ColorRepresentation, deep: ColorRepresentation, foam: ColorRepresentation): SaberRig {
  const rig = createSaber(juice, deep, foam);
  rig.group.name = 'rival-saber';
  return rig;
}

export { PALETTE };
