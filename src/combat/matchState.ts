/**
 * Shared, mutable duel state. `DuelSystem` owns every transition; everything
 * else reads `phase` to know whether play is live.
 *
 * Two duelists, indexed by side: 0 is you, 1 is the rival across the gap.
 * Keeping them in one array rather than two named fields means the damage
 * path, the HUD and the bot all take a side index and never need to know
 * which one they are.
 */

import { DUEL } from '../config.js';

export type DuelPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export interface DuelistState {
  health: number;
  /** Seconds since this duelist last took a hit — gates the regen. */
  sinceHit: number;
  /** Rounds won. */
  rounds: number;
}

export interface DuelState {
  phase: DuelPhase;
  round: number;
  timer: number;
  /** Countdown / result-card timer, depending on phase. */
  cardTimer: number;
  message: string;
  duelists: [DuelistState, DuelistState];
  /** Bumped whenever a round restarts — systems reset off the change. */
  resetCount: number;
  /** -1 = none/draw, else the side that took the last round. */
  lastWinner: -1 | 0 | 1;
}

function freshDuelist(): DuelistState {
  return { health: DUEL.maxHealth, sinceHit: 99, rounds: 0 };
}

export const duel: DuelState = {
  phase: 'countdown',
  round: 1,
  timer: DUEL.roundTime,
  cardTimer: DUEL.countdown,
  message: '',
  duelists: [freshDuelist(), freshDuelist()],
  resetCount: 0,
  lastWinner: -1,
};

/** Reset both duelists for a fresh round, keeping the rounds-won tally. */
export function resetRound(): void {
  for (const d of duel.duelists) {
    d.health = DUEL.maxHealth;
    d.sinceHit = 99;
  }
  duel.timer = DUEL.roundTime;
  duel.cardTimer = DUEL.countdown;
  duel.phase = 'countdown';
  duel.resetCount++;
}

/** Reset the whole match. */
export function resetMatch(): void {
  for (const d of duel.duelists) d.rounds = 0;
  duel.round = 1;
  duel.lastWinner = -1;
  duel.message = '';
  resetRound();
}

/** Apply damage to a side. Returns true if this hit dropped them. */
export function damage(side: 0 | 1, amount: number): boolean {
  const d = duel.duelists[side];
  if (d.health <= 0) return false;
  d.health = Math.max(0, d.health - amount);
  d.sinceHit = 0;
  return d.health <= 0;
}
