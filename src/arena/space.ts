/**
 * SPACE — the backdrop, and half the reason to set a duel here.
 *
 * Three objects, each doing one job the airless sky demands:
 *
 *  - THE STARS. Fixed pixel size, never attenuated by distance, because a star
 *    is a point source: it has no angular size to shrink. With no atmosphere
 *    they also do not twinkle and they do not thin out toward the horizon —
 *    the field runs right down to the ground line and stops dead.
 *  - THE EARTH. It hangs. It does not rise or set — the moon is tidally
 *    locked, so from any one spot the Earth sits at a fixed point in the sky
 *    forever, which is the single most alien thing about standing there. It
 *    is lit by the same sun as everything else, so it shows a phase.
 *  - THE SUN. A small, hard, blindingly white disc with no halo, no rays and
 *    no glare, because every one of those effects is made of air.
 *
 * All three live on a far shell and are drawn before anything else with depth
 * writes off, so they read as infinitely distant no matter how big the arena's
 * far plane is.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { PALETTE } from '../config.js';
import { mulberry32 } from './rng.js';

/** Everything sky-side sits on this shell. */
const SKY_RADIUS = 900;

/**
 * The sun: off to the RIGHT and only a little above the horizon. Low light
 * rakes across the plain so every crater rim and boulder throws a long shadow
 * toward the player, and putting it out to the side rather than down the line
 * of the duel means it lights the rival's flank instead of either silhouetting
 * them or shining in your eyes.
 */
export const SUN_DIR = new Vector3(0.88, 0.26, -0.4).normalize();

/**
 * Where the Earth hangs: high and to the left, PAST the rival, so it sits in
 * frame the whole time you are facing your opponent. The moon is tidally
 * locked, so it does not rise, set or move — it simply hangs there for the
 * entire fight, which is the strangest true thing about standing on the moon
 * and worth the whole scene to show. An earlier version put it behind the
 * player, where it was technically present and never once seen.
 */
const EARTH_DIR = new Vector3(-0.46, 0.5, -0.73).normalize();

// ---------------------------------------------------------------------------
// Stars.
// ---------------------------------------------------------------------------

