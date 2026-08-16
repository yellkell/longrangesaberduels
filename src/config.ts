/**
 * LONG RANGE SABER DUELS — tunables.
 *
 * Two duelists stand on octagonal pads on the MOON, a long gap between them.
 * Each hand holds a GLASS SABER: a clear blade with glowing liquid visibly
 * sloshing inside it (the Half-Life: Alyx trick, inherited from SPLASH WARS).
 *
 * The liquid IS the ammo. There is no magazine and no auto-refill: you SHAKE
 * the saber to replenish it, the way you'd shake a glowstick or a bottle.
 *
 * An attack is one gesture, not a button press:
 *   hold trigger → the blade charges and the liquid churns bright
 *   swing        → the blade's swept surface is recorded, base and tip
 *   release      → that swept shape is thrown as a sheet of energy which
 *                  flies the direction you cut at the speed you cut, and the
 *                  blade loses the liquid it cost
 *
 * Every distance is in metres, every duration in seconds.
 */

import type { Vector2Tuple } from 'three';

// ---------------------------------------------------------------------------
// The arena — octagonal pads on the lunar surface.
// ---------------------------------------------------------------------------

export const OCTAGON_HALF_WIDTH = 0.98;
export const OCTAGON_HALF_DEPTH = 0.86;
export const EDGE_HALF = 0.42;
export const CHAMFER = 0.42;

/** Octagon outline (clockwise), centred on the player rig at the origin. */
export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-left
  [EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-right
  [OCTAGON_HALF_WIDTH, -CHAMFER], // right-front chamfer
  [OCTAGON_HALF_WIDTH, CHAMFER], // right-back chamfer
  [EDGE_HALF, OCTAGON_HALF_DEPTH], // back-right
  [-EDGE_HALF, OCTAGON_HALF_DEPTH], // back-left
  [-OCTAGON_HALF_WIDTH, CHAMFER], // left-back chamfer
  [-OCTAGON_HALF_WIDTH, -CHAMFER], // left-front chamfer
];

export const PLATFORM = {
  thickness: 0.16, // slab depth below the floor line
  rimLift: 0.014, // rim light-line height above the deck
};

/**
 * Centre-to-centre distance between the pads.
 *
 * Two constraints pull against each other here. It has to be far enough that
 * no swing can ever touch your rival — reach is about 1.5 m each (arm plus
 * blade), so anything past 3 m makes the thrown energy the ONLY way to land a
 * hit, which is the whole game. But every metre past that costs presence: at
 * seven metres the opponent is a distant figurine, you cannot read the wind-up
 * on their blade, and the duel stops feeling like a duel.
 *
 * So: close enough to be face to face, with a clear metre of margin over the
 * longest possible swing.
 */
export const ARENA_GAP = 4.2;

/**
 * FIXED FOVEATED RENDERING, 0..1. The headset renders the periphery — where
 * the eye has no acuity — at reduced resolution and hands back the fill rate.
 * A third is the usual compromise: most of the saving, well short of the
 * level where the region boundary shows as a head-locked band on dark
 * content (and a starfield is about as dark as content gets).
 */
export const FOVEATION = 0.33;

// ---------------------------------------------------------------------------
// Colour.
// ---------------------------------------------------------------------------

export const PALETTE = {
  // The liquid inside YOUR sabers — a hot plasma cyan.
  plasma: 0x46e8ff,
  plasmaDeep: 0x0a4d78,
  plasmaFoam: 0xd8fbff,
  // The rival's liquid — furnace magenta, unmistakable across the gap.
  ember: 0xff4f8b,
  emberDeep: 0x6a0f34,
  emberFoam: 0xffd9e8,

  // The moon: regolith is famously NOT white — it is a dark, warm grey that
  // only reads as bright because there is no atmosphere between it and the sun.
  regolith: 0x8c8478,
  regolithDark: 0x4a463f,
  craterRim: 0xa79d8d,

  // Hardware.
  steel: 0x9aa2ad,
  hiltDark: 0x21262e,
  glass: 0xdff4ff,

  space: 0x02030a,
  earth: 0x2a6fd6,
  earthLand: 0x4f7a4a,
  sun: 0xfff6e0,
};

/** Per-duelist blade colours: index 0 = you, 1 = the rival. */
export function bladeColors(side: 0 | 1): { juice: number; deep: number; foam: number } {
  return side === 0
    ? { juice: PALETTE.plasma, deep: PALETTE.plasmaDeep, foam: PALETTE.plasmaFoam }
    : { juice: PALETTE.ember, deep: PALETTE.emberDeep, foam: PALETTE.emberFoam };
}

