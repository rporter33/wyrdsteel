import { BTN, quantizeAim, quantizeMove, type ButtonName, type PlayerInput } from '../../core/input/frame';
import { DEFAULT_KEYS, MOVE_KEYS, PAD, type KeyBindings } from './bindings';

export interface AimSource {
  /** World XZ point under the cursor at chest height, or null. */
  cursorWorld(): { x: number; z: number } | null;
  /** Player position the aim offset is relative to. */
  playerPos(): { x: number; z: number } | null;
  /** Soft-target position to park the reticle on when the stick is idle. */
  parkTarget(): { x: number; z: number } | null;
}

export type Device = 'keyboard' | 'gamepad';

/**
 * Turns raw device state into one PlayerInput per tick. Presses are latched between ticks so a tap
 * shorter than a tick is never lost, and released only when a tick consumes them.
 */
export class InputSampler {
  private down = new Set<string>();
  private latched = new Set<string>();
  private padPrev = 0;
  private padLatched = 0;
  bindings: KeyBindings = structuredClone(DEFAULT_KEYS);
  device: Device = 'keyboard';
  deadzone = 0.18;
  /** Set by menus: while true, gameplay input is suppressed. */
  suspended = false;
  private aimRange = 9;
  private mouseMoved = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab') e.preventDefault();
      this.press(e.code);
      this.device = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('mousedown', (e) => {
      this.press(`Mouse${e.button}`);
      this.device = 'keyboard';
      target.focus();
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        this.latched.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
      },
      { passive: true },
    );
    target.addEventListener('mousemove', () => {
      this.mouseMoved = true;
      this.device = 'keyboard';
    });
  }

  private press(code: string) {
    this.down.add(code);
    this.latched.add(code);
  }
  private release(code: string) {
    this.down.delete(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  private keyAny(codes: string[], set: Set<string>): boolean {
    return codes.some((c) => set.has(c));
  }

  private gamepad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && (p.mapping === 'standard' || p.buttons.length >= 16)) return p;
    return null;
  }

  /** Bitmask of gamepad buttons currently down, mapped to game actions. */
  private padButtons(gp: Gamepad): number {
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    let m = 0;
    const lb = b(PAD.LB);
    const rb = b(PAD.RB);
    if (lb && rb) m |= BTN.ruiner;
    if (lb && !rb) {
      if (b(PAD.X)) m |= BTN.ab1;
      if (b(PAD.Y)) m |= BTN.ab2;
      if (b(PAD.B)) m |= BTN.ab3;
      if (b(PAD.A)) m |= BTN.ab4;
    } else {
      if (b(PAD.X)) m |= BTN.light;
      if (b(PAD.Y)) m |= BTN.heavy;
      if (b(PAD.B)) m |= BTN.launcher;
      if (b(PAD.A)) m |= BTN.dodge | BTN.skip;
    }
    if (rb && !lb) m |= BTN.interact;
    if (b(PAD.RT) || (gp.buttons[PAD.RT]?.value ?? 0) > 0.4) m |= BTN.fire;
    if (b(PAD.LT) || (gp.buttons[PAD.LT]?.value ?? 0) > 0.4) m |= BTN.precise;
    if (b(PAD.R3)) m |= BTN.lock;
    if (b(PAD.Up)) m |= BTN.flask;
    return m;
  }

  private stick(x: number, y: number): [number, number] {
    const l = Math.hypot(x, y);
    if (l < this.deadzone) return [0, 0];
    const s = Math.min(1, (l - this.deadzone) / (1 - this.deadzone)) / l;
    return [x * s, y * s];
  }

  /** Is a menu-level button newly pressed (gamepad Menu/View or Esc/I/K)? Consumed on read. */
  takeUi(): string[] {
    const out: string[] = [];
    for (const code of ['Escape', 'KeyI', 'KeyK', 'KeyM']) {
      if (this.latched.has(code)) {
        out.push(code);
        this.latched.delete(code);
      }
    }
    const gp = this.gamepad();
    if (gp) {
      const menu = !!gp.buttons[PAD.Menu]?.pressed;
      const view = !!gp.buttons[PAD.View]?.pressed;
      const prev = this.padUi;
      if (menu && !(prev & 1)) out.push('Escape');
      if (view && !(prev & 2)) out.push('KeyI');
      this.padUi = (menu ? 1 : 0) | (view ? 2 : 0);
    }
    return out;
  }
  private padUi = 0;

  sample(aim: AimSource): PlayerInput {
    let held = 0;
    let pressed = 0;
    for (const name of Object.keys(this.bindings) as ButtonName[]) {
      const codes = this.bindings[name];
      if (this.keyAny(codes, this.down)) held |= BTN[name];
      if (this.keyAny(codes, this.latched)) pressed |= BTN[name];
    }
    let mx = (this.keyAny(MOVE_KEYS.right, this.down) ? 1 : 0) - (this.keyAny(MOVE_KEYS.left, this.down) ? 1 : 0);
    let mz = (this.keyAny(MOVE_KEYS.down, this.down) ? 1 : 0) - (this.keyAny(MOVE_KEYS.up, this.down) ? 1 : 0);
    let ax = 0;
    let az = 0;
    const pos = aim.playerPos();
    const gp = this.gamepad();
    if (gp) {
      const ph = this.padButtons(gp);
      const [lx, ly] = this.stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      const [rx, ry] = this.stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      if (ph || lx || ly || rx || ry) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        held |= ph;
        pressed |= ph & ~this.padPrev;
        pressed |= this.padLatched;
        if (lx || ly) {
          mx = lx;
          mz = ly;
        }
        if (pos && (rx || ry)) {
          // Reticle distance scales with stick deflection; flicks while locked cycle targets.
          const l = Math.min(1, Math.hypot(rx, ry));
          ax = (rx / Math.max(1e-6, Math.hypot(rx, ry))) * (2 + l * this.aimRange);
          az = (ry / Math.max(1e-6, Math.hypot(rx, ry))) * (2 + l * this.aimRange);
        } else if (pos) {
          const park = aim.parkTarget();
          if (park) {
            ax = park.x - pos.x;
            az = park.z - pos.z;
          }
        }
      }
      this.padPrev = ph;
      this.padLatched = 0;
    }
    if (this.device === 'keyboard' && pos) {
      const c = aim.cursorWorld();
      if (c && (this.mouseMoved || true)) {
        ax = c.x - pos.x;
        az = c.z - pos.z;
      }
    }
    this.latched.clear();
    if (this.suspended) return { mx: 0, mz: 0, ax: 0, az: 0, held: 0, pressed: 0 };
    const [qmx, qmz] = quantizeMove(mx, mz);
    const [qax, qaz] = ax || az ? quantizeAim(ax, az) : [0, 0];
    return { mx: qmx, mz: qmz, ax: qax, az: qaz, held, pressed };
  }
}
