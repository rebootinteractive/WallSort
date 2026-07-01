import * as THREE from 'three';
import type { LevelData } from '../shared/types';
import { Board, type BoardCell, type ClearEvent } from './Board';
import {
  PITCH,
  colX,
  rowY,
  makeTile,
  makeSep,
  updateSep,
  disposeCellMesh,
  type CellMesh,
} from './render';
import { Hud } from './Hud';
import {
  Runner,
  Tween,
  lerp,
  linear,
  easeOutCubic,
  easeInCubic,
  easeInOutCubic,
} from './anim';

export interface GameOpts {
  level: LevelData;
  onMenu: () => void;
  onNext?: () => void;
}

interface CellSlot {
  cell: BoardCell;
  col: number;
  row: number;
  x: number;
  y: number;
}

export class GameApp {
  private level: LevelData;
  private board: Board;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private wallGroup: THREE.Group;
  private container: HTMLDivElement;
  private hud: Hud;
  private resizeObserver: ResizeObserver;
  private runner = new Runner();

  private cellMeshes = new Map<number, CellMesh>();
  private visibleRows: number;

  private rafId = 0;
  private lastT = 0;
  private locked = false;
  private finished = false;

  constructor(parent: HTMLElement, opts: GameOpts) {
    this.level = opts.level;
    this.board = Board.fromLevel(this.level);
    this.visibleRows = Math.max(6, ...this.board.columns.map((c) => c.length));

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.container = document.createElement('div');
    this.container.className = 'game-canvas-wrap';
    this.container.appendChild(this.renderer.domElement);
    parent.appendChild(this.container);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f15);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;
    this.wallGroup = new THREE.Group();
    this.scene.add(this.wallGroup);

    this.hud = new Hud(parent, this.level.name, {
      onMenu: opts.onMenu,
      onUndo: () => this.doUndo(),
      onRestart: () => this.doRestart(),
      onNext: opts.onNext,
    });