const STAR_VERT = /* glsl */ `
  attribute float size;
  varying vec3 vColor;
  void main(){
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Constant angular size: a star is a point source and has no disc to
    // shrink with distance, so no perspective attenuation.
    gl_PointSize = size;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main(){
    // A soft round core so the pixels don't read as square chips.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    float a = 1.0 - smoothstep(0.35, 1.0, r);
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

function buildStars(seed: number): Points {
  const rand = mulberry32(seed);
  const COUNT = 5200;
  const pos: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  const c = new Color();
  const p = new Vector3();

  for (let i = 0; i < COUNT; i++) {
    // A third of the field is crowded into a Milky Way band, the rest is
    // uniform on the sphere — a flat uniform scatter reads as static noise.
    if (i % 3 === 0) {
      const along = rand() * Math.PI * 2;
      const across = (rand() + rand() + rand() - 1.5) * 0.34; // ~gaussian
      p.set(Math.cos(along), Math.sin(across), Math.sin(along) * Math.cos(across));
      // Tilt the band so it cuts the sky on a diagonal.
      p.applyAxisAngle(new Vector3(1, 0, 0.35).normalize(), 0.9).normalize();
    } else {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      p.set(s * Math.cos(th), u, s * Math.sin(th));
    }
    pos.push(p.x * SKY_RADIUS, p.y * SKY_RADIUS, p.z * SKY_RADIUS);

    // Real star colours: mostly blue-white, a scatter of orange giants.
    const warm = rand();
    if (warm > 0.88) c.setHSL(0.07, 0.55, 0.72);
    else if (warm > 0.72) c.setHSL(0.12, 0.28, 0.85);
    else c.setHSL(0.58, 0.22 * rand(), 0.88 + rand() * 0.12);
    // A steep brightness distribution: a few bright anchors, a haze of faint.
    const mag = Math.pow(rand(), 3.1);
    c.multiplyScalar(0.35 + mag * 0.65);
    col.push(c.r, c.g, c.b);
    size.push(1.1 + mag * 3.4);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('size', new Float32BufferAttribute(size, 1));

  const mat = new ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const stars = new Points(geo, mat);
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -100;
  return stars;
}

// ---------------------------------------------------------------------------
// The Earth.
// ---------------------------------------------------------------------------

/** A procedural Earth map: ocean, continents, ice caps, weather. */
function earthTexture(seed: number): CanvasTexture {
  const rand = mulberry32(seed);
  const W = 1024;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;

  // Ocean, deeper toward the poles where the light rakes.
  const ocean = g.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0, '#123a6b');
  ocean.addColorStop(0.5, '#2a6fd6');
  ocean.addColorStop(1, '#123a6b');
  g.fillStyle = ocean;
  g.fillRect(0, 0, W, H);

  // Continents: blobs of overlapping ellipses, biased toward mid-latitudes
  // where most real land sits, with a coastal shelf drawn under each.
  const land = new Color(PALETTE.earthLand);
  for (let i = 0; i < 15; i++) {
    const cx = rand() * W;
    const cy = H * 0.22 + rand() * H * 0.56;
    const parts = 12 + Math.floor(rand() * 18);
    // The shelf: a paler halo, drawn first so the land sits on top of it.
    for (const [pass, colour, grow] of [
      [0, 'rgba(72,140,190,0.55)', 1.35],
      [1, `#${land.getHexString()}`, 1],
    ] as const) {
      g.fillStyle = colour;
      let x = cx;
      let y = cy;
      for (let p = 0; p < parts; p++) {
        const rx = (10 + rand() * 52) * grow;
        const ry = (8 + rand() * 34) * grow;
        g.beginPath();
        g.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
        x += (rand() - 0.5) * 70;
        y += (rand() - 0.5) * 48;
        if (pass === 0 && rand() < 0.2) break;
      }
    }
  }

  // Deserts — the warm bands that keep the land from reading as one green mat.
  g.globalAlpha = 0.5;
  for (let i = 0; i < 22; i++) {
    g.fillStyle = rand() > 0.5 ? '#b89a63' : '#8f7d52';
    g.beginPath();
    g.ellipse(rand() * W, H * 0.3 + rand() * H * 0.4, 12 + rand() * 44, 8 + rand() * 20, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Ice caps.
  for (const [y, h] of [
    [0, H * 0.075],
    [H * 0.925, H * 0.075],
  ]) {
    const cap = g.createLinearGradient(0, y, 0, y + h);
    const top = y === 0;
    cap.addColorStop(0, top ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)');
    cap.addColorStop(1, top ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.95)');
    g.fillStyle = cap;
    g.fillRect(0, y, W, h);
  }

  // Weather: soft white swirls, thickest at the equator and the storm belts.
  for (let i = 0; i < 150; i++) {
    const y = rand() * H;
    const belt = Math.abs(Math.sin((y / H) * Math.PI * 3));
    g.globalAlpha = 0.05 + belt * 0.3 * rand();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(rand() * W, y, 14 + rand() * 90, 5 + rand() * 16, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** The atmosphere: a thin blue rim that brightens toward the limb. Earth's
 *  air seen edge-on is the one soft edge anywhere in this scene. */
const ATMO_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  void main(){
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewDir)));
    float a = pow(rim, 3.2) * 0.9;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main(){
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vViewDir = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

function buildEarth(seed: number): Group {
  const group = new Group();
  group.name = 'earth';

  // From the moon the Earth is about 2° across — four full moons side by side.
  // That is genuinely small, and rendered honestly it is a pale dot nobody
  // looks at twice. This is the one measurement in the scene deliberately
  // exaggerated, to roughly 5°, because the Earth hanging fixed in a black sky
  // is the whole reason to set a duel here and it has to actually land. The
  // sun next to it is left at its true half-degree, so the pair still reads as
  // "a world and a star" rather than as two decorative discs.
  const radius = SKY_RADIUS * Math.tan((5.0 * Math.PI) / 360 / 2);

  const globe = new Mesh(
    new SphereGeometry(radius, 48, 32),
    new MeshStandardMaterial({
      map: earthTexture(seed),
      roughness: 0.85,
      metalness: 0,
      // A trace of self-light so the night side is a dark disc occulting the
      // stars rather than a hole in the sky. The lit crescent still comes
      // entirely from the scene's one directional light, so the Earth shows a
      // real phase, struck from the same side as everything on the ground.
      emissive: new Color(0x101f36),
      emissiveIntensity: 1,
    }),
  );
  globe.frustumCulled = false;
  globe.rotation.y = 2.1; // present a continent, not an ocean face
  group.add(globe);

  const atmo = new Mesh(
    new SphereGeometry(radius * 1.045, 40, 26),
    new ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: { uColor: { value: new Color(0x6fb4ff) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
    }),
  );
  group.add(atmo);

  group.position.copy(EARTH_DIR).multiplyScalar(SKY_RADIUS);
  group.renderOrder = -90;
  return group;
}

// ---------------------------------------------------------------------------
// The sun.
// ---------------------------------------------------------------------------

function buildSun(): Group {
  const group = new Group();
  group.name = 'sun';
  // Half a degree across, exactly as it is from Earth — the moon is near
  // enough that the difference is not worth faking.
  const radius = SKY_RADIUS * Math.tan((0.53 * Math.PI) / 360);
  const disc = new Mesh(
    new SphereGeometry(radius, 24, 16),
    new MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  group.add(disc);
  // The ONLY glow: a very tight bloom standing in for the eye's own scatter,
  // not an atmospheric halo — there is no air here to make one.
  const bloom = new Mesh(
    new SphereGeometry(radius * 2.6, 20, 14),
    new MeshBasicMaterial({
      color: PALETTE.sun,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(bloom);
  group.position.copy(SUN_DIR).multiplyScalar(SKY_RADIUS);
  group.renderOrder = -95;
  return group;
}

// ---------------------------------------------------------------------------

export interface SpaceScene {
  group: Group;
  sunLight: DirectionalLight;
}

export function buildSpace(seed = 20260816): SpaceScene {
  const group = new Group();
  group.name = 'space';
  group.add(buildStars(seed));
  group.add(buildEarth(seed));
  group.add(buildSun());

  // ONE light, no fill. Unfiltered sunlight in vacuum is brutally strong and
  // perfectly white, and what it doesn't reach is black. The faint ambient
  // that keeps shadowed faces from vanishing entirely is added by the
  // environment module as earthshine, which is a real thing and the only
  // honest excuse for a fill light on the moon.
  const sunLight = new DirectionalLight(0xfff8ec, 3.6);
  sunLight.position.copy(SUN_DIR).multiplyScalar(60);
  sunLight.castShadow = false; // the terrain's vertex shading carries the form
  group.add(sunLight);
  group.add(sunLight.target);

  return { group, sunLight };
}

export { EARTH_DIR };
