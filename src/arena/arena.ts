/**
 * Assembles the duelling ground: the moon under you, space around you, and
 * two octagonal pads a long gap apart.
 *
 * Your pad sits at the origin (the XR rig's own position, so you are standing
 * on it the moment the session starts) and the rival's sits at -Z, ARENA_GAP
 * away. Both are lowered onto the real terrain height so they read as bolted
 * to the ground rather than hovering over it.
 */

import { Group, type Object3D } from 'three';
import type { World } from '@iwsdk/core';
import { ARENA_GAP, PALETTE } from '../config.js';
import { buildMoon } from './moon.js';
import { buildSpace } from './space.js';
import { makePlatform } from './platform.js';

export interface Arena {
  group: Group;
  playerPad: Object3D;
  rivalPad: Object3D;
  /** Ground height under a point, for anything that needs to sit on the dust. */
  heightAt(x: number, z: number): number;
}

export function buildArena(world: World): Arena {
  const group = new Group();
  group.name = 'arena';

  const space = buildSpace();
  group.add(space.group);

  const moon = buildMoon();
  group.add(moon.group);

  // Your pad. The rig's origin is its centre, so the terrain is dropped to
  // meet the deck rather than the deck being raised off the terrain — that
  // way your real floor and the deck you see stay the same surface.
  const playerPad = makePlatform(PALETTE.plasma);
  playerPad.name = 'player-pad';
  group.add(playerPad);

  const rivalPad = makePlatform(PALETTE.ember);
  rivalPad.name = 'rival-pad';
  rivalPad.position.set(0, 0, -ARENA_GAP);
  rivalPad.rotation.y = Math.PI; // it faces you
  group.add(rivalPad);

  // Drop the moon just far enough that the dust laps over the bottom edge of
  // the pads' flanks. The terrain is levelled to y = 0 across the whole arena
  // (see FLAT_INNER in moon.ts), so this one offset holds under both pads and
  // there is no seam to chase: the slab runs from +0.02 down to −0.16, and the
  // ground cuts it at −0.12, burying the last four centimetres.
  moon.group.position.y = -0.12;

  world.scene.add(group);
  return {
    group,
    playerPad,
    rivalPad,
    heightAt: (x, z) => moon.heightAt(x, z) + moon.group.position.y,
  };
}
