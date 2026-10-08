import * as THREE from 'three';

/**
 * Skeletal animation for the skinned characters. Clips come from a CC0 library on one shared
 * skeleton; the simulation decides what happens and when, and this only chooses clips and
 * blends them. Action clips are not played at their own pace: an action's progress is mapped onto
 * the clip so that the clip's moment of impact lands on the tick the sim deals the hit.
 */

/** A clip, or a span of one, that an action's progress is mapped onto. Times in seconds. */
export interface ClipRef {
  clip: string;
  from?: number;
  to?: number;
  /** The moment of contact; the action's first hit is pinned to it. */
  impact?: number;
  /** Upper body only, so the legs keep walking (firing on the move). */
  upper?: boolean;
}

export interface MoveSet {
  idle: string;
  /** Idle with a melee weapon out. */
  guard?: string;
  walk: string;
  jog: string;
  sprint: string;
  /** Ground speed (m/s) of walk, jog and sprint at their own rate, for a 1.8 m body. */
  speeds: [number, number, number];
  /** Per pose family; anything missing falls back to POSES. */
  poses?: Record<string, ClipRef>;
  /** Upper body held while aiming. */
  aim: string;
}

/** The default mapping from the sim's pose families onto clips, with hand-timed impacts. */
export const POSES: Record<string, ClipRef> = {
  slashR: { clip: 'Sword_Regular_A', impact: 0.25 },
  slashL: { clip: 'Sword_Regular_B', impact: 0.27 },
  twin: { clip: 'Sword_Regular_C', from: 0.3, to: 1.6, impact: 0.6 },
  thrust: { clip: 'Sword_Dash', from: 0.1, to: 1.3, impact: 0.45 },
  overhead: { clip: 'Sword_Heavy_Combo', from: 2.2, to: 3.7, impact: 3.0 },
  uppercut: { clip: 'Sword_Regular_C', from: 0, to: 1.0, impact: 0.3 },
  spin: { clip: 'Sword_Attack', from: 0.2, to: 1.4, impact: 0.66 },
  slam: { clip: 'Sword_Heavy_Combo', from: 1.3, to: 2.3, impact: 1.86 },
  shoot: { clip: 'Pistol_Shoot', impact: 0.03, upper: true },
  heave: { clip: 'OverhandThrow', impact: 0.4 },
  throw: { clip: 'OverhandThrow', impact: 0.4 },
  cast: { clip: 'Spell_Simple_Enter', impact: 0.38 },
  leap: { clip: 'Sword_Regular_C', from: 0.15, to: 1.2, impact: 0.57 },
  howl: { clip: 'Idle_Shield_Break', impact: 0.3 },
  block: { clip: 'Sword_Block', from: 0.2, to: 0.6, impact: 0.35 },
  roll: { clip: 'Roll', to: 1.25 },
};

export const HERO_MOVES: MoveSet = {
  idle: 'Idle_Loop',
  guard: 'Sword_Idle',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  speeds: [1.5, 3.4, 6.2],
  aim: 'Pistol_Idle_Loop',
};

/** Spine and up: the part an aim or a shot replaces while the legs keep their stride. */
const UPPER = /^(spine_0[23]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_)/;

/** The clip library, trimmed for the sim's needs and split into upper and lower halves on demand. */
export class ClipLib {
  private clips = new Map<string, THREE.AnimationClip>();
  private parts = new Map<string, THREE.AnimationClip>();
  readonly grip: THREE.AnimationClip | null;

