/**
 * THE LIQUID — the heart of the whole game.
 *
 * Ported from SPLASH WARS' pistol tanks and re-cut for a sword. The juice
 * inside a blade is one mesh (a slightly-shrunk copy of the blade's interior)
 * whose fragment shader CLIPS everything above a liquid surface plane defined
 * in WORLD space. Because the plane lives in world space the surface stays
 * level however you tilt, swing or roll the saber — the Half-Life: Alyx bottle
 * illusion. Where the clip cuts the mesh open you see its back faces, which we
 * paint as a flat bright "surface of the liquid" colour: the classic cheap
 * fake for a liquid's top.
 *
 * What a SABER adds over a pistol tank:
 *
 *  - It GLOWS. The liquid is the light source in a scene lit by one hard sun
 *    and a lot of nothing, so the body of the juice is emissive and gets
 *    brighter the more of it there is left.
 *  - It CHARGES. Holding the trigger pumps `charge` toward 1: the juice heats
 *    from its body colour toward its foam colour, the ripples double their
 *    rate, and a travelling pulse runs up the blade toward the tip so you can
 *    SEE the attack building in your hand.
 *  - It is a tall thin vessel held at one end, so the surface plane spends
 *    most of its life cutting the blade lengthwise rather than across. Hold
 *    the saber upright and the juice pools down at the guard; lay it flat and
 *    it spreads the length of the blade. That is the whole trick, for free,
 *    because the plane never stopped being level.
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { SABER } from '../config.js';

// ---------------------------------------------------------------------------
// The slosh simulation — a damped 2D pendulum for the surface tilt.
// ---------------------------------------------------------------------------

/**
 * Tracks the liquid surface's tilt (rise/run in world X and Z) and a scalar
 * "energy" that drives the shader ripple. Feed it the blade's world-space
 * acceleration every frame.
 */
export class SloshSim {
  tiltX = 0;
  tiltZ = 0;
  energy = 0;
  private velX = 0;
  private velZ = 0;

  update(dt: number, accel: Vector3): void {
    const s = SABER.slosh;
    // The surface tips AWAY from the direction of acceleration (the juice lags
    // the blade), is pulled level by the spring and calmed by the damping.
    const driveX = -accel.x * s.accelGain;
    const driveZ = -accel.z * s.accelGain;
    this.velX += (driveX - s.spring * 0.01 * this.tiltX - s.damping * 0.1 * this.velX) * dt * 60;
    this.velZ += (driveZ - s.spring * 0.01 * this.tiltZ - s.damping * 0.1 * this.velZ) * dt * 60;
    this.tiltX += this.velX * dt;
    this.tiltZ += this.velZ * dt;
    const clamp = s.maxTilt;
    this.tiltX = Math.max(-clamp, Math.min(clamp, this.tiltX));
    this.tiltZ = Math.max(-clamp, Math.min(clamp, this.tiltZ));

    // Ripple energy: spikes with jolts (vertical ones count too), then dies.
    const jolt = Math.min(1.4, accel.length() * 0.02);
    this.energy = Math.max(this.energy * Math.exp(-s.energyDecay * dt), jolt);
  }

  reset(): void {
    this.tiltX = this.tiltZ = this.velX = this.velZ = this.energy = 0;
  }
}

// ---------------------------------------------------------------------------
// The clipped-liquid shader.
// ---------------------------------------------------------------------------

