/**
 * THE MOON.
 *
 * A regolith plain, generated at boot from a seed. The whole look rests on one
 * fact about the real place: there is no atmosphere. That means
 *
 *  - no haze, so distance does NOT fade things out — the far mesas are as
 *    crisp as the dust at your feet, and the horizon is a hard, close line;
 *  - one light source and no fill, so shadows are pitch black and every
 *    crater rim is a knife-edge of white against nothing;
 *  - the ground is dark. Regolith reflects about as much light as worn
 *    asphalt. It only LOOKS bright in photographs because it is lit by an
 *    unfiltered sun. Paint it white and you lose the moon entirely.
 *
 * The terrain is one displaced disc: craters are punched into it analytically
 * (a bowl plus a raised rim), then a little fractal noise roughens everything.
 * Boulders are scattered instanced icosahedra. The horizon is close on the
 * moon — about 2.4 km for a standing adult — so the disc ends in a hard edge
 * against the stars rather than fading, which is the correct look.
 */

import {
  BufferAttribute,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { ARENA_GAP, PALETTE } from '../config.js';
import { mulberry32 } from './rng.js';

const TERRAIN_RADIUS = 190;
/** Segments around the disc, and rings out from the centre. */
const TERRAIN_SPOKES = 128;
const TERRAIN_RINGS = 104;
/**
 * Radial vertex distribution. A ring mesh spaces its rings evenly in radius,
 * which spends most of its vertices on ground two hundred metres away that
 * nobody will ever look at closely, and leaves the dust around your own feet —
 * the only terrain seen from two metres — as huge flat triangles. Raising the
 * normalised radius to this power packs the rings in close and stretches them
 * out toward the horizon, where a triangle can be twenty metres wide and still
 * read as crisp.
 */
const RADIAL_BIAS = 2.4;

/**
 * The duelling ground is levelled.
 *
 * Both pads stand at y = 0, so any terrain height under them leaves them
 * visibly hovering — and no single global offset can fix that, because the
 * ground is at a different height under each one. Rather than tilt the pads
 * onto the dust (which would tilt the play space, which is unforgivable in
 * VR), the plain is flattened out to FLAT_INNER metres from the arena's
 * centre and blended back to its natural profile by FLAT_OUTER. A landing pad
 * on a graded site is also just what this place would look like.
 */
const FLAT_INNER = 5.5;
const FLAT_OUTER = 15;
/** Where the arena's centre sits in world XZ — midway between the pads. */
const ARENA_CENTRE_Z = -ARENA_GAP / 2;

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

/**
 * Height of the regolith at a point — craters, then roughness. Pure: the same
 * point always returns the same height, so anything that needs to SIT on the
 * ground (boulders, pads) lands on exactly the surface that gets drawn. The
 * per-vertex grit is deliberately not in here; it is added to the mesh alone,
 * where it costs nothing and cannot desynchronise a lookup.
 */
function terrainHeight(x: number, z: number, craters: Crater[]): number {
  let h = 0;

  for (const c of craters) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > c.r * 1.45) continue;
    const t = d / c.r;
    if (t < 1) {
      // The bowl: a smooth depression, deepest at the centre.
      h -= c.depth * (1 - t * t) * 0.85;
      // …under a raised rim that peaks right at the lip.
      h += c.depth * 0.42 * Math.pow(t, 6);
    } else {
      // The ejecta blanket outside the rim, falling away fast.
      const e = (t - 1) / 0.45;
      h += c.depth * 0.42 * (1 - e) * (1 - e);
    }
  }

  // Fractal roughness — four octaves of cheap trig noise. The wavelengths are
  // chosen against the SCALES A PLAYER ACTUALLY SEES: rolling ground you read
  // across the whole plain, dunes at conversational distance, hummocks right
  // at the pads, and a fine grain that only shows within a couple of metres.
  // Skip any of those and the plain reads as a smooth cone.
  const oct = (fx: number, fz: number, amp: number): number =>
    (Math.sin(x * fx + z * fz * 1.7) * Math.cos(z * fz - x * fx * 0.6) +
      Math.sin((x + z) * fx * 0.5)) *
    amp;
  h += oct(0.026, 0.022, 0.85); // ~250 m swells
  h += oct(0.085, 0.097, 0.3); // ~70 m rolls
  h += oct(0.31, 0.27, 0.075); // ~20 m dunes
  h += oct(1.15, 0.94, 0.017); // ~6 m hummocks

  // Level the duelling ground — see the note on FLAT_INNER.
  const fromCentre = Math.hypot(x, z - ARENA_CENTRE_Z);
  if (fromCentre < FLAT_OUTER) {
    const t = Math.max(0, (fromCentre - FLAT_INNER) / (FLAT_OUTER - FLAT_INNER));
    h *= t * t * (3 - 2 * t); // smoothstep, so the grade has no crease
  }

  return h;
}