// ---------------------------------------------------------------------------
// The saber itself.
// ---------------------------------------------------------------------------

export const SABER = {
  bladeLength: 0.78, // hilt shoulder → tip
  bladeHalfWidth: 0.031, // half the blade's broad face at the guard
  bladeHalfDepth: 0.014, // half its thickness — a flat blade, not a rod
  tipTaper: 0.42, // the tip's width as a fraction of the base's
  wallThickness: 0.0035, // glass wall — the liquid mesh is inset by this
  hiltLength: 0.15,

  /** Full tank at spawn: one full blade of liquid. */
  startFill: 1,

  /**
   * The liquid's world-space slosh. A saber is a long thin vessel swung on the
   * end of an arm, so it sloshes far harder than a pistol tank did — the
   * numbers below are deliberately looser and wilder than SPLASH WARS'.
   */
  slosh: {
    accelGain: 0.0075, // how strongly hand acceleration tips the surface
    spring: 5.2, // pull back to level
    damping: 1.35,
    maxTilt: 0.85, // clamp on the surface's rise/run
    energyDecay: 2.4, // how fast the ripple calms
    rippleGain: 2.2, // ripple amplitude multiplier in the shader
  },
};

/**
 * How the saber sits in your hand.
 *
 * WebXR reports two poses per controller — the GRIP (where the handle is) and
 * the TARGET RAY (where the platform says you are aiming) — and they are not
 * the same. A blade parented raw to the grip points noticeably high. We rotate
 * it by the grip→ray delta, which is self-calibrating across devices and hand
 * tracking alike, but CLAMP that delta: the ray is tuned for UI pointing and
 * can sit far enough off the handle that a fully aligned blade visibly droops
 * against your real hand. We take the ray's direction, not all of its size.
 */
export const GRIP = {
  /** Radians of grip→ray correction we are willing to apply. */
  aimMaxCorrection: 0.42,
  /** Fallback tilt when the runtime reports no distinct ray (the emulator). */
  heldPitch: -0.22,
  /** A constant hand-feel trim applied on top, always. */
  aimTrim: -0.06,
};

/**
 * SHAKE TO REPLENISH.
 *
 * The refill is a real gesture, not a button: whip the saber back and forth
 * and the liquid regrows. We detect it as REVERSALS — the hand's velocity
 * flipping direction while moving fast — because that is what separates a
 * deliberate shake from a swing, a walk, or a hand simply held out. One clean
 * shake is one reversal; a proper wrist-shake makes five or six a second.
 */
export const SHAKE = {
  minSpeed: 1.15, // m/s the hand must exceed for a reversal to count
  reversalDot: -0.25, // direction must flip at least this hard (cosine)
  minInterval: 0.055, // ignore reversals closer than this — tracker jitter
  fillPerShake: 0.052, // tank regained per counted reversal
  /**
   * Shaking is rewarded for RHYTHM: consecutive reversals inside this window
   * build a combo that multiplies the refill, so a committed 2-second shake
   * refills far faster than the same number of lazy waves. Drop the rhythm and
   * the combo decays away.
   */
  comboWindow: 0.42,
  comboMax: 2.6,
  comboGainPerShake: 0.32,
  comboDecay: 1.8, // per second, once the window lapses
  /** A shake cannot be started mid-attack — let go of the trigger first. */
  blockedWhileCharging: true,
};

/**
 * THE ATTACK: hold, swing, release.
 *
 * The blade records its own swept surface while the trigger is down — the
 * quad strip between where the blade's BASE went and where its TIP went. On
 * release that surface is cut loose as a sheet of energy and thrown along the
 * swing. What you carve is exactly what you throw.
 */
