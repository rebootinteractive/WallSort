import type { ColorKey, LevelData } from '../shared/types';
import { DEFAULT_TARGET } from '../shared/types';

// Board holds the pure logical state of a wall. No three.js in here — the view
// reconciles against this model. Every cell has a stable numeric `id` so the
// renderer can track a tile as it moves, matches, or is restored by undo.

export interface BoardTile {
  kind: 'tile';
  color: ColorKey;
  id: number;
}
export interface BoardSep {
  kind: 'sep';
  target: number;
  id: number;
}
export type BoardCell = BoardTile | BoardSep;

export interface TopRun {
  color: ColorKey;
  count: number;
}

/** One separator completing: `count` tiles of `color` clear, plus the separator. */
export interface ClearEvent {
  col: number;
  color: ColorKey;
  count: number;
  sepId: number;
  tileIds: number[];
}

export type TapOutcome =
  | { kind: 'noop'; col: number }
  | { kind: 'invalid'; col: number }
  | {
      kind: 'move';
      from: number;
      to: number;
      color: ColorKey;
      movedIds: number[];
      clears: ClearEvent[];
    };

export interface SepStatus {
  remaining: number;
  active: boolean;
}

export class Board {
  columns: BoardCell[][];
  private history: BoardCell[][][] = [];

  private constructor(columns: BoardCell[][]) {
    this.columns = columns;
  }

  static fromLevel(level: LevelData): Board {
    let id = 1;
    const columns: BoardCell[][] = level.columns.map((col) =>
      col.map((cell) =>
        cell.kind === 'tile'
          ? ({ kind: 'tile', color: cell.color, id: id++ } as BoardTile)
          : ({ kind: 'sep', target: cell.target, id: id++ } as BoardSep),
      ),
    );
    const board = new Board(columns);
    // Resolve any pre-completed separators once at start (authored or coincidental),
    // so a level that begins in a resolvable state handles it correctly.
    board.resolveAll();
    return board;
  }

  get colCount(): number {
    return this.columns.length;
  }

  /** Contiguous same-color tile run at the very top of a column, or null. */
  topRun(c: number): TopRun | null {
    const col = this.columns[c];
    if (!col || col.length === 0) return null;
    const first = col[0];
    if (first.kind !== 'tile') return null; // separator exposed on top → nothing to grab
    const color = first.color;
    let count = 0;
    for (const cell of col) {
      if (cell.kind === 'tile' && cell.color === color) count++;
      else break;
    }
    return { color, count };
  }

  /** True when a column has a separator exposed on top (empty band) — a wildcard
   *  landing spot that accepts a run of any color. */
  isWildcardTarget(c: number): boolean {
    const col = this.columns[c];
    return col.length > 0 && col[0].kind === 'sep';
  }

  /** Destination for a tap on `from`, scanning right (wrapping):
   *  1) nearest same-color top run that still has room (< target), else
   *  2) nearest empty separator (accepts any color). */
  findFlyTarget(from: number): number | null {
    const run = this.topRun(from);
    if (!run) return null;
    const n = this.columns.length;
    for (let step = 1; step < n; step++) {
      const c = (from + step) % n;
      const r = this.topRun(c);
      if (r && r.color === run.color && r.count < DEFAULT_TARGET) return c;
    }
    for (let step = 1; step < n; step++) {
      const c = (from + step) % n;
      if (this.isWildcardTarget(c)) return c;
    }
    return null;
  }

  /** Plan a tap: destination + how many tiles actually move. A same-color group
   *  merges to at most DEFAULT_TARGET, so only enough tiles fly to fill the
   *  destination run to 10 — any excess stays put in the source. Null if illegal. */
  movePlan(from: number): { to: number; count: number } | null {
    const run = this.topRun(from);
    if (!run) return null;
    const to = this.findFlyTarget(from);
    if (to === null) return null;
    const destTop = this.topRun(to);
    const destSame = destTop && destTop.color === run.color ? destTop.count : 0;
    const room = DEFAULT_TARGET - destSame;
    const count = Math.min(run.count, room);
    return count > 0 ? { to, count } : null;
  }

  /** Perform a tap: fly the top run to its target, then resolve matches. Records undo. */
  applyTap(from: number): TapOutcome {
    const run = this.topRun(from);
    if (!run) return { kind: 'noop', col: from };
    const plan = this.movePlan(from);
    if (!plan) return { kind: 'invalid', col: from };

    this.pushHistory();

    const moved = this.columns[from].splice(0, plan.count) as BoardTile[];
    const movedIds = moved.map((t) => t.id);
    this.columns[plan.to].unshift(...moved);

    const clears = this.resolveAll();
    return { kind: 'move', from, to: plan.to, color: run.color, movedIds, clears };
  }

  /** Tiles directly above a separator, up to the next separator or the top. */
  private bandAbove(col: BoardCell[], sepIndex: number): BoardTile[] {
    const tiles: BoardTile[] = [];
    for (let j = sepIndex - 1; j >= 0; j--) {
      const cell = col[j];
      if (cell.kind === 'sep') break;
      tiles.unshift(cell);
    }
    return tiles;
  }

  /** Display info for a separator at (colIndex, cellIndex). */
  sepStatusAt(colIndex: number, cellIndex: number): SepStatus {
    const col = this.columns[colIndex];
    const sep = col[cellIndex];
    if (sep.kind !== 'sep') return { remaining: 0, active: false };
    const tiles = this.bandAbove(col, cellIndex);
    if (tiles.length === 0) return { remaining: sep.target, active: false };
    const color = tiles[0].color;
    const pure = tiles.every((t) => t.color === color);
    if (!pure) return { remaining: sep.target, active: false };
    return { remaining: Math.max(0, sep.target - tiles.length), active: true };
  }

  /** Repeatedly clear any separator whose band is one color and at/over target. */
  private resolveAll(): ClearEvent[] {
    const events: ClearEvent[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let c = 0; c < this.columns.length; c++) {
        const col = this.columns[c];
        for (let i = 0; i < col.length; i++) {
          const cell = col[i];
          if (cell.kind !== 'sep') continue;
          const tiles = this.bandAbove(col, i);
          if (tiles.length < cell.target) continue;
          const color = tiles[0].color;
          if (!tiles.every((t) => t.color === color)) continue;

          // Clear the `target` tiles nearest the separator, plus the separator.
          const removeStart = i - cell.target;
          const removed = col.splice(removeStart, cell.target + 1);
          const tileIds = removed
            .filter((x): x is BoardTile => x.kind === 'tile')
            .map((t) => t.id);
          events.push({ col: c, color, count: cell.target, sepId: cell.id, tileIds });
          changed = true;
          break outer; // indices shifted; rescan from scratch
        }
      }
    }
    return events;
  }

  isWon(): boolean {
    return this.columns.every((col) => col.length === 0);
  }

  hasAnyMove(): boolean {
    for (let c = 0; c < this.columns.length; c++) {
      if (this.topRun(c) && this.findFlyTarget(c) !== null) return true;
    }
    return false;
  }

  isStuck(): boolean {
    return !this.isWon() && !this.hasAnyMove();
  }

  // --- undo ---------------------------------------------------------------
  private pushHistory(): void {
    this.history.push(this.columns.map((col) => col.map((cell) => ({ ...cell }))));
    if (this.history.length > 200) this.history.shift();
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.columns = prev;
    return true;
  }
}