/** The regolith plain. */
function buildTerrain(seed: number): { mesh: Mesh; craters: Crater[]; heightAt: (x: number, z: number) => number } {
  const rand = mulberry32(seed);

  // Craters, scattered but never on top of the duelling ground — the pads
  // stand on a deliberately flat patch, so the arena floor stays readable.
  const craters: Crater[] = [];
  // The duelling ground itself stays clear: a crater under a pad would tilt
  // the one surface the whole fight is read against. Everything past that is
  // fair game, and the nearest rims land close enough to be cover you can see
  // the texture of.
  const keepClear = ARENA_GAP / 2 + 3.4;
  for (let i = 0; i < 120; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 5 + Math.pow(rand(), 0.55) * (TERRAIN_RADIUS - 16);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist - ARENA_GAP / 2;
    // Big craters far out, small ones near — the near field stays walkable.
    const scale = Math.min(1, dist / 55);
    const r = 1.1 + rand() * (2.2 + scale * 28);
    if (Math.hypot(x, z + ARENA_GAP / 2) < keepClear + r) continue;
    craters.push({ x, z, r, depth: r * (0.15 + rand() * 0.14) });
  }

  // A RING mesh, not a circle: three.js' CircleGeometry is a triangle FAN —
  // one centre vertex and a rim — so it has no interior vertices to displace
  // and any height field applied to it collapses into a smooth cone. A ring
  // with an inner radius of nearly zero gives a genuine radial grid.
  const geo = new RingGeometry(0.001, TERRAIN_RADIUS, TERRAIN_SPOKES, TERRAIN_RINGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;

  // Redistribute the rings so the detail sits where the player is standing.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const scaled = TERRAIN_RADIUS * Math.pow(r / TERRAIN_RADIUS, RADIAL_BIAS);
    pos.setX(i, (x / r) * scaled);
    pos.setZ(i, (z / r) * scaled);
  }
  const noise = mulberry32(seed ^ 0x9e37);
  const colors = new Float32Array(pos.count * 3);
  const light = new Color(PALETTE.regolith);
  const dark = new Color(PALETTE.regolithDark);
  const rim = new Color(PALETTE.craterRim);
  const tmp = new Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z, craters);
    // The grit lives here and only here — see the note on terrainHeight.
    pos.setY(i, h + (noise() - 0.5) * 0.012);
    // Vertex colour does the geology: high ground catches the pale rim tone,
    // hollows go to the dark dust that has settled in them. The height range
    // is roughly ±1.5 m across the plain, so the mapping is scaled to that
    // rather than to the metre it used to assume — otherwise almost every
    // vertex lands mid-grey and the whole disc reads as one flat tone.
    const k = Math.min(1, Math.max(0, h * 0.34 + 0.5));
    tmp.copy(dark).lerp(light, k);
    if (h > 0.5) tmp.lerp(rim, Math.min(1, (h - 0.5) * 0.5));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({
      vertexColors: true,
      // Regolith is powder: it is rough, it is not metal, and it has a faint
      // back-scatter that makes the full moon look flat. Roughness near 1 is
      // the closest a standard material gets to that for free.
      roughness: 0.97,
      metalness: 0,
    }),
  );
  mesh.name = 'moon-terrain';
  mesh.receiveShadow = true;

  return { mesh, craters, heightAt: (x, z) => terrainHeight(x, z, craters) };
}