  constructor(src: THREE.AnimationClip[]) {
    for (const c of src) {
      // The root never moves: the simulation places the body.
      c.tracks = c.tracks.filter((t) => !t.name.startsWith('root.'));
      this.clips.set(c.name, c);
    }
    this.grip = this.clips.get('Grip') ?? null;
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  get(name: string): THREE.AnimationClip {
    return this.clips.get(name) ?? this.clips.get('Idle_Loop')!;
  }

  /** 'U' keeps the upper body's tracks, 'L' the rest. */
  part(name: string, part: 'U' | 'L'): THREE.AnimationClip {
    const key = `${name}|${part}`;
    let c = this.parts.get(key);
    if (!c) {
      const src = this.get(name);
      const tracks = src.tracks.filter((t) => UPPER.test(t.name.split('.')[0]!) === (part === 'U'));
      c = new THREE.AnimationClip(key, src.duration, tracks);
      this.parts.set(key, c);
    }
    return c;
  }
}

export interface AnimInput {
  /** Ground speed, m/s. */
  speed: number;
  pose: string | null;
  /** Progress through the action, 0..1, and the progress at which its first hit lands. */
  t: number;
  strike: number;
  /** Changes whenever a new action starts, so a repeated swing restarts its clip. */
  actKey: string;
  airborne: boolean;
  stunned: boolean;
  /** Knocked off its feet: curled in the air, then flat on the ground until the stun ends. */
  down: boolean;
  /** Frozen solid: the pose holds where it is. */
  frozen: boolean;
  dead: boolean;
  aiming: boolean;
  /** 1 on the frame a hit lands, decaying. */
  hurt: number;
  armed: boolean;
  kneel: boolean;
}

type Group = 'U' | 'L' | 'F';
interface Layer {
  action: THREE.AnimationAction;
  group: Group;
  w: number;
  target: number;
  rate: number;
}

const HIT = 'Hit_Chest';
const DEATH = 'Death01';
const AIR = 'Jump_Loop';
const LAUNCH = 'Hit_Knockback';
const STUN = 'Idle_Shield_Break';
const KNEEL = 'Crouch_Idle_Loop';

/**
 * Poses one skeleton. Every clip it uses is an action in one mixer whose time and weight are set
 * here each frame (the mixer never advances on its own), then evaluated once. Weights are kept
 * summing to one per body half, or the mixer would blend toward the bind pose.
 */
export class Animator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly layers = new Map<string, Layer>();
  private phase = 0;
  private idleT = 0;
  private deadT = 0;
  private hitT = 9;
  private stunT = 0;
  private lastKey = '';
  private downT = 0;
  private actLayer: Layer | null = null;

  constructor(
    readonly root: THREE.Object3D,
    private readonly lib: ClipLib,
    private readonly set: MoveSet,
    /** Body height over 1.8 m: a bigger body covers more ground per stride. */
    private readonly scale = 1,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    // Fingers are in no clip; hold them in a grip once.
    for (const t of lib.grip?.tracks ?? []) {
      const bone = root.getObjectByName(t.name.split('.')[0]!);
      if (bone) bone.quaternion.fromArray(t.values as unknown as number[], 0);
    }
  }

  private layer(clip: string, group: Group, rate = 8): Layer {
    const key = `${clip}|${group}`;
    let l = this.layers.get(key);
    if (!l) {
      const c = group === 'F' ? this.lib.get(clip) : this.lib.part(clip, group);
      const action = this.mixer.clipAction(c);
      action.play();
      action.weight = 0;
      l = { action, group, w: 0, target: 0, rate };
      this.layers.set(key, l);
    }
    l.rate = rate;
    return l;
  }

  /** Set a layer's time (clamped short of the end, where a looping action would wrap) and target. */
  private drive(l: Layer, time: number, target: number): void {
    const d = l.action.getClip().duration;
    l.action.time = Math.min(Math.max(0, time), Math.max(0, d - 1e-3));
    l.target = Math.max(l.target, target);
  }

