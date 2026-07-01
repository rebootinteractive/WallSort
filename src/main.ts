import { MainMenu } from './ui/MainMenu';
import { GameApp } from './game/GameApp';
import { EditorApp } from './editor/EditorApp';
import { ALL_LEVELS } from './levels';
import type { LevelData } from './shared/types';

const app = document.getElementById('app')!;
let current: { dispose(): void } | undefined;

function clearApp(): void {
  current?.dispose();
  current = undefined;
}

function showMenu(): void {
  clearApp();
  current = new MainMenu(app, {
    onPlay: (level) => showGame(level),
    onOpenEditor: (level) => showEditor(level),
  });
}

function showGame(level: LevelData, returnToEditor?: LevelData): void {
  clearApp();
  const idx = ALL_LEVELS.findIndex((l) => l.id === level.id);
  const next =
    !returnToEditor && idx >= 0 && idx < ALL_LEVELS.length - 1 ? ALL_LEVELS[idx + 1] : undefined;
  current = new GameApp(app, {
    level,
    onMenu: () => (returnToEditor ? showEditor(returnToEditor) : showMenu()),
    onNext: next ? () => showGame(next) : undefined,
  });
}

function showEditor(initial?: LevelData): void {
  clearApp();
  current = new EditorApp(app, {
    initial,
    onExit: () => showMenu(),
    onTestPlay: (lv) => showGame(lv, lv),
  });
}

showMenu();
