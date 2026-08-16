/**
 * The duelling pads — octagonal landing platforms bolted to the regolith.
 *
 * Structure over decoration: a machined deck, a hazard kick-band around its
 * flank, corner bolts, and a bent rim light in the duelist's own colour. The
 * rim is one continuous swept tube rather than eight straight bars, because
 * real bent tubing has no mitred corners and butt-jointed bars leave a visible
 * notch at every vertex — the one detail that gives a neon rim away.
 *
 * The pads are the only man-made thing for two kilometres, so they are lit
 * from within: on a world with one hard light and no fill, an unlit deck under
 * your feet would simply be a black hole you were standing on.
 */

import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  TubeGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { CHAMFER, EDGE_HALF, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, OCTAGON_VERTICES, PALETTE, PLATFORM } from '../config.js';
import { octagonSlab } from './octagon.js';

/** Just proud of the slab's bevelled top face — the extrude bevel overhangs,
 *  so the real deck surface is at +0.015, not y = 0. */
const DECK_TOP = 0.02;

/** The rim path: the octagon outline with every corner eased into a short arc,
 *  so a tube swept along it reads as ONE piece of bent glass. */
function rimPath(corner = 0.05): Vector3[] {
  const pts: Vector3[] = [];
  const n = OCTAGON_VERTICES.length;
  const at = (i: number): Vector3 => {
    const [x, z] = OCTAGON_VERTICES[((i % n) + n) % n];
    return new Vector3(x, PLATFORM.rimLift, z);
  };
  for (let i = 0; i < n; i++) {
    const cur = at(i);
    const prev = at(i - 1);
    const next = at(i + 1);
    // Never eat more than half of either adjoining edge.
    const r = Math.min(corner, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2);
    const a = cur.clone().lerp(prev, r / cur.distanceTo(prev));
    const b = cur.clone().lerp(next, r / cur.distanceTo(next));
    pts.push(a);
    for (const t of [0.35, 0.65]) {
      const u = 1 - t;
      pts.push(
        new Vector3(
          u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
          PLATFORM.rimLift,
          u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
        ),
      );
    }
    pts.push(b);
  }
  return pts;
}

function makeRim(color: number): Group {
  const group = new Group();
  const curve = new CatmullRomCurve3(rimPath(), true, 'catmullrom', 0.25);

  const coreMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.55) });
  coreMat.userData.role = 'rim-core';
  const core = new Mesh(new TubeGeometry(curve, 168, 0.011, 8, true), coreMat);
  group.add(core);

  // The halo: a fatter, additive sleeve over the core. With no air to scatter
  // in, a light out here has no real glow — but a bare unlit tube reads as
  // plastic piping, and this is the cheapest way to say "powered".
  const haloMat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  haloMat.userData.role = 'rim-halo';
  const halo = new Mesh(new TubeGeometry(curve, 120, 0.026, 8, true), haloMat);
  halo.renderOrder = 3;
  group.add(halo);

  return group;
}

/** Hazard chevrons around the deck's flank — the one loud graphic out here. */
function makeKickBand(color: number): Group {
  const group = new Group();
  const n = OCTAGON_VERTICES.length;
  const mat = new MeshStandardMaterial({
    color: 0x1a1d22,
    roughness: 0.7,
    metalness: 0.35,
    emissive: new Color(color),
    emissiveIntensity: 0.1,
    side: DoubleSide,
  });
  for (let i = 0; i < n; i++) {
    const [x1, z1] = OCTAGON_VERTICES[i];
    const [x2, z2] = OCTAGON_VERTICES[(i + 1) % n];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const panel = new Mesh(new CylinderGeometry(0.001, 0.001, 1, 4), mat);
    panel.geometry.dispose();
    // A flat quad standing on the edge, sized to it.
    const geo = new CylinderGeometry(len / 2, len / 2, PLATFORM.thickness * 0.72, 4, 1, true);
    panel.geometry = geo;
    panel.rotation.y = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 4;
    panel.scale.set(1, 1, 0.02);
    panel.position.set((x1 + x2) / 2, -PLATFORM.thickness * 0.5, (z1 + z2) / 2);
    group.add(panel);
  }
  return group;
}

function makeCornerBolts(): Group {
  const group = new Group();
  const geo = new CylinderGeometry(0.014, 0.014, 0.012, 8);
  const mat = new MeshStandardMaterial({ color: PALETTE.steel, metalness: 0.95, roughness: 0.4 });
  for (const [x, z] of OCTAGON_VERTICES) {
    const bolt = new Mesh(geo, mat);
    bolt.position.set(x * 0.9, DECK_TOP, z * 0.9);
    group.add(bolt);
  }
  return group;
}

/**
 * One pad. `color` is the duelist's blade colour, which the rim, the deck's
 * emissive and the underlight all inherit — at 7.5 m across a black plain,
 * colour is how you know which pad is yours at a glance.
 */
export function makePlatform(color: number): Group {
  const group = new Group();

  const deckMat = new MeshStandardMaterial({
    color: 0x6f7681,
    metalness: 0.88,
    roughness: 0.42,
    emissive: new Color(color),
    emissiveIntensity: 0.07,
  });
  deckMat.userData.role = 'deck';
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), deckMat);
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  group.add(makeKickBand(color));
  group.add(makeCornerBolts());
  group.add(makeRim(color));

  // A centre ring on the deck: where you stand, and the only mark that tells
  // you how far you have drifted while dodging.
  const markMat = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.3),
    transparent: true,
    opacity: 0.42,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  markMat.userData.role = 'rim-halo';
  const mark = new Mesh(new RingGeometry(0.3, 0.325, 40), markMat);
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = DECK_TOP;
  group.add(mark);

  // Underlight: the pad throws its own colour onto the dust it stands on.
  const glow = new PointLight(color, 2.4, 4.5, 2);
  glow.position.y = 0.12;
  group.add(glow);

  return group;
}

/** Recolour a built pad — rim, halo, deck emissive and underlight together. */
export function tintPlatform(pad: Object3D, color: number): void {
  const core = new Color(color).lerp(new Color(0xffffff), 0.55);
  pad.traverse((node) => {
    if (node instanceof PointLight) {
      node.color.set(color);
      return;
    }
    const mesh = node as Mesh;
    const mat = mesh.material as MeshStandardMaterial | MeshBasicMaterial | undefined;
    if (!mat || Array.isArray(mat)) return;
    switch (mat.userData.role) {
      case 'rim-core':
        mat.color.copy(core);
        break;
      case 'rim-halo':
        mat.color.set(color);
        break;
      case 'deck':
        (mat as MeshStandardMaterial).emissive?.set(color);
        break;
      default:
        break;
    }
  });
}

/** The pad's own half-extents, for boundary checks. */
export const PAD_EXTENT = {
  halfWidth: OCTAGON_HALF_WIDTH,
  halfDepth: OCTAGON_HALF_DEPTH,
  edgeHalf: EDGE_HALF,
  chamfer: CHAMFER,
};
