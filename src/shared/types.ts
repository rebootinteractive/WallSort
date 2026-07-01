// Core data shapes for Wall Sort.

export type ColorKey = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

/** A single cell in a column. Columns are ordered top -> bottom. */
export type Cell =
  | { kind: 'tile'; color: ColorKey }
  | { kind: 'sep'; target: number };

export interface LevelData {
  id: string;
  name: string;
  /** Per-column cells, each ordered top -> bottom. columns.length === column count. */
  columns: Cell[][];
}

export type TileCell = Extract<Cell, { kind: 'tile' }>;
export type SepCell = Extract<Cell, { kind: 'sep' }>;

export const isTile = (c: Cell): c is TileCell => c.kind === 'tile';
export const isSep = (c: Cell): c is SepCell => c.kind === 'sep';

/** Default target every separator counts down toward. */
export const DEFAULT_TARGET = 10;
