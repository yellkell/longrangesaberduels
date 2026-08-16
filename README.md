# LONG RANGE SABER DUELS

A WebXR duel on the moon. Two fighters stand face to face on octagonal pads,
just far enough apart that no swing can ever reach the other — reach is about
1.5 m each, the gap is 4.2 m. Each hand holds a **glass saber** with glowing
liquid visibly sloshing inside it, and that liquid is the ammunition.

You attack by **holding the trigger, swinging, and letting go**. The blade
records the surface it carves through the air, and on release that surface is
thrown: a sheet of energy shaped like your cut, flying the direction you cut, at
the speed you cut. It costs liquid. When the blade runs low you **shake it** to
fill it back up.

Built on the [Immersive Web SDK](https://github.com/meta-quest/immersive-web-sdk),
Three.js, and nothing else — every mesh, texture and sound in the game is
generated at runtime. There are no art assets to download.

```bash
npm install
npm run dev      # then open the page; desktop gets a WebXR emulator
npm run build    # typecheck + production bundle into dist/
```

---

## The three ideas

### 1. The liquid is the weapon

The blade is a vessel, not a beam. Inside it a mesh is clipped against a
**world-space** surface plane, so the liquid stays level however you tilt, swing
or roll the saber — the Half-Life: Alyx bottle trick, inherited from
[SPLASH WARS](https://github.com/yellkell/splashwars) and re-cut for a sword.

Because a saber is a long thin vessel held at one end, that one property does a
lot of work for free:

- hold the saber **upright** and the juice pools down at the guard;
- lay it **flat** and it spreads the whole length of the blade;
- **whip** it and a spring–damper tilts the surface so the liquid surges and
  ripples behind the motion.

The fill level is the ammo gauge, which is why there is no ammo readout anywhere
in the game. You can already see how much you have, from any angle, without
looking away from the fight.

`src/materials/liquid.ts` · `src/weapons/saber.ts`

### 2. The attack is measured, not chosen

While the trigger is held, the saber records where its **base** went and where
its **tip** went, every frame. Those two paths bound a ribbon: the actual
surface the blade carved. On release the ribbon is cut loose and thrown.

Nothing about the attack comes from a list. A flick throws a stubby dart. A full
overhead cut throws a tall curved sheet. A swing from the shoulder throws
something bigger than the same swing from the wrist — for free, from the
geometry, with no special case anywhere.

Three details in `src/combat/sweep.ts` earn their keep:

- **The stroke is trimmed at the front**, so a slow wind-up followed by a fast
  cut throws only the cut.
- **Rungs are resampled by arc length**, not by time, so an accelerating swing
  does not bunch its energy where you were merely gathering.
- **The release direction comes from a quadratic fit** through the last three
  tip samples, evaluated at the newest one. Averaging velocity over a window —
  the obvious implementation — points somewhere back along the arc instead of
  down the tangent you just let go of — a brisk swing missed by metres. The fit
  brings that error to about a tenth of a degree.

One thing is deliberately *not* physical. A swing is a rotation, so the surface
it carves is a flat fan and the release tangent lies inside that fan — thrown
exactly as cut, the sheet flies **edge-on** and is very nearly invisible from
both ends. So at launch it is turned face-on by the shortest rotation that
brings the swing plane onto the line of travel. The shape is untouched, and
because the rotation is minimal a vertical cut still arrives as a tall crescent
and a horizontal cut as a wide one. That is the defensive read: the shape coming
at you tells you which way to move.

### 3. You reload by shaking

There is no magazine and no automatic refill. Whip the saber back and forth and
the liquid regrows.

It is detected as **reversals** — the hand flipping direction while still moving
fast — because that is the one signal that separates a deliberate shake from a
swing, a walk, or a hand simply held out. Rhythm is rewarded: reversals arriving
in quick succession build a multiplier.

Measured against synthetic input (`window.LRSD.testShake`):

| gesture | reversals in 2 s | time to refill an empty saber |
| --- | --- | --- |
| brisk wrist-shake (3 Hz, 2 m/s) | 11 | **1.5 s** |
| lazy wave (2 Hz, 1.5 m/s) | 7 | 2.6 s |
| frantic (5 Hz, 2.5 m/s) | 19 | 0.8 s |
| a slow, big swing | 1 | 29 s |
| hand held out, drifting | 0 | never |

The last two rows are the point: swinging does not secretly reload you, and
neither does standing still.

`src/input/motion.ts`

---

## The moon

An opaque immersive-VR session — there is nothing to composite your real room
into. The whole look follows from one fact: **there is no atmosphere.**

- **No haze.** Distance does not fade anything. The far mesas are as crisp as
  the dust at your feet and the horizon is a hard, close line against the stars.
- **One light, no fill.** A single hard directional sun, and what it does not
  reach is black. The only ambient in the scene is **earthshine** — a dim blue
  hemisphere, which is a real thing and the only honest excuse for a fill light
  on the moon. There is no image-based lighting: a studio light-box would put
  soft grey reflections on every metal surface and instantly read as a room.
- **The ground is dark.** Regolith reflects about as much light as worn asphalt.
  It only looks bright in photographs because it is lit by an unfiltered sun.
- **The sun is a small, hard, white disc** with no halo and no rays, because
  every one of those effects is made of air.
- **The Earth hangs and never moves.** The moon is tidally locked, so from any
  one spot the Earth sits at a fixed point in the sky forever. It shows a real
  phase, struck from the same side as everything on the ground.

The terrain is generated from a seed at boot: craters punched in analytically (a
bowl under a raised rim, with an ejecta blanket outside it), four octaves of
roughness at the scales a player actually sees, and instanced boulders scattered
right up to the pads. The ground is levelled out to 5.5 m from the arena's
centre so the pads sit on a graded site rather than hovering over a hillside.

Two details are exaggerated on purpose, and only two: the **Earth's angular
size** (5° instead of its true 2°, because it is the reason to set a duel here
and a pale dot does not land), and the pads' **self-illumination**, because an
unlit deck under your feet on a world with no sky bounce is a black hole you are
standing on.

`src/arena/`

---

## The rival

A suited duelist on the far pad. The important thing about it is what it does
**not** do: it never spawns an attack out of thin air.

It holds a real saber with real liquid in it. It physically swings that saber. A
`SwingTrace` records the swept surface exactly as it does for your hands, and the
release goes through the same arc bus yours does. Everything you can read off
your own weapon — the wind-up glow, the shape of the cut, how much juice is left
— is legible on the rival's, because it is the same weapon.

That has a second payoff: **when it runs dry it has to shake, in plain sight,
for about a second.** The game teaches its own reload by making the enemy
perform it, and hands you an opening at the same time.

Its swing is aimed rather than scripted. Given the arm vector `r` and the
direction `d` to your head, it rotates about

```
a = normalise( r × (d − r (d·r)/|r|²) )
```

which makes the tip's velocity point along `d` at the moment the arm passes
through the release pose — so it winds *back* from that pose, cuts forward
through it, and lets go as it arrives.

`src/systems/RivalSystem.ts`

---

## Layout

```
src/
  main.ts                  world boot, system registration
  config.ts                every tunable in the game
  arena/
    moon.ts                seeded regolith, craters, boulders, horizon
    space.ts               stars, Earth, sun, the one directional light
    platform.ts            the octagonal duel pads
    arena.ts               assembles the duelling ground
    environment.ts         tone mapping, earthshine, the void
  materials/
    liquid.ts              the clipped-liquid shader, slosh sim, arc shader
    glass.ts               frosted blade glass and hilt metal
  weapons/saber.ts         the saber, built from generated geometry
  combat/
    sweep.ts               swept-surface recorder and ribbon builder
    arcBus.ts              one queue; nothing that throws knows what flies
    bodies.ts              the two duelists' hitbox anchors
    matchState.ts          rounds, health, phase
  input/
    aim.ts                 grip → target-ray correction
    motion.ts              hand velocity/acceleration, shake detection
    haptics.ts             per-hand rumble
  systems/
    DuelSystem.ts          phase, rounds, regen, your head pose
    SaberSystem.ts         your hands: liquid, shake, charge, release
    RivalSystem.ts         the bot
    ArcSystem.ts           flight, collision, damage
    HudSystem.ts           health bars and the round card
  debug/devHooks.ts        window.LRSD — DEV only, tree-shaken from builds
```

### Notes for anyone changing this

- **`src/config.ts` is the tuning surface.** Distances in metres, durations in
  seconds. `BOT.aim` and `BOT.aimAssist` are the difficulty knobs.
- **Arcs are sub-stepped.** A sheet crossing the gap at 22 m/s covers ~30 cm per
  72 Hz frame, which is the same order as the collision reach, so a single test
  per frame lets fast attacks pass clean *through* a duelist. `ArcSystem` splits
  each frame's travel into steps no longer than half the reach.
- **The bot sub-steps its swing too.** A cut takes about a quarter of a second;
  on a frame-starved device a per-frame trace can get two rungs, and two rungs
  is not a surface. Its swing is analytic, so it evaluates its own pose in fixed
  angular increments and throws the same shape at 20 fps as at 120.
- **System order is load-bearing**, and `src/main.ts` says why.
- **`window.LRSD`** (dev builds) drives the whole swing → flight → damage chain
  synthetically: `testSwing`, `testHit`, `testShake`, `probe`, `rival`.

## Credits

The IWSDK world setup and the octagonal arena come from
[Iron Balls Boxing](https://github.com/yellkell/Iron-Balls-Boxing). The liquid
shader and slosh simulation come from
[SPLASH WARS](https://github.com/yellkell/splashwars).
