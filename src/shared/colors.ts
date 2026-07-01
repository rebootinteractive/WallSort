import type { ColorKey } from './types';

/** All colors the game/editor can use, in palette order. */
export const COLOR_KEYS: ColorKey[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

/** Tile colors as three.js hex numbers. */
export const COLOR_HEX: Record<ColorKey, number> = {
  red: 0xe5484d,
  blue: 0x4c6ef5,
  green: 0x2fb56a,
  yellow: 0xf2c033,
  purple: 0x9b58d3,
  orange: 0xf2712c,
};

/** Same palette as CSS strings, for HTML UI (editor dots, etc.). Derived — no drift. */
export const COLOR_CSS = Object.fromEntries(
  COLOR_KEYS.map((k) => [k, '#' + COLOR_HEX[k].toString(16).padStart(6, '0')]),
) as Record<ColorKey, string>;

/** A slightly lighter tint of a tile color, for bevel/highlight edges. */
export function lighten(hex: number, amount = 0.22): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** A darker shade of a tile color, for the drop shadow / seam under a tile. */
export function darken(hex: number, amount = 0.35): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const mix = (c: number) => Math.round(c * (1 - amount));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
