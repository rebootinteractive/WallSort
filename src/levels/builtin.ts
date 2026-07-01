import type { Cell, ColorKey, LevelData } from '../shared/types';
import { DEFAULT_TARGET } from '../shared/types';

// Small DSL for readable levels. Columns are top -> bottom.
const t = (color: ColorKey, n: number): Cell[] =>
  Array.from({ length: n }, (): Cell => ({ kind: 'tile', color }));
const sep = (): Cell => ({ kind: 'sep', target: DEFAULT_TARGET });

// L1 — one move. The loose pile of 6 red flies onto the 4 waiting on the
// separator, completing the group of 10.
const level1: LevelData = {
  id: 'l1-first-ten',
  name: 'First Ten',
  columns: [[...t('red', 6)], [...t('red', 4), sep()]],
};

// L2 — two colors. Peel the red off the mixed pile onto the red separator,
// then the blue underneath onto the blue separator.
const level2: LevelData = {
  id: 'l2-two-tone',
  name: 'Two-Tone',
  columns: [
    [...t('red', 5), sep()],
    [...t('blue', 5), sep()],
    [...t('red', 5), ...t('blue', 5)],
  ],
};

// L3 — three colors across two loose columns. Route each color to its
// separator; the wrap-around search does the rest.
const level3: LevelData = {
  id: 'l3-triad',
  name: 'Triad',
  columns: [
    [...t('red', 6), sep()],
    [...t('blue', 6), sep()],
    [...t('green', 6), sep()],
    [...t('red', 4), ...t('green', 4)],
    [...t('blue', 4)],
  ],
};

// L4 — the full wall: 100 tiles (40R / 30G / 20B / 10Y), 10 separators, groups of 2–8.
// Funnel design: each separator is pre-seeded with its home color (R8 / G7 / B6 / Y5)
// and completed by a uniform loose run (R2 / G3 / B4 / Y5) fed from two source columns.
// Verified solvable — 10 completing moves clear it.
const level4: LevelData = {
  id: 'l4-big-wall',
  name: 'The Big Wall',
  columns: [
    [...t('red', 2), ...t('green', 3), ...t('blue', 4), ...t('red', 2), ...t('green', 3)],
    [...t('red', 2), ...t('blue', 4), ...t('green', 3), ...t('red', 2), ...t('yellow', 5)],
    [...t('red', 8), sep(), ...t('red', 8), sep()],
    [...t('red', 8), sep(), ...t('red', 8), sep()],
    [...t('green', 7), sep(), ...t('green', 7), sep()],
    [...t('green', 7), sep(), ...t('yellow', 5), sep()],
    [...t('blue', 6), sep(), ...t('blue', 6), sep()],
  ],
};

export const BUILTIN_LEVELS: LevelData[] = [level1, level2, level3, level4];
