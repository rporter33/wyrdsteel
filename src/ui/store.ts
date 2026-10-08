import { signal } from '@preact/signals';

export type Screen = 'title' | 'newgame' | 'game' | 'loading' | 'load' | 'settings';
export type Panel = null | 'pause' | 'inventory' | 'skills' | 'settings' | 'controls' | 'smith' | 'carver' | 'well' | 'board' | 'skald' | 'gate' | 'stash' | 'dialogue' | 'death' | 'ending' | 'map' | 'saves' | 'trainer';

export const screen = signal<Screen>('title');
export const panel = signal<Panel>(null);
/** Bumped whenever sim state the menus show may have changed. */
export const version = signal(0);

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'loot';
  action?: { label: string; run: () => void };
}
export const toasts = signal<Toast[]>([]);
let tid = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3500): void {
  const t = { id: ++tid, text, kind, action };
  toasts.value = [...toasts.value.slice(-4), t];
  if (ms > 0) setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), ms);
}
