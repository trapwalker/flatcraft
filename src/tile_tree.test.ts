import { describe, expect, it } from 'vitest';
import { heat, ring, square } from './tile_tree.js';

// These were flagged in BACKLOG.md (INFRA-1) as "testable without any refactoring" — that
// turned out to be wrong until tile_tree.ts became a real ES module (see AFF-3's module
// migration note). Now that it is, this closes that gap.

interface Call { x: number; y: number; z: number }

function recorder(): { calls: Call[]; callback: (x: number, y: number, z: number) => number } {
  const calls: Call[] = [];
  return {
    calls,
    callback: (x: number, y: number, z: number): number => {
      calls.push({ x, y, z });
      return 1;
    }
  };
}

describe('square', () => {
  it('r < 1: calls the callback once, at the center, and returns 1', () => {
    const { calls, callback } = recorder();
    const cnt = square(callback, 5, -3, 2, 0);
    expect(cnt).toBe(1);
    expect(calls).toEqual([{ x: 5, y: -3, z: 2 }]);
  });

  it('r = 1: visits exactly the 8 perimeter cells at Chebyshev distance 1', () => {
    const { calls, callback } = recorder();
    const cnt = square(callback, 0, 0, 0, 1);
    expect(cnt).toBe(8);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(Math.max(Math.abs(c.x), Math.abs(c.y))).toBe(1);
      expect(c.z).toBe(0);
    }
    // No duplicates.
    const unique = new Set(calls.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(8);
  });

  it('r = 2: visits exactly the 16 perimeter cells at Chebyshev distance 2', () => {
    const { calls, callback } = recorder();
    const cnt = square(callback, 10, 10, 0, 2);
    expect(cnt).toBe(16);
    for (const c of calls) {
      expect(Math.max(Math.abs(c.x - 10), Math.abs(c.y - 10))).toBe(2);
    }
  });
});

describe('ring', () => {
  it('ring(r1, r2) sums square(r1..r2-1) with no overlap: a filled (2*r2-1)^2 square minus the filled (2*r1-1)^2 hole', () => {
    const { calls, callback } = recorder();
    const cnt = ring(callback, 0, 0, 0, 0, 2); // square(0) + square(1) = filled 3x3
    expect(cnt).toBe(9);
    expect(calls).toHaveLength(9);
    const unique = new Set(calls.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(9); // every cell visited exactly once
  });

  it('a single-argument call ring(callback, x, y, z, r1) fills the disk [0, r1)', () => {
    const { callback } = recorder();
    // Per the (r1, r2?) => (r2===undefined ? [0, r1) : [r1, r2)) argument-shifting rule.
    expect(ring(callback, 0, 0, 0, 1)).toBe(1); // just square(0)
    expect(ring(() => 1, 0, 0, 0, 2)).toBe(9); // square(0) + square(1)
  });
});

describe('heat', () => {
  it('r1=0, r2=1, deep=0: only the center cell', () => {
    const { calls, callback } = recorder();
    const cnt = heat(callback, 0, 0, 0, 0, 1, 0);
    expect(cnt).toBe(1);
    expect(calls).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it('r1=0, r2=3, deep=0: a flat filled 5x5 square at the same z, no vertical spread', () => {
    const { calls, callback } = recorder();
    const cnt = heat(callback, 0, 0, 0, 0, 3, 0);
    expect(cnt).toBe(25); // (2*2+1)^2
    expect(calls.every((c) => c.z === 0)).toBe(true);
    const unique = new Set(calls.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(25);
  });

  it('r1=1, r2=2, deep=1: base-z ring plus a single cell preloaded at z+1 and z-1', () => {
    const { calls, callback } = recorder();
    const cnt = heat(callback, 0, 0, 0, 1, 2, 1);
    // base z: filled disk r<1 (1 cell) + ring r=1 (8 cells) = 9; plus z+1 and z-1 each getting
    // their own filled r<1 disk (1 cell each) = 2 more. See BACKLOG.md/commit for the trace.
    expect(cnt).toBe(11);
    expect(calls).toHaveLength(11);

    const atZ0 = calls.filter((c) => c.z === 0);
    const atZplus1 = calls.filter((c) => c.z === 1);
    const atZminus1 = calls.filter((c) => c.z === -1);
    expect(atZ0).toHaveLength(9);
    expect(atZplus1).toEqual([{ x: 0, y: 0, z: 1 }]);
    expect(atZminus1).toEqual([{ x: 0, y: 0, z: -1 }]);
  });

  it('deep defaults to r2 - r1 when omitted', () => {
    const a = heat(() => 1, 0, 0, 0, 1, 2);
    const b = heat(() => 1, 0, 0, 0, 1, 2, 1); // r2 - r1 = 1
    expect(a).toBe(b);
  });
});
