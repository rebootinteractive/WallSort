import type { LevelData } from '../shared/types';
import { ALL_LEVELS } from '../levels';
import { loadCustomLevels, deleteCustomLevel } from './storage';

export interface MenuCallbacks {
  onPlay: (level: LevelData) => void;
  onOpenEditor: (level?: LevelData) => void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export class MainMenu {
  root: HTMLDivElement;

  constructor(parent: HTMLElement, private cb: MenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.render();
  }

  private render(): void {
    const custom = loadCustomLevels();
    const levelCards = ALL_LEVELS.map(
      (l, i) =>
        `<button class="level-card" data-play="${l.id}"><span class="lc-num">${i + 1}</span><span class="lc-name">${esc(l.name)}</span></button>`,
    ).join('');
    const yourSection = custom.length
      ? custom
          .map(
            (l) =>
              `<div class="level-row"><button class="level-card grow" data-play="${l.id}"><span class="lc-name">${esc(l.name)}</span></button><div class="row-actions"><button class="btn ghost small" data-edit="${l.id}">Edit</button><button class="btn ghost small danger" data-del="${l.id}">Delete</button></div></div>`,
          )
          .join('')
      : `<div class="empty-note">No custom levels yet — create one in the editor.</div>`;

    this.root.innerHTML = `
      <div class="menu-head">
        <h1 class="menu-title">Wall Sort</h1>
        <p class="menu-sub">Tap a column — the same-colored tiles on top fly to the next matching stack. Fill each separator with 10 of one color to clear the wall.</p>
      </div>
      <div class="menu-section">
        <div class="section-label">Levels</div>
        <div class="level-grid">${levelCards}</div>
      </div>
      <div class="menu-section">
        <div class="section-label">Your Levels${custom.length ? ` (${custom.length})` : ''}</div>
        <div class="your-levels">${yourSection}</div>
      </div>
      <button class="btn create-btn" data-act="create">+ Create New Level</button>`;

    const all = [...ALL_LEVELS, ...custom];
    this.root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) =>
      b.addEventListener('click', () => {
        const l = all.find((x) => x.id === b.dataset.play);
        if (l) this.cb.onPlay(l);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => {
        const l = custom.find((x) => x.id === b.dataset.edit);
        if (l) this.cb.onOpenEditor(l);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        deleteCustomLevel(b.dataset.del!);
        this.render();
      }),
    );
    (this.root.querySelector('[data-act=create]') as HTMLElement).addEventListener('click', () =>
      this.cb.onOpenEditor(),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}
