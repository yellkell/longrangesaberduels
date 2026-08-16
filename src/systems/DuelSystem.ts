/**
 * The duel's brain: rounds, the countdown, regeneration and the win check.
 *
 * It also publishes YOUR body pose. The head comes straight from the XR
 * camera, so ducking under an incoming arc is a real dodge made with your real
 * neck — there is no dodge button anywhere in this game, and there should not
 * be one. The chest sphere is derived from the head by the same offset used
 * for the rival, so both duelists are hit by identical geometry.
 */

import { createSystem } from '@iwsdk/core';
import { Vector3 } from 'three';
import { DUEL } from '../config.js';
import { bodies } from '../combat/bodies.js';
import { duel, resetMatch, resetRound } from '../combat/matchState.js';
import * as sfx from '../audio/sfx.js';

const _head = new Vector3();

export class DuelSystem extends createSystem({}) {
  private lastPip = -1;

  update(delta: number): void {
    // --- Your body, from the headset. ---
    this.camera.getWorldPosition(_head);
    bodies[0].head.copy(_head);
    bodies[0].active = duel.duelists[0].health > 0;

    switch (duel.phase) {
      case 'countdown':
        this.runCountdown(delta);
        break;
      case 'playing':
        this.runRound(delta);
        break;
      case 'roundOver':
      case 'matchOver':
        this.runCard(delta);
        break;
    }
  }

  private runCountdown(delta: number): void {
    duel.cardTimer -= delta;
    const pip = Math.ceil(duel.cardTimer);
    if (pip !== this.lastPip && pip > 0) {
      this.lastPip = pip;
      sfx.countdownPip(false);
    }
    duel.message = pip > 0 ? String(pip) : 'DUEL';
    if (duel.cardTimer <= 0) {
      sfx.countdownPip(true);
      this.lastPip = -1;
      duel.phase = 'playing';
      duel.timer = DUEL.roundTime;
      duel.message = '';
    }
  }

  private runRound(delta: number): void {
    duel.timer -= delta;

    for (const d of duel.duelists) {
      d.sinceHit += delta;
      // Regeneration is slow and gated: it rewards disengaging and shaking up
      // a fresh tank rather than trading hits, which is the fight this arena
      // is shaped for.
      if (d.sinceHit >= DUEL.regenDelay && d.health > 0) {
        d.health = Math.min(DUEL.maxHealth, d.health + DUEL.regenPerSec * delta);
      }
    }

    const meDown = duel.duelists[0].health <= 0;
    const themDown = duel.duelists[1].health <= 0;
    if (meDown || themDown) {
      this.endRound(meDown && themDown ? -1 : themDown ? 0 : 1);
      return;
    }
    if (duel.timer <= 0) {
      // Time: the healthier duelist takes it, and an exact tie is a draw.
      const a = duel.duelists[0].health;
      const b = duel.duelists[1].health;
      this.endRound(a === b ? -1 : a > b ? 0 : 1);
    }
  }

  private endRound(winner: -1 | 0 | 1): void {
    duel.lastWinner = winner;
    // A draw has no winner to credit, and neither branch below may index the
    // roster with -1 — so narrow once, here, and use the narrowed value.
    const scorer = winner === -1 ? null : duel.duelists[winner];
    if (scorer) scorer.rounds++;

    const decisive = scorer !== null && scorer.rounds >= DUEL.winRounds;
    duel.phase = decisive ? 'matchOver' : 'roundOver';
    duel.cardTimer = DUEL.resultTime;
    duel.message = decisive
      ? winner === 0
        ? 'MATCH WON'
        : 'MATCH LOST'
      : winner === -1
        ? 'DRAW'
        : winner === 0
          ? 'ROUND WON'
          : 'ROUND LOST';

    if (decisive) sfx.matchOver(winner === 0);
    else if (scorer) sfx.roundWon(winner === 0);
  }

  private runCard(delta: number): void {
    duel.cardTimer -= delta;
    if (duel.cardTimer > 0) return;
    if (duel.phase === 'matchOver') {
      resetMatch();
    } else {
      duel.round++;
      resetRound();
    }
    duel.message = '';
  }
}