  update(s: AnimInput, dt: number): void {
    if (s.frozen && !s.dead) return;
    for (const l of this.layers.values()) l.target = 0;
    const S = this.set;
    this.idleT += dt;

    if (s.dead) {
      this.deadT += dt;
      const l = this.layer(DEATH, 'F', 14);
      this.drive(l, this.deadT, 1);
      this.finish(dt);
      return;
    }
    this.deadT = 0;

    // Action: progress mapped onto the clip so its impact lands on the sim's hit.
    let full = 0;
    let upperOnly = 0;
    if (s.pose) {
      const ref = S.poses?.[s.pose] ?? POSES[s.pose] ?? POSES.slashR!;
      const clip = this.lib.get(ref.clip);
      const from = ref.from ?? 0;
      const to = Math.min(ref.to ?? clip.duration, clip.duration);
      const st = Math.min(0.95, Math.max(0.05, s.strike));
      let time: number;
      if (ref.impact === undefined) time = from + s.t * (to - from);
      else if (s.t < st) time = from + (s.t / st) * (ref.impact - from);
      else time = ref.impact + ((s.t - st) / (1 - st)) * (to - ref.impact);
      const l = this.layer(ref.clip, ref.upper ? 'U' : 'F', 22);
      if (s.actKey !== this.lastKey && this.actLayer === l) l.w = Math.min(l.w, 0.3);
      this.lastKey = s.actKey;
      this.actLayer = l;
      this.drive(l, time, 1);
      if (ref.upper) upperOnly = 1;
      else full = 1;
    } else this.actLayer = null;

    // Knocked down, off the ground, or reeling.
    if (s.down && !full) {
      this.downT = s.airborne ? Math.min(this.downT + dt, 0.14) : this.downT + dt;
      this.drive(this.layer(LAUNCH, 'F', 12), this.downT, 1);
      full = 1;
    } else this.downT = 0;
    if (!full && s.airborne) {
      this.drive(this.layer(AIR, 'F', 10), this.idleT % this.lib.get(AIR).duration, 1);
      full = 1;
    } else if (!full && s.stunned) {
      this.stunT += dt * 0.7;
      this.drive(this.layer(STUN, 'F', 10), this.stunT % this.lib.get(STUN).duration, 1);
      full = 1;
    } else this.stunT = 0;

    // Locomotion: the two clips either side of the speed, with a shared stride phase.
    const sp = s.speed / this.scale;
    const [v0, v1, v2] = S.speeds;
    const w = [0, 0, 0, 0];
    if (sp < 0.25) w[0] = 1;
    else if (sp < v0) (w[1] = sp / v0), (w[0] = 1 - w[1]);
    else if (sp < v1) (w[2] = (sp - v0) / (v1 - v0)), (w[1] = 1 - w[2]);
    else if (sp < v2) (w[3] = (sp - v1) / (v2 - v1)), (w[2] = 1 - w[3]);
    else w[3] = 1;
    const loco = [S.walk, S.jog, S.sprint];
    let rate = 0;
    let wsum = 0;
    for (let i = 0; i < 3; i++) {
      if (!w[i + 1]) continue;
      const d = this.lib.get(loco[i]!).duration;
      rate += (w[i + 1]! * Math.min(1.5, Math.max(0.6, sp / S.speeds[i]!))) / d;
      wsum += w[i + 1]!;
    }
    if (wsum > 0) this.phase = (this.phase + (rate / wsum) * dt) % 1;
    const idle = s.kneel ? KNEEL : s.armed && S.guard ? S.guard : S.idle;
    const idleD = this.lib.get(idle).duration;
    const aim = s.aiming && !s.pose ? 1 : 0;
    for (const g of ['L', 'U'] as const) {
      const rest = 1 - full - (g === 'U' ? Math.max(upperOnly, aim) : 0);
      if (rest <= 0) continue;
      this.drive(this.layer(idle, g), this.idleT % idleD, w[0]! * rest);
      for (let i = 0; i < 3; i++) if (w[i + 1]) this.drive(this.layer(loco[i]!, g), this.phase * this.lib.get(loco[i]!).duration, w[i + 1]! * rest);
    }
    if (aim && !full) this.drive(this.layer(S.aim, 'U'), this.idleT % this.lib.get(S.aim).duration, 1);
    if (s.kneel && !full) this.drive(this.layer(KNEEL, 'L', 6), this.idleT % this.lib.get(KNEEL).duration, 1);

    // A flinch over whatever else is playing.
    if (s.hurt > 0.9 && this.hitT > 0.12) this.hitT = 0;
    this.hitT += dt;
    const hitD = this.lib.get(HIT).duration;
    if (this.hitT < hitD && !full) this.drive(this.layer(HIT, 'U', 30), this.hitT, Math.sin((this.hitT / hitD) * Math.PI) * 0.7);
    this.finish(dt);
  }

  /** Ease weights toward their targets, keep each body half summing to one, then evaluate. */
  private finish(dt: number): void {
    let F = 0;
    const sum = { U: 0, L: 0 };
    for (const l of this.layers.values()) {
      l.w += (l.target - l.w) * Math.min(1, l.rate * dt);
      if (l.w < 1e-3 && l.target === 0) l.w = 0;
      if (l.group === 'F') F += l.w;
      else sum[l.group] += l.w;
    }
    F = Math.min(1, F);
    const scaleF = F > 0 ? Math.min(1, 1 / F) : 1;
    for (const l of this.layers.values()) {
      let w = l.w;
      if (l.group === 'F') w *= scaleF;
      else w = sum[l.group] > 1e-4 ? (w / sum[l.group]) * (1 - F) : 0;
      l.action.weight = w;
      l.action.enabled = w > 1e-3;
    }
    // Nothing on a half yet (the first frame): let the idle carry it.
    for (const g of ['U', 'L'] as const) {
      if (sum[g] > 1e-4 || F >= 1) continue;
      const l = this.layer(this.set.idle, g);
      l.w = l.target = 1 - F;
      l.action.weight = 1 - F;
      l.action.enabled = true;
    }
    this.mixer.update(0);
  }
}
