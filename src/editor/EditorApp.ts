import * as THREE from 'three';
import type { Cell, ColorKey, LevelData } from '../shared/types';
import { DEFAULT_TARGET } from '../shared/types';
import { COLOR_CSS, COLOR_KEYS } from '../shared/colors';
import { PITCH, colX, rowY, makeTile, makeSep, disposeCellMesh, type CellMesh } from '../game/render';
import { saveCustomLevel } from '../ui/storage';

export interface EditorOpts {
  initial?: LevelData;
  onExit: () => void;
  onTestPlay: (lv: LevelData) => void;
}

type Tool = 'tile' | 'sep' | 'erase';

const MAX_COLS = 8;

export class EditorApp {
  private columns: Cell[][];
  private name: string;
  private id: string;
  private tool: Tool = 'tile';
  private color: ColorKey = 'red';

  private root: HTMLDivElement;
  private canvasWrap: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private colsInput: HTMLInputElement;
  private actionBtns: Record<'test' | 'copy' | 'download' | 'save', HTMLButtonElement>;
  private modalEl: HTMLDivElement | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private group: THREE.Group;
  private meshes: CellMesh[] = [];
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private meshIdCounter = 1;
  private visibleRows = 8;

  constructor(parent: HTMLElement, private opts: EditorOpts) {
    this.id = opts.initial?.id ?? `custom-${Date.now()}`;
    this.name = opts.initial?.name ?? 'My Level';
    this.columns = opts.initial
      ? opts.initial.columns.map((c) => c.map((cell) => ({ ...cell })))
      : [[], [], [], []];

    this.root = document.createElement('div');
    this.root.className = 'editor-root';
    this.root.innerHTML = `
      <div class="editor-toolbar">
        <div class="tool-group">
          <button class="tool-btn active" data-tool="tile">Tile</button>
          <button class="tool-btn" data-tool="sep">Separator</button>
          <button class="tool-btn" data-tool="erase">Erase</button>
        </div>
        <div class="color-row"></div>
        <div class="hud-spacer"></div>
        <button class="btn ghost small" data-act="menu">‹ Menu</button>
      </div>
      <div class="editor-hint"></div>
      <div class="editor-canvas-wrap"></div>
      <div class="editor-bottom">
        <div class="editor-fields">
          <label class="editor-field"><span>Name</span><input type="text" data-f="name" /></label>
          <label class="editor-field"><span>Cols</span><input type="number" data-f="cols" min="1" max="${MAX_COLS}" /></label>
        </div>
        <div class="editor-status"></div>
        <div class="editor-actions">
          <button class="btn small" data-act="test">▶ Test</button>
          <button class="btn ghost small" data-act="copy">Copy JSON</button>
          <button class="btn ghost small" data-act="download">↓ Download</button>
          <button class="btn small" data-act="save">Save</button>
        </div>
      </div>`;
    parent.appendChild(this.root);

    this.canvasWrap = this.root.querySelector('.editor-canvas-wrap') as HTMLDivElement;
    this.hintEl = this.root.querySelector('.editor-hint') as HTMLDivElement;
    this.statusEl = this.root.querySelector('.editor-status') as HTMLDivElement;
    this.nameInput = this.root.querySelector('[data-f=name]') as HTMLInputElement;
    this.colsInput = this.root.querySelector('[data-f=cols]') as HTMLInputElement;
    this.nameInput.value = this.name;
    this.colsInput.value = String(this.columns.length);
    this.actionBtns = {
      test: this.root.querySelector('[data-act=test]') as HTMLButtonElement,
      copy: this.root.querySelector('[data-act=copy]') as HTMLButtonElement,
      download: this.root.querySelector('[data-act=download]') as HTMLButtonElement,
      save: this.root.querySelector('[data-act=save]') as HTMLButtonElement,
    };

    this.buildColorRow();
    this.wireToolbar();
    this.wireBottom();

    // three preview
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvasWrap.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f15);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasDown);
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.canvasWrap);

    this.rebuildPreview();
    this.refreshUI();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // --- UI wiring ------------------------------------------------------------
  private buildColorRow(): void {
    const row = this.root.querySelector('.color-row') as HTMLDivElement;
    row.innerHTML = COLOR_KEYS.map(
      (c) =>
        `<button class="color-dot${c === this.color ? ' active' : ''}" data-color="${c}" style="background:${COLOR_CSS[c]}"></button>`,
    ).join('');
    row.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.color = btn.dataset.color as ColorKey;
        row.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
        btn.classList.add('active');
        this.tool = 'tile';
        this.syncToolButtons();
        this.refreshUI();
      });
    });
  }

  private wireToolbar(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = btn.dataset.tool as Tool;
        this.syncToolButtons();
        this.refreshUI();
      });
    });
    (this.root.querySelector('[data-act=menu]') as HTMLElement).addEventListener('click', () =>
      this.opts.onExit(),
    );
  }

  private syncToolButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === this.tool);
    });
    const row = this.root.querySelector('.color-row') as HTMLDivElement;
    row.style.opacity = this.tool === 'tile' ? '1' : '0.35';
  }

  private wireBottom(): void {
    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value;
    });
    this.colsInput.addEventListener('change', () => {
      const n = Math.max(1, Math.min(MAX_COLS, Math.round(Number(this.colsInput.value) || 1)));
      this.setCols(n);
      this.colsInput.value = String(n);
    });
    this.actionBtns.test.addEventListener('click', () => {
      const v = this.validity();
      if (v.valid) this.opts.onTestPlay(this.snapshot());
    });
    this.actionBtns.copy.addEventListener('click', () => this.copyJson());
    this.actionBtns.download.addEventListener('click', () => this.download());
    this.actionBtns.save.addEventListener('click', () => this.save());
  }

  // --- editing --------------------------------------------------------------
  private setCols(n: number): void {
    if (n < this.columns.length) this.columns.length = n;
    else while (this.columns.length < n) this.columns.push([]);
    this.rebuildPreview();
    this.refreshUI();
  }

  private applyTool(col: number): void {
    if (col < 0 || col >= this.columns.length) return;
    if (this.tool === 'tile') this.columns[col].push({ kind: 'tile', color: this.color });
    else if (this.tool === 'sep') this.columns[col].push({ kind: 'sep', target: DEFAULT_TARGET });
    else this.columns[col].pop();
    this.rebuildPreview();
    this.refreshUI();
  }

  private onCanvasDown = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(this.camera);
    const cols = this.columns.length;
    const c = Math.round(world.x / PITCH + (cols - 1) / 2);
    this.applyTool(c);
  };

  // --- validity -------------------------------------------------------------
  private validity(): {
    perColor: Record<string, number>;
    total: number;
    seps: number;
    valid: boolean;
    reason: string;
  } {
    const perColor: Record<string, number> = {};
    let total = 0;
    let seps = 0;
    for (const col of this.columns) {
      for (const cell of col) {
        if (cell.kind === 'tile') {
          perColor[cell.color] = (perColor[cell.color] ?? 0) + 1;
          total++;
        } else {
          seps++;
        }
      }
    }
    const colorsOk = COLOR_KEYS.every((c) => ((perColor[c] ?? 0) % 10) === 0);
    const capacityOk = seps > 0 && seps * DEFAULT_TARGET === total;
    const valid = total > 0 && colorsOk && capacityOk;
    let reason = 'Solvable ✓';
    if (total === 0) reason = 'Add tiles and a separator.';
    else if (!colorsOk) reason = 'Each color must total a multiple of 10.';
    else if (seps === 0) reason = 'Add at least one separator.';
    else if (!capacityOk) reason = `Tiles (${total}) must equal 10 × ${seps} sep = ${seps * DEFAULT_TARGET}.`;
    return { perColor, total, seps, valid, reason };
  }

  private refreshUI(): void {
    const hints: Record<Tool, string> = {
      tile: 'Tap a column to stack a tile (grows downward from the top).',
      sep: 'Tap a column to drop a separator at its bottom.',
      erase: 'Tap a column to remove its bottom cell.',
    };
    this.hintEl.textContent = hints[this.tool];

    const v = this.validity();
    const chips = COLOR_KEYS.filter((c) => (v.perColor[c] ?? 0) > 0)
      .map((c) => {
        const n = v.perColor[c] ?? 0;
        const ok = n % 10 === 0;
        return `<span class="count-chip${ok ? '' : ' bad'}"><i style="background:${COLOR_CSS[c]}"></i>${n}</span>`;
      })
      .join('');
    this.statusEl.innerHTML = `
      <div class="status-line ${v.valid ? 'ok' : 'warn'}">${v.reason}</div>
      <div class="chips">${chips || '<span class="count-chip muted">no tiles</span>'}<span class="count-chip muted">✂ ${v.seps}</span></div>`;

    for (const key of ['test', 'download', 'save'] as const) {
      this.actionBtns[key].disabled = !v.valid;
    }
    this.syncToolButtons();
  }

  // --- export ---------------------------------------------------------------
  private snapshot(): LevelData {
    return {
      id: this.id,
      name: this.name.trim() || 'Untitled',
      columns: this.columns.map((c) => c.map((cell) => ({ ...cell }))),
    };
  }

  private save(): void {
    if (!this.validity().valid) return;
    saveCustomLevel(this.snapshot());
    this.flashStatus('Saved to your levels.');
  }

  private download(): void {
    if (!this.validity().valid) return;
    const lv = this.snapshot();
    const json = JSON.stringify(lv, null, 2);
    const slug =
      (lv.name || lv.id || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
      'level';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.flashStatus('Downloaded — drop into src/levels/contributed/ to ship it.');
  }

  private copyJson(): void {
    const json = JSON.stringify(this.snapshot(), null, 2);
    this.showModal(
      `<h2>Level JSON</h2>
       <textarea class="json" readonly>${json.replace(/</g, '&lt;')}</textarea>
       <div class="modal-actions">
         <button class="btn" data-act="ok">Close</button>
       </div>`,
      (el) => {
        const ta = el.querySelector('textarea') as HTMLTextAreaElement;
        ta.focus();
        ta.select();
        navigator.clipboard?.writeText(json).catch(() => {});
        el.querySelector('[data-act=ok]')?.addEventListener('click', () => this.dismissModal());
      },
    );
  }

  private flashStatus(msg: string): void {
    const line = this.statusEl.querySelector('.status-line');
    if (line) {
      line.textContent = msg;
      line.classList.add('flash');
      window.setTimeout(() => this.refreshUI(), 1800);
    }
  }

  private showModal(html: string, wire: (el: HTMLDivElement) => void): void {
    this.dismissModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-card">${html}</div>`;
    this.root.appendChild(el);
    this.modalEl = el;
    wire(el);
  }

  private dismissModal(): void {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  // --- preview rendering ----------------------------------------------------
  private rebuildPreview(): void {
    for (const m of this.meshes) disposeCellMesh(m);
    this.meshes = [];
    const cols = this.columns.length;
    this.visibleRows = Math.max(8, ...this.columns.map((c) => c.length));
    for (let c = 0; c < cols; c++) {
      const col = this.columns[c];
      for (let r = 0; r < col.length; r++) {
        const cell = col[r];
        const m =
          cell.kind === 'tile'
            ? makeTile(this.meshIdCounter++, cell.color)
            : makeSep(this.meshIdCounter++, cell.target);
        m.group.position.set(colX(c, cols), rowY(r), 0);
        this.group.add(m.group);
        this.meshes.push(m);
      }
    }
    this.fit();
  }

  private fit(): void {
    const w = this.canvasWrap.clientWidth || 1;
    const h = this.canvasWrap.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const cols = this.columns.length;
    const contentW = Math.max(cols * PITCH, 3);
    const topPad = 1.2;
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
    this.camera.position.set(0, (topPad - (this.visibleRows * PITCH + botPad)) / 2, 10);
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onCanvasDown);
    this.resizeObserver.disconnect();
    this.dismissModal();
    for (const m of this.meshes) disposeCellMesh(m);
    this.meshes = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.root.remove();
  }
}