export const ATTACK = {
  /** Seconds of trigger-hold for a full charge. */
  chargeTime: 0.62,
  /** A charge below this can still throw, just weakly — no dead zone. */
  minCharge: 0.12,

  /** Swing samples older than this are dropped from the swept surface. */
  traceWindow: 0.42,
  /**
   * Sample no faster than this — a fixed floor keeps the ribbon even and stops
   * a 120 Hz device from filling the whole window with near-duplicate rungs.
   * Set just under a 90 Hz frame so headsets at 72 and 90 record every frame
   * and only faster displays thin out.
   */
  traceInterval: 0.01,
  /** The released sheet is resampled to this many rungs. */
  ribbonSegments: 22,
  /** Below this tip speed a sample adds nothing — a parked blade draws no arc. */
  traceMinSpeed: 0.55,

  /** The swing must beat this to throw at all (m/s, measured at the tip). */
  minSwingSpeed: 1.9,
  /** Arc speed = swing speed × this… */
  speedGain: 1.35,
  /** …clamped here. The floor keeps a lazy flick from hanging in the air. */
  speedMin: 5.5,
  speedMax: 22,

  /** Liquid cost: a base bite plus a share scaled by how much you charged. */
  costBase: 0.085,
  costPerCharge: 0.135,
  /** No throw at all below this much liquid — the blade coughs and fizzles. */
  minFill: 0.06,

  /** Damage at zero charge and at full charge. */
  damageMin: 7,
  damageMax: 26,

  /** Arc lifetime; it also dies on impact or when it leaves the bounds. */
  lifetime: 4.5,
  /**
   * Lunar gravity — 1.62 m/s², and the energy sheet is light, so it barely
   * feels it. Enough droop across the gap that a slow throw is a gentle arc
   * rather than a hitscan line, without ever becoming a mortar shot.
   */
  gravity: 0.55,
  /** Collision half-thickness of the sheet. */
  hitRadius: 0.16,
  /**
   * The sheet turns slowly about its own travel axis as it flies — enough to
   * catch the sun and read as a live object, deliberately NOT enough to spin.
   * The crescent's orientation is how the defender knows whether to duck or to
   * step aside, and a sheet that cartwheels destroys that read.
   */
  rollRate: 0.3,
};

/** The duel. */
export const DUEL = {
  maxHealth: 100,
  /** Seconds after a hit before health starts creeping back. */
  regenDelay: 5,
  regenPerSec: 3.5,
  roundTime: 120,
  /** Rounds needed to take the match. */
  winRounds: 2,
  /** Pre-fight countdown. */
  countdown: 3.5,
  /** How long the result card hangs before the next round. */
  resultTime: 4.5,
};

/** Duelist hitboxes — a head sphere and a torso sphere, both driven from the
 *  head pose (the only joint WebXR reliably gives us for a remote body). */
export const HITBOX = {
  headRadius: 0.15,
  chestRadius: 0.26,
  chestDrop: 0.42, // metres below the head
  headDamageScale: 1.5,
};

/** Where energy may fly before it is culled. */
export const ARENA_BOUNDS = {
  radius: 26,
  floorY: -1.2,
  ceilingY: 12,
};

/** The practice rival — a bot duelist across the gap. */
export const BOT = {
  /** Seconds between its attacks, scaled by difficulty. */
  attackIntervalMin: 1.9,
  attackIntervalMax: 3.8,
  /** It strafes along its pad instead of standing still. */
  strafeRange: 0.62,
  strafeRate: 0.55,
  /** Dodge: when an arc is inbound it slides aside this fast. */
  dodgeSpeed: 1.5,
  dodgeLead: 1.1, // seconds of warning it reacts to
  /**
   * How accurately it aims (1 = perfect). Below 1 it scatters its throws by a
   * few degrees, which across the gap is the difference between a hit and a
   * near miss — so this is the single difficulty knob.
   */
  aim: 0.86,
  /**
   * How far its throw is corrected from "wherever the swing happened to end"
   * toward "at the player", applied at the moment of release.
   *
   * This is not the bot cheating past its own animation. The energy sheet
   * leaves from the CENTROID of the whole stroke, which sits back along the
   * arc from the blade tip — so a swing whose tip velocity is aimed perfectly
   * still launches its payload from a point up to a metre off the aim line and
   * sails past. Correcting at release aims the thing that actually travels.
   * The sheet's ORIENTATION is untouched: it still shows the cut it came from.
   *
   * Held well short of 1 on purpose. A duelist can only dodge with their body,
   * which on a pad this size is half a metre of lean — and a thrown sheet is
   * most of a metre across. Fully corrected throws simply cannot be dodged,
   * and the whole fight collapses into a damage race. At this value the bot
   * threatens the space you are standing in rather than your exact head, and
   * reading the cut early is worth something.
   */
  aimAssist: 0.75,
  /**
   * Slower than it looks like it should be, on purpose. Across a short gap the
   * flight time IS the reaction window — the only thing standing between the
   * bot's release and your ribs — and a fast arc closes it before a human can
   * move. At this speed a throw takes a little over half a second to arrive,
   * which is enough to see the crescent's shape and pick a direction.
   */
  arcSpeed: 7.5,
  /**
   * The bot lands more of its throws than a person will, simply because it
   * never fumbles a reload or mistimes a release. Scaled down so a clean run
   * of its hits takes about six to put you down rather than four — enough
   * pressure to matter, enough slack to learn the shake mid-fight.
   */
  damageScale: 0.8,
};