    this.buildAll();
    this.fit();

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.container);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    this.hud.setUndoEnabled(false);
    this.lastT = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // --- indexing / layout ---------------------------------------------------
  private computeIndex(columns: BoardCell[][] = this.board.columns): Map<number, CellSlot> {
    const cols = columns.length;
    const idx = new Map<number, CellSlot>();
    for (let c = 0; c < cols; c++) {
      const col = columns[c];
      for (let r = 0; r < col.length; r++) {
        const cell = col[r];
        idx.set(cell.id, { cell, col: c, row: r, x: colX(c, cols), y: rowY(r) });
      }
    }
    return idx;
  }

  private createMeshFor(slot: CellSlot): CellMesh {
    return slot.cell.kind === 'tile'
      ? makeTile(slot.cell.id, slot.cell.color)
      : makeSep(slot.cell.id, slot.cell.target);
  }

  private buildAll(): void {
    const idx = this.computeIndex();
    for (const [id, slot] of idx) {
      const m = this.createMeshFor(slot);
      this.cellMeshes.set(id, m);
      this.wallGroup.add(m.group);
      m.group.position.set(slot.x, slot.y, 0);
    }
    this.updateSeparators();
  }

  private updateSeparators(): void {
    const idx = this.computeIndex();
    for (const [id, slot] of idx) {
      if (slot.cell.kind !== 'sep') continue;
      const m = this.cellMeshes.get(id);
      if (m) updateSep(m, this.board.sepStatusAt(slot.col, slot.row));
    }
  }

  // --- input ---------------------------------------------------------------
  private onPointerDown = (e: PointerEvent): void => {
    if (this.locked || this.finished) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(this.camera);
    const cols = this.board.columns.length;
    const c = Math.round(world.x / PITCH + (cols - 1) / 2);
    if (c < 0 || c >= cols) return;
    this.handleTap(c);
  };

  private handleTap(col: number): void {
    const run = this.board.topRun(col);
    if (!run) {
      if (this.board.columns[col]?.length) this.shake(col);
      return;
    }
    const to = this.board.findFlyTarget(col);
    if (to === null) {
      this.shake(col);
      return;
    }

    // Simulate the landing WITHOUT resolving, to get intermediate positions.
    const sim = this.board.columns.map((c) => c.slice());
    const moved = sim[col].splice(0, run.count);
    sim[to].unshift(...moved);
    const idx1 = this.computeIndex(sim);
    const movedIds = moved.map((m) => m.id);

    // Commit (this resolves matches) → final state.
    const outcome = this.board.applyTap(col);
    if (outcome.kind !== 'move') return;
    const idx2 = this.computeIndex();

    this.locked = true;
    this.animateMove(col, to, movedIds, idx1, outcome.clears, idx2);
  }

  // --- animations ----------------------------------------------------------
  private animateMove(
    from: number,
    to: number,
    movedIds: number[],
    idx1: Map<number, CellSlot>,
    clears: ClearEvent[],
    idx2: Map<number, CellSlot>,
  ): void {
    const cols = this.board.columns.length;
    const fromX = colX(from, cols);
    const toX = colX(to, cols);
    const movedSet = new Set(movedIds);

    const startPos = new Map<number, { x: number; y: number }>();
    for (const [id, m] of this.cellMeshes) startPos.set(id, { x: m.group.position.x, y: m.group.position.y });

    const FLY = 440;
    this.runner.add(
      new Tween(
        FLY,
        (p) => {
          for (const [id, m] of this.cellMeshes) {
            const t = idx1.get(id);
            if (!t) continue;
            const s = startPos.get(id)!;
            if (movedSet.has(id)) {
              const i = movedIds.indexOf(id);
              const yFlight = 0.3 + (movedIds.length - 1 - i) * PITCH;
              let x: number;
              let y: number;
              let flip = 0;
              if (p < 0.28) {
                const q = easeOutCubic(p / 0.28);
                x = s.x;
                y = lerp(s.y, yFlight, q);
              } else if (p < 0.68) {
                const q = easeInOutCubic((p - 0.28) / 0.4);
                x = lerp(fromX, toX, q);
                y = yFlight + Math.sin(q * Math.PI) * 0.25;
                flip = Math.sin(q * Math.PI) * Math.PI;
              } else {
                const q = easeInCubic((p - 0.68) / 0.32);
                x = toX;
                y = lerp(yFlight, t.y, q);
              }
              m.group.position.set(x, y, 0.35);
              m.group.rotation.y = flip;
            } else {
              const q = easeInOutCubic(p);
              m.group.position.set(lerp(s.x, t.x, q), lerp(s.y, t.y, q), 0);
            }
          }
        },
        linear,
        () => {
          for (const id of movedIds) {
            const m = this.cellMeshes.get(id);
            if (!m) continue;
            const t = idx1.get(id)!;
            m.group.rotation.y = 0;
            m.group.position.set(t.x, t.y, 0);
          }
          this.startClearPhase(clears, idx2);
        },
      ),
    );
  }

  private startClearPhase(clears: ClearEvent[], idx2: Map<number, CellSlot>): void {
    if (clears.length === 0) {
      this.finishMove(idx2, null);
      return;
    }
    const clearedIds = new Set<number>();
    for (const c of clears) {
      for (const id of c.tileIds) clearedIds.add(id);
      clearedIds.add(c.sepId);
    }

    const POP = 300;
    const COLLAPSE = 360;

    for (const id of clearedIds) {
      const m = this.cellMeshes.get(id);
      if (!m) continue;
      this.runner.add(
        new Tween(POP, (p) => {
          m.group.scale.setScalar(1 + 0.4 * p);
          for (const mat of m.materials) (mat as THREE.Material & { opacity: number }).opacity = 1 - p;
        }, easeOutCubic),
      );
    }

    const start2 = new Map<number, { x: number; y: number }>();
    for (const [id, m] of this.cellMeshes) start2.set(id, { x: m.group.position.x, y: m.group.position.y });

    this.runner.add(
      new Tween(
        COLLAPSE,
        (p) => {
          for (const [id, slot] of idx2) {
            const m = this.cellMeshes.get(id);
            if (!m) continue;
            const s = start2.get(id) ?? { x: slot.x, y: slot.y };
            m.group.position.set(lerp(s.x, slot.x, p), lerp(s.y, slot.y, p), 0);
          }
        },
        easeOutCubic,
        () => this.finishMove(idx2, clearedIds),
      ),
    );
  }

  private finishMove(idx2: Map<number, CellSlot>, clearedIds: Set<number> | null): void {
    if (clearedIds) {
      for (const id of clearedIds) {
        const m = this.cellMeshes.get(id);
        if (m) {
          disposeCellMesh(m);
          this.cellMeshes.delete(id);
        }
      }
    }
    for (const [id, slot] of idx2) {
      const m = this.cellMeshes.get(id);
      if (m) m.group.position.set(slot.x, slot.y, 0);
    }
    for (const [, m] of this.cellMeshes) {
      m.group.rotation.set(0, 0, 0);
      m.group.scale.setScalar(1);
    }
    this.updateSeparators();
    this.locked = false;
    this.checkEnd();
  }

  private shake(col: number): void {
    this.locked = true;
    const cols = this.board.columns.length;
    const baseX = colX(col, cols);
    const ids = this.board.columns[col].map((c) => c.id);
    this.runner.add(
      new Tween(
        320,
        (p) => {
          const dx = Math.sin(p * Math.PI * 6) * 0.16 * (1 - p);
          for (const id of ids) {
            const m = this.cellMeshes.get(id);
            if (m) m.group.position.x = baseX + dx;
          }
        },
        linear,
        () => {
          for (const id of ids) {
            const m = this.cellMeshes.get(id);
            if (m) m.group.position.x = baseX;
          }
          this.locked = false;
        },
      ),
    );
  }

  // --- undo / restart / reconcile -----------------------------------------
  private doUndo(): void {
    if (this.locked || !this.board.canUndo()) return;
    this.hud.dismissModal();
    this.finished = false;
    this.board.undo();
    this.reconcile(240);
  }

  private doRestart(): void {
    this.hud.dismissModal();
    this.runner.clear();
    this.finished = false;
    this.locked = false;
    this.board = Board.fromLevel(this.level);
    for (const [, m] of this.cellMeshes) disposeCellMesh(m);
    this.cellMeshes.clear();
    this.buildAll();
    this.hud.setUndoEnabled(false);
  }

  /** Snap the view to the current model, animating positions. Recreates any
   *  missing meshes (e.g. after undo brings cleared cells back). */
  private reconcile(dur = 260): void {
    this.locked = true;
    const idx = this.computeIndex();

    for (const [id, m] of [...this.cellMeshes]) {
      if (!idx.has(id)) {
        disposeCellMesh(m);
        this.cellMeshes.delete(id);
      }
    }

    const moves: { m: CellMesh; fx: number; fy: number; tx: number; ty: number }[] = [];
    for (const [id, slot] of idx) {
      let m = this.cellMeshes.get(id);
      if (!m) {
        m = this.createMeshFor(slot);
        this.cellMeshes.set(id, m);
        this.wallGroup.add(m.group);
        m.group.position.set(slot.x, slot.y, 0);
      }
      moves.push({ m, fx: m.group.position.x, fy: m.group.position.y, tx: slot.x, ty: slot.y });
    }
    this.updateSeparators();

    this.runner.add(
      new Tween(
        dur,
        (p) => {
          for (const a of moves) {
            a.m.group.position.x = lerp(a.fx, a.tx, p);
            a.m.group.position.y = lerp(a.fy, a.ty, p);
          }
        },
        easeOutCubic,
        () => {
          for (const a of moves) a.m.group.position.set(a.tx, a.ty, 0);
          this.locked = false;
          this.hud.setUndoEnabled(this.board.canUndo());
        },
      ),
    );
  }

  private checkEnd(): void {
    this.hud.setUndoEnabled(this.board.canUndo());
    if (this.board.isWon()) {
      this.finished = true;
      this.hud.showWin();
    } else if (this.board.isStuck()) {
      this.hud.showStuck();
    }
  }

  // --- camera / loop -------------------------------------------------------
  private fit(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;

    const cols = this.board.columns.length;
    const contentW = Math.max(cols * PITCH, 3);
    const topPad = 1.8;
    const botPad = 0.8;
    const contentH = this.visibleRows * PITCH + topPad + botPad;

    const halfWNeeded = contentW / 2 + 0.4;
    const halfHNeeded = contentH / 2;
    let halfW: number;
    let halfH: number;
    if (halfWNeeded / halfHNeeded > aspect) {
      halfW = halfWNeeded;
      halfH = halfW / aspect;
    } else {
      halfH = halfHNeeded;
      halfW = halfH * aspect;
    }
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    const centerY = (topPad - (this.visibleRows * PITCH + botPad)) / 2;
    this.camera.position.set(0, centerY, 10);
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(50, now - this.lastT);
    this.lastT = now;
    this.runner.tick(dt);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver.disconnect();
    this.runner.clear();
    for (const [, m] of this.cellMeshes) disposeCellMesh(m);
    this.cellMeshes.clear();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.remove();
  }
}
