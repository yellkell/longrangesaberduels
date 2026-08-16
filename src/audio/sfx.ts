/**
 * A small WebAudio kit — every sound synthesised at runtime, no asset files.
 *
 * The palette is GLASS AND LIQUID, not the usual sci-fi buzz: struck crystal,
 * water moving in a vessel, and a charge that rises in pitch as it fills. The
 * two building blocks are `tone` (a glided oscillator through an envelope) and
 * `noiseBurst` (bandpassed noise), which between them cover everything here.
 *
 * The AudioContext can only start inside a user gesture, so it is unlocked on
 * the first interaction; after that, sounds fired from the frame loop play
 * fine. Every call is a no-op before the unlock rather than an error, so the
 * game never has to check.
 */

type Ctx = AudioContext & { _bus?: GainNode };

let ctx: Ctx | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.34;
    bus.connect(ctx.destination);
    ctx._bus = bus;
  }
  return ctx;
}

/** Resume the context. Safe to call from any gesture, any number of times. */
export function ensureAudio(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  for (const evt of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(evt, ensureAudio, { once: false, passive: true });
  }
}

function bus(): GainNode | null {
  return getCtx()?._bus ?? null;
}

function whiteNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 1.2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
  /** Detuned second voice, for the chorusing that makes glass sound alive. */
  detune?: number;
}

function tone(o: ToneOpts): void {
  const c = getCtx();
  const out = bus();
  if (!c || !out) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const g = c.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, o.dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  g.connect(out);

  for (const det of o.detune ? [0, o.detune] : [0]) {
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.detune.value = det;
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }
}

interface NoiseOpts {
  freq: number;
  to?: number;
  q?: number;
  dur: number;
  gain?: number;
  delay?: number;
  type?: BiquadFilterType;
}

function noiseBurst(o: NoiseOpts): void {
  const c = getCtx();
  const out = bus();
  if (!c || !out) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = whiteNoise(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.setValueAtTime(o.freq, t0);
  if (o.to && o.to !== o.freq) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  filter.Q.value = o.q ?? 3;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.25, t0 + Math.min(0.015, o.dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  src.connect(filter).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + o.dur + 0.02);
}

// ---------------------------------------------------------------------------
// The kit.
// ---------------------------------------------------------------------------

/**
 * THE CHARGE. A rising, chorused glass tone whose pitch tracks how wound up
 * the blade is. Called in short overlapping grains from the frame loop rather
 * than held as one long oscillator, so it can follow the charge continuously
 * without needing a voice to manage.
 */
export function chargeTick(charge: number): void {
  tone({
    type: 'triangle',
    from: 210 + charge * 620,
    to: 230 + charge * 700,
    dur: 0.13,
    gain: 0.03 + charge * 0.075,
    detune: 9,
  });
}

/** The throw: a hard glass whoosh whose brightness scales with the swing. */
export function throwArc(charge: number, speed: number): void {
  const bright = Math.min(1, speed / 14);
  noiseBurst({ freq: 900 + bright * 2400, to: 260, q: 1.4, dur: 0.34, gain: 0.2 + charge * 0.2 });
  tone({ type: 'sawtooth', from: 420 + charge * 380, to: 90, dur: 0.3, gain: 0.1 + charge * 0.14, detune: -12 });
  // The blade ringing off after the cut, like a struck wine glass.
  tone({ type: 'sine', from: 1750 + charge * 500, to: 1500, dur: 0.5, gain: 0.05, delay: 0.02 });
}

/** Not enough liquid, or not enough swing — the blade coughs. */
export function fizzle(): void {
  noiseBurst({ freq: 420, to: 160, q: 5, dur: 0.16, gain: 0.11 });
  tone({ type: 'square', from: 150, to: 70, dur: 0.12, gain: 0.05 });
}

/** A reversal registered while shaking — juice slapping the glass. */
export function shakeSlosh(combo: number): void {
  noiseBurst({ freq: 280 + combo * 190, to: 130, q: 2.2, dur: 0.12, gain: 0.09 });
  tone({ type: 'sine', from: 320 + combo * 120, to: 190, dur: 0.14, gain: 0.05 });
}

/** The tank comes back to full. */
export function refilled(): void {
  tone({ type: 'sine', from: 660, to: 990, dur: 0.2, gain: 0.1, detune: 6 });
  tone({ type: 'sine', from: 990, to: 1320, dur: 0.26, gain: 0.07, delay: 0.09 });
}

/** An arc lands on someone. */
export function hit(strong: boolean): void {
  noiseBurst({ freq: strong ? 2600 : 1700, to: 300, q: 1.1, dur: 0.3, gain: strong ? 0.32 : 0.22 });
  tone({ type: 'sawtooth', from: strong ? 260 : 190, to: 55, dur: 0.32, gain: 0.2 });
  // Shattering glass overtones — the sheet breaking on impact.
  for (let i = 0; i < (strong ? 5 : 3); i++) {
    tone({
      type: 'sine',
      from: 2200 + Math.random() * 2600,
      to: 1400 + Math.random() * 900,
      dur: 0.18 + Math.random() * 0.2,
      gain: 0.045,
      delay: Math.random() * 0.07,
    });
  }
}

/** You took the hit. Lower, closer, and it lands in your chest. */
export function tookHit(): void {
  tone({ type: 'sawtooth', from: 130, to: 44, dur: 0.44, gain: 0.28, detune: -18 });
  noiseBurst({ freq: 700, to: 140, q: 0.9, dur: 0.4, gain: 0.2, type: 'lowpass' });
}

/** An arc dies out without hitting anything. */
export function arcExpire(): void {
  noiseBurst({ freq: 1200, to: 420, q: 2.5, dur: 0.22, gain: 0.06 });
}

/** Countdown pips, then the go. */
export function countdownPip(final: boolean): void {
  if (final) {
    tone({ type: 'triangle', from: 880, to: 880, dur: 0.42, gain: 0.24, detune: 8 });
    tone({ type: 'triangle', from: 1320, to: 1320, dur: 0.5, gain: 0.14, delay: 0.02 });
  } else {
    tone({ type: 'triangle', from: 440, to: 440, dur: 0.16, gain: 0.16, detune: 6 });
  }
}

/** Round taken. */
export function roundWon(win: boolean): void {
  const notes = win ? [523, 659, 784, 1047] : [523, 415, 349, 262];
  notes.forEach((f, i) => tone({ type: 'triangle', from: f, to: f, dur: 0.34, gain: 0.16, delay: i * 0.13, detune: 7 }));
}

/** The match. */
export function matchOver(win: boolean): void {
  const notes = win ? [523, 784, 1047, 1319, 1568] : [392, 330, 262, 196];
  notes.forEach((f, i) =>
    tone({ type: 'triangle', from: f, to: f, dur: 0.6, gain: 0.18, delay: i * 0.17, detune: 10 }),
  );
}
