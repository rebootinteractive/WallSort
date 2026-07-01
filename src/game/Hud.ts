// HTML overlay above the canvas: top bar (back + title), bottom bar (undo/restart),
// and win / stuck modals. Tracks its own DOM for full teardown on dispose.

export interface HudCallbacks {
  onMenu: () => void;
  onUndo: () => void;
  onRestart: () => void;
  onNext?: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export class Hud {
  root: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private undoBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, levelName: string, private cb: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    this.root.innerHTML = `
      <div class="hud-top">
        <button class="btn ghost small" data-act="menu">‹ Levels</button>
        <div class="hud-title">${escapeHtml(levelName)}</div>
        <div class="hud-spacer"></div>
      </div>
      <div class="hud-bottom">
        <button class="btn ghost" data-act="undo">↶ Undo</button>
        <button class="btn ghost" data-act="restart">↻ Restart</button>
      </div>`;
    parent.appendChild(this.root);

    (this.root.querySelector('[data-act=menu]') as HTMLElement).addEventListener('click', () => cb.onMenu());
    this.undoBtn = this.root.querySelector('[data-act=undo]') as HTMLButtonElement;
    this.undoBtn.addEventListener('click', () => cb.onUndo());
    (this.root.querySelector('[data-act=restart]') as HTMLElement).addEventListener('click', () => cb.onRestart());
  }

  setUndoEnabled(enabled: boolean): void {
    this.undoBtn.disabled = !enabled;
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

  showWin(): void {
    const nextBtn = this.cb.onNext ? `<button class="btn" data-act="next">Next level →</button>` : '';
    this.showModal(
      `<div class="modal-emoji">🎉</div>
       <h2>Wall cleared!</h2>
       <p>Every group matched. Clean wall.</p>
       <div class="modal-actions">
         ${nextBtn}
         <button class="btn ghost" data-act="replay">Replay</button>
         <button class="btn ghost" data-act="menu">Levels</button>
       </div>`,
      (el) => {
        el.querySelector('[data-act=next]')?.addEventListener('click', () => this.cb.onNext?.());
        el.querySelector('[data-act=replay]')?.addEventListener('click', () => this.cb.onRestart());
        el.querySelector('[data-act=menu]')?.addEventListener('click', () => this.cb.onMenu());
      },
    );
  }

  showStuck(): void {
    this.showModal(
      `<div class="modal-emoji">🧱</div>
       <h2>No moves left</h2>
       <p>Take a move back, or restart the wall.</p>
       <div class="modal-actions">
         <button class="btn" data-act="undo">↶ Undo</button>
         <button class="btn ghost" data-act="restart">↻ Restart</button>
         <button class="btn ghost" data-act="menu">Levels</button>
       </div>`,
      (el) => {
        el.querySelector('[data-act=undo]')?.addEventListener('click', () => {
          this.dismissModal();
          this.cb.onUndo();
        });
        el.querySelector('[data-act=restart]')?.addEventListener('click', () => this.cb.onRestart());
        el.querySelector('[data-act=menu]')?.addEventListener('click', () => this.cb.onMenu());
      },
    );
  }

  dismissModal(): void {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  dispose(): void {
    this.dismissModal();
    this.root.remove();
  }
}
