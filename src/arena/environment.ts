/**
 * The look foundation.
 *
 * Unlike the passthrough games this engine came from, LONG RANGE SABER DUELS
 * paints its own world: an opaque immersive-VR session, black sky, hard sun.
 * That changes what the environment module owns.
 *
 * There is no image-based lighting here, and that is deliberate. A studio
 * light-box (the RoomEnvironment trick) would put soft grey reflections on
 * every metal surface and instantly read as a room — the exact wrong instinct
 * on a world with no sky bounce. What the moon actually has is EARTHSHINE: the
 * Earth is a bright, blue-white disc four times the size of a full moon, and
 * it genuinely fills the shadows. So the only fill light in the scene is a
 * dim blue hemisphere aimed the way the Earth hangs, and it is the reason
 * shadowed faces read at all instead of going to pure black.
 *
 * Tone mapping is left neutral-ish and the exposure slightly low: with a 3.6
 * intensity sun and emissive liquid blades, the danger is clipping to white,
 * not going dark.
 */

import { Color, type World } from '@iwsdk/core';
import { HemisphereLight } from 'three';
import { ACESFilmicToneMapping } from 'three';
import { PALETTE } from '../config.js';

export function setupEnvironment(world: World): void {
  // ACES holds the highlights on a scene whose brightest object is an
  // emissive liquid held 40 cm from your eye.
  world.renderer.toneMapping = ACESFilmicToneMapping;
  world.renderer.toneMappingExposure = 0.92;

  // The void. Not quite pure black — a trace of deep blue keeps the horizon
  // from reading as a rendering failure where the terrain ends.
  const space = new Color(PALETTE.space);
  world.scene.background = space;
  world.renderer.setClearColor(space, 1);

  // EARTHSHINE. Blue from above (the Earth), a faint warm bounce from the
  // regolith below. This is the whole ambient budget.
  const fill = new HemisphereLight(0x4a6f9e, 0x241f18, 0.55);
  fill.name = 'earthshine';
  world.scene.add(fill);

  // No scene.environment: see the note above. Metals here are lit by the sun
  // and the blades, and nothing else.
}
