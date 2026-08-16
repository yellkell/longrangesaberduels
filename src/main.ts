/**
 * LONG RANGE SABER DUELS — entry point.
 *
 * Boots an IWSDK World into an opaque **immersive-VR** session. Unlike the
 * passthrough games this engine grew out of, the whole point here is that you
 * are somewhere else: standing on the moon with the Earth over your shoulder.
 * There is nothing to composite your real room into, so AR is never offered.
 *
 * Run `npm run dev` and open the page: on a headset you get an "Enter VR"
 * button; on desktop the IWSDK dev plugin supplies a WebXR emulator
 * (WASD + mouse) so the duel can be flown without hardware.
 *
 * System order is load-bearing:
 *   DuelSystem   — publishes your head pose and owns the phase, so everything
 *                  downstream sees a current body and a current phase
 *   SaberSystem  — your hands: liquid, shake, charge, release
 *   RivalSystem  — the bot: same swing path, publishes its head pose
 *   ArcSystem    — drains both producers' throws, flies and resolves them
 *   HudSystem    — reads the settled state last
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { FOVEATION } from './config.js';
import { installDevHooks } from './debug/devHooks.js';
import { setupEnvironment } from './arena/environment.js';
import { buildArena } from './arena/arena.js';
import { DuelSystem } from './systems/DuelSystem.js';
import { SaberSystem } from './systems/SaberSystem.js';
import { RivalSystem } from './systems/RivalSystem.js';
import { ArcSystem } from './systems/ArcSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { ensureAudio } from './audio/sfx.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

enterButton?.setAttribute('disabled', '');

World.create(container, {
  // The landing button calls IWSDK's explicit launcher from the user's own
  // tap: Quest Browser wants that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
  },
  // A stationary duel: you hold your pad and dodge with your body. No
  // locomotion, no teleport, and nothing in the scene is grabbable — the
  // sabers are parented to the grips by SaberSystem, not picked up.
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves — one hard sun and earthshine.
    defaultLighting: false,
    // Far enough to hold the sky shell (900 m) and the horizon ridges.
    far: 2400,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  world.renderer.xr.setFoveation(FOVEATION);

  setupEnvironment(world);
  buildArena(world);

  world.registerSystem(DuelSystem);
  world.registerSystem(SaberSystem);
  world.registerSystem(RivalSystem);
  world.registerSystem(ArcSystem);
  world.registerSystem(HudSystem);

  // Dev-only inspection + synthetic-swing harness on `window.LRSD`. Behind
  // the DEV flag, so it is tree-shaken out of production builds.
  if (import.meta.env.DEV) installDevHooks(world);

  const vrSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveVR).catch(() => false)) === true;

  const startXR = (): void => {
    enterButton?.setAttribute('disabled', '');
    // Warm the audio engine inside the click gesture, so the countdown's first
    // pip lands on a live context instead of paying resume latency.
    ensureAudio();
    launchXR(world, { sessionMode: SessionMode.ImmersiveVR });

    // Poll for the session on a TIMER, not requestAnimationFrame: Quest
    // Browser suspends window rAF while an immersive session presents, so an
    // rAF poll is a race — if the session activates between ticks the poll
    // never fires again. Timers keep ticking in-session.
    const poll = window.setInterval(() => {
      if (!world.session) return;
      window.clearInterval(poll);
      document.body.classList.add('app-entered');
      world.session.addEventListener('select', ensureAudio);
      world.session.addEventListener(
        'end',
        () => {
          document.body.classList.remove('app-entered');
          enterButton?.removeAttribute('disabled');
        },
        { once: true },
      );
    }, 50);
    // If the request was refused, hand control back to the button.
    window.setTimeout(() => {
      if (!world.session) enterButton?.removeAttribute('disabled');
    }, 4000);
  };

  if (enterButton && vrSupported) {
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', startXR);
  } else if (enterButton) {
    enterButton.textContent = 'WebXR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[LONG RANGE SABER DUELS] World ready — moon set, blades filled.');
});
