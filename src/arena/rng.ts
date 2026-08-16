/**
 * A seeded PRNG (mulberry32).
 *
 * Every piece of the moon — crater placement, boulder scatter, the star field
 * — is generated at boot. Seeding it means the arena is the SAME arena on
 * every launch and on every headset in a duel, which matters the moment two
 * players start describing cover to each other. It also makes a bad-looking
 * scatter reproducible instead of a thing you can only complain about.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