const LIQUID_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocalPos;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vLocalPos = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const LIQUID_FRAG = /* glsl */ `
  uniform vec3 uPlanePoint;   // a world-space point on the liquid surface
  uniform vec3 uPlaneNormal;  // world up, tilted by the slosh sim
  uniform float uTime;
  uniform float uSlosh;       // ripple energy 0..~1
  uniform float uCharge;      // 0 = idle, 1 = fully wound up
  uniform float uFill;        // 0..1, how much juice is left
  uniform float uBladeLen;    // blade length in local units, for the pulse
  uniform vec3 uColor;        // lit juice body
  uniform vec3 uDeepColor;    // shadowed depths
  uniform vec3 uFoamColor;    // meniscus / surface sheen / charge heat
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocalPos;

  void main(){
    // Charging churns the juice: the ripples run faster and cut deeper.
    float agitation = 1.0 + uCharge * 2.4;

    // Signed distance above the (tilted) surface plane, wobbled by two
    // crossing travelling ripples so churned juice visibly rolls.
    float ripple =
      sin(dot(vWorldPos.xz, vec2(38.0, 26.0)) - uTime * 13.0 * agitation) * 0.5 +
      sin(dot(vWorldPos.xz, vec2(-22.0, 31.0)) + uTime * 9.0 * agitation) * 0.5;
    float d = dot(vWorldPos - uPlanePoint, normalize(uPlaneNormal))
            + ripple * 0.006 * (uSlosh + uCharge * 0.55) * ${SABER.slosh.rippleGain.toFixed(2)};
    if (d > 0.0) discard;

    if (!gl_FrontFacing) {
      // The open cut — the liquid's top surface. Flat and bright, shimmering.
      float shimmer = 0.92 + 0.08 * ripple * uSlosh * 4.0;
      vec3 top = mix(uFoamColor, vec3(1.0), uCharge * 0.5);
      gl_FragColor = vec4(top * shimmer * (1.0 + uCharge * 0.9), 1.0);
      return;
    }

    // The body of the juice: fixed-key shading so it reads THICK — deep
    // colour below, lit colour up top.
    float up = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeepColor, uColor, up * 0.75 + 0.25);

    // Meniscus: a foam band hugging the underside of the surface plane.
    col = mix(col, uFoamColor, smoothstep(-0.010, -0.002, d) * 0.85);

    // THE CHARGE PULSE. A bright band runs up the blade toward the tip while
    // you hold the trigger, faster and hotter as the charge fills — the tell
    // that says "this is wound up" from across the arena.
    float alongBlade = clamp(-vLocalPos.z / max(uBladeLen, 0.001), 0.0, 1.0);
    float pulse = pow(max(0.0, sin((alongBlade * 3.0 - uTime * (1.4 + uCharge * 4.5)) * 3.14159)), 6.0);
    col += uFoamColor * pulse * uCharge * 1.5;
    // …and the whole body heats toward the foam colour as it winds up.
    col = mix(col, uFoamColor, uCharge * 0.32);

    // Wet gloss: a Blinn-Phong glint off a fixed key light, tracking the
    // camera, so the juice gleams as the blade turns in your hand. Two lobes —
    // a broad wet sheen plus a tight hot pin inside it — because glass gloss
    // IS that contrast; a soft glow alone just looks washed out.
    vec3 n = normalize(vWorldNormal);
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h = normalize(lightDir + viewDir);
    float ndh = max(dot(n, h), 0.0);
    col += pow(ndh, 34.0) * 0.35;
    col += pow(ndh, 190.0) * 1.15;
    // Fresnel skin: the surface turns to a bright film at grazing angles.
    col += pow(1.0 - max(dot(n, viewDir), 0.0), 4.0) * 0.28;

    // IT GLOWS. This liquid is the brightest thing on the moon: the emissive
    // floor rises with how much is left, so a near-empty blade visibly dims
    // and you can read your own ammo out of the corner of your eye.
    col += uColor * (0.30 + uFill * 0.55 + uCharge * 0.75);

    // FULLY OPAQUE: thick juice is not see-through. Anything less and you
    // catch the blade's far wall (and the stars) straight through the liquid.
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A live liquid volume: parent `mesh` inside the blade, then call update(). */
export interface LiquidVisual {
  mesh: Mesh;
  material: ShaderMaterial;
  slosh: SloshSim;
  /**
   * Drive the illusion. `fill` is 0..1 (this IS the ammo gauge), `center` the
   * blade interior's world-space centre, `height` its interior world length,
   * `charge` the 0..1 attack wind-up.
   */
  update(
    time: number,
    dt: number,
    fill: number,
    charge: number,
    center: Vector3,
    height: number,
    accel: Vector3,
  ): void;
  dispose(): void;
}

const _up = new Vector3();
const _point = new Vector3();

export function createLiquid(
  interiorGeo: BufferGeometry,
  juice: ColorRepresentation,
  deep: ColorRepresentation,
  foam: ColorRepresentation,
  bladeLength = SABER.bladeLength,
): LiquidVisual {
  const material = new ShaderMaterial({
    uniforms: {
      uPlanePoint: { value: new Vector3() },
      uPlaneNormal: { value: new Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uSlosh: { value: 0 },
      uCharge: { value: 0 },
      uFill: { value: 1 },
      uBladeLen: { value: bladeLength },
      uColor: { value: new Color(juice) },
      uDeepColor: { value: new Color(deep) },
      uFoamColor: { value: new Color(foam) },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    // Opaque: it renders in the opaque pass and writes depth, and the glass
    // shell then blends over the top of it in the transparent pass — exactly
    // the sort order the illusion needs.
    transparent: false,
    side: DoubleSide,
  });

  const mesh = new Mesh(interiorGeo, material);
  mesh.renderOrder = 1; // before the glass shell blends over it
  // The liquid is a light source in a very dark scene; never let the frustum
  // cull it early because its bounding sphere was computed for a still blade.
  mesh.frustumCulled = false;
  const slosh = new SloshSim();

  return {
    mesh,
    material,
    slosh,
    update(time, dt, fill, charge, center, height, accel) {
      slosh.update(dt, accel);
      // Surface plane: a world-up normal tipped by the slosh pendulum…
      _up.set(slosh.tiltX, 1, slosh.tiltZ).normalize();
      // …passing through the interior's centre offset by the fill level.
      // Measuring the offset along world up (not the blade's own axis) keeps
      // the volume believable however the saber is held.
      _point.copy(center).addScaledVector(_up, (Math.min(1, Math.max(0, fill)) - 0.5) * height);
      material.uniforms.uPlanePoint.value.copy(_point);
      material.uniforms.uPlaneNormal.value.copy(_up);
      material.uniforms.uTime.value = time;
      material.uniforms.uSlosh.value = slosh.energy;
      material.uniforms.uCharge.value = charge;
      material.uniforms.uFill.value = fill;
      // Fully drained: hide the mesh so no backface slivers linger.
      mesh.visible = fill > 0.005;
    },
    dispose() {
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// The thrown energy — the same juice, cut loose.
// ---------------------------------------------------------------------------

const ARC_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main(){
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * The released sheet. `vUv.x` runs along the swing (0 = the oldest end of the
 * stroke, 1 = the newest), `vUv.y` across the blade (0 = base, 1 = tip). We
 * use both: energy streams along the stroke, and the sheet burns hottest at
 * the tip edge where the blade was moving fastest.
 */
const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform float uTime;
  uniform float uCharge;
  uniform float uFade;       // 1 at birth → 0 at death
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main(){
    // Streaks running along the stroke — the energy is still moving the way
    // the blade moved.
    float streak = sin((vUv.x * 9.0 - uTime * 7.0) * 3.14159) * 0.5 + 0.5;
    streak = pow(streak, 2.2);

    // Hotter toward the tip edge, where the blade had the most speed.
    float tipHeat = pow(vUv.y, 1.6);

    // The leading edge of the stroke burns brightest and the trailing end
    // frays out, so the sheet reads as thrown rather than merely placed.
    float lead = smoothstep(0.0, 0.35, vUv.x);
    float trail = 1.0 - smoothstep(0.72, 1.0, vUv.x);

    // Colour first, heat second. Pushing the whole sheet toward the foam
    // colour and then multiplying it by a large additive gain drives every
    // channel to clip and the crescent arrives WHITE — at which point the
    // player cannot tell their own attack from the rival's, which is the one
    // thing the two palettes exist to prevent. The hot core stays confined to
    // the tip edge and the streak crests.
    vec3 col = mix(uColor, uHotColor, tipHeat * 0.3 + streak * 0.22 + uCharge * 0.16);
    // Kept deliberately BRIGHT and mostly solid. This is the one object in the
    // game that has to be spotted, identified and dodged in under a second,
    // from seven metres, against a black sky — a tasteful wisp reads as nothing
    // at all. The streaks modulate an already-hot base rather than defining it.
    float a = (0.72 + streak * 0.28) * (0.6 + tipHeat * 0.55) * lead * trail;
    a *= uFade * (0.8 + uCharge * 0.6);
    // Additive: alpha rides in the colour, so premultiply the intensity.
    gl_FragColor = vec4(col * a * (1.5 + uCharge * 0.9), a);
  }
`;

export interface ArcMaterialHandle {
  material: ShaderMaterial;
  setFade(f: number): void;
  setTime(t: number): void;
}

export function createArcMaterial(
  juice: ColorRepresentation,
  foam: ColorRepresentation,
  charge: number,
): ArcMaterialHandle {
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(juice) },
      uHotColor: { value: new Color(foam) },
      uTime: { value: 0 },
      uCharge: { value: charge },
      uFade: { value: 1 },
    },
    vertexShader: ARC_VERT,
    fragmentShader: ARC_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  return {
    material,
    setFade(f) {
      material.uniforms.uFade.value = f;
    },
    setTime(t) {
      material.uniforms.uTime.value = t;
    },
  };
}
