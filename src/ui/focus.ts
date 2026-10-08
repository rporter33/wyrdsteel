/**
 * Gamepad and arrow-key navigation for menus: move focus to the nearest focusable control in the
 * pressed direction; A / Enter activates; B / Escape backs out. Works on whatever is on screen,
 * so every menu gets it without per-menu code.
 */
const SELECTOR = 'button:not([disabled]), [data-focus], input, select';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((e) => e.offsetParent !== null);
}

export function moveFocus(root: HTMLElement, dx: number, dy: number): void {
  const els = focusables(root);
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur)) {
    els[0]!.focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bs = Infinity;
  for (const e of els) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect();
    const vx = b.left + b.width / 2 - ax;
    const vy = b.top + b.height / 2 - ay;
    const along = vx * dx + vy * dy;
    if (along <= 4) continue;
    const across = Math.abs(vx * dy - vy * dx);
    const s = along + across * 2.5;
    if (s < bs) {
      bs = s;
      best = e;
    }
  }
  best?.focus();
  best?.scrollIntoView({ block: 'nearest' });
}

export class MenuPad {
  private prev = 0;
  private repeatAt = 0;

  /** Poll once per frame while a menu is open. Returns 'back' when B was pressed. */
  poll(root: HTMLElement, now: number): 'back' | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return null;
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    let dir = 0;
    if (b(12) || ay < -0.6) dir = 1;
    else if (b(13) || ay > 0.6) dir = 2;
    else if (b(14) || ax < -0.6) dir = 3;
    else if (b(15) || ax > 0.6) dir = 4;
    const bits = dir | (b(0) ? 16 : 0) | (b(1) ? 32 : 0) | (b(4) ? 64 : 0) | (b(5) ? 128 : 0);
    const fresh = bits & ~this.prev;
    let out: 'back' | null = null;
    if (dir && ((fresh & 15) || now > this.repeatAt)) {
      const [dx, dy] = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]][dir]!;
      moveFocus(root, dx!, dy!);
      this.repeatAt = now + ((fresh & 15) ? 320 : 120);
    }
    if (fresh & 16) (document.activeElement as HTMLElement | null)?.click();
    if (fresh & 32) out = 'back';
    // Bumpers cycle tabs.
    if (fresh & 64) root.querySelector<HTMLElement>('[data-tab-prev]')?.click();
    if (fresh & 128) root.querySelector<HTMLElement>('[data-tab-next]')?.click();
    this.prev = bits;
    return out;
  }
}

export function installArrowKeys(getRoot: () => HTMLElement | null): void {
  window.addEventListener('keydown', (e) => {
    const root = getRoot();
    if (!root || !root.childElementCount) return;
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dirs[e.key];
    if (d && !(document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      moveFocus(root, d[0], d[1]);
    }
  });
}