/** Scattered boulders — instanced, so a few hundred cost one draw call. */
function buildBoulders(seed: number, heightAt: (x: number, z: number) => number): InstancedMesh {
  const rand = mulberry32(seed ^ 0x51ed);
  const COUNT = 420;
  const geo = new IcosahedronGeometry(1, 0); // faceted: sharp shadows, cheap
  const mat = new MeshStandardMaterial({ color: PALETTE.regolithDark, roughness: 0.95, metalness: 0 });
  const mesh = new InstancedMesh(geo, mat, COUNT);
  mesh.name = 'moon-boulders';

  const m = new Matrix4();
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  // Rocks may come right up to the pads — a scatter of small stones just
  // beyond the deck is what gives the near ground a sense of scale, and
  // without it the first ten metres read as a smooth grey floor.
  const keepClear = ARENA_GAP / 2 + 2.2;

  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard++ < COUNT * 8) {
    const ang = rand() * Math.PI * 2;
    const dist = 2.5 + Math.pow(rand(), 0.5) * (TERRAIN_RADIUS - 30);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist - ARENA_GAP / 2;
    if (Math.hypot(x, z + ARENA_GAP / 2) < keepClear) continue;
    // Bigger rocks live further out; the near field keeps sightlines open.
    const size = (0.16 + rand() * 0.55) * (0.5 + Math.min(1, dist / 45) * 2.4);
    p.set(x, heightAt(x, z) + size * 0.32, z);
    q.set(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    // Squashed: a sphere-ish rock reads as a ball, a flattened one as stone.
    s.set(size, size * (0.5 + rand() * 0.4), size * (0.75 + rand() * 0.5));
    mesh.setMatrixAt(placed++, m.compose(p, q, s));
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Far mesas: the crisp, close lunar horizon. Flat-shaded ridges standing on
 * the rim of the disc, sharing the terrain's dark tone so they read as the
 * same ground seen a long way off — with NO haze between, because there isn't
 * any air to make haze out of.
 */
function buildHorizonRidges(seed: number): Group {
  const rand = mulberry32(seed ^ 0x2b1d);
  const group = new Group();
  group.name = 'moon-horizon';
  const mat = new MeshStandardMaterial({ color: PALETTE.regolithDark, roughness: 0.98, metalness: 0 });
  const geo = new IcosahedronGeometry(1, 1);

  for (let i = 0; i < 34; i++) {
    const ang = (i / 34) * Math.PI * 2 + rand() * 0.12;
    const dist = TERRAIN_RADIUS * (0.72 + rand() * 0.2);
    const h = 6 + rand() * 26;
    const ridge = new Mesh(geo, mat);
    ridge.position.set(Math.cos(ang) * dist, h * 0.1, Math.sin(ang) * dist - ARENA_GAP / 2);
    ridge.scale.set(14 + rand() * 30, h, 10 + rand() * 20);
    ridge.rotation.y = rand() * Math.PI;
    group.add(ridge);
  }
  return group;
}

export interface MoonSurface {
  group: Group;
  /** Ground height under a point — used to sit the pads on real terrain. */
  heightAt(x: number, z: number): number;
}

export function buildMoon(seed = 20260816): MoonSurface {
  const group = new Group();
  group.name = 'moon';

  const { mesh, heightAt } = buildTerrain(seed);
  group.add(mesh);
  group.add(buildBoulders(seed, heightAt));
  group.add(buildHorizonRidges(seed));

  return { group, heightAt };
}
