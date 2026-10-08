import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Animator, ClipLib, HERO_MOVES, type AnimInput } from '../../../src/render/anim/animator';

/** A three-bone stand-in for the shared skeleton: pelvis (lower body), spine and right hand (upper). */
function skeleton(): { root: THREE.Object3D; pelvis: THREE.Bone; hand: THREE.Bone } {
  const root = new THREE.Group();
  const pelvis = Object.assign(new THREE.Bone(), { name: 'pelvis' });
  const spine = Object.assign(new THREE.Bone(), { name: 'spine_02' });
  const hand = Object.assign(new THREE.Bone(), { name: 'hand_r' });
  root.add(pelvis);
  pelvis.add(spine);
  spine.add(hand);
  return { root, pelvis, hand };
}

const qx = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a).toArray();

/** A clip that holds both bones at a fixed angle about X. */
function held(name: string, angle: number, duration = 1): THREE.AnimationClip {
  const v = [...qx(angle), ...qx(angle)];
  return new THREE.AnimationClip(name, duration, [new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, duration], v), new THREE.QuaternionKeyframeTrack('hand_r.quaternion', [0, duration], v)]);
}

/** A clip whose hand angle (radians) equals the clip time (seconds), so the pose reads out the time. */
function clock(name: string, duration: number): THREE.AnimationClip {
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (duration * i) / 40;
    times.push(t);
    values.push(...qx(t));
  }
  return new THREE.AnimationClip(name, duration, [new THREE.QuaternionKeyframeTrack('hand_r.quaternion', times, values), new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, duration], [...qx(0.5), ...qx(0.5)])]);
}

const angleX = (b: THREE.Object3D) => 2 * Math.atan2(b.quaternion.x, b.quaternion.w);

const input = (over: Partial<AnimInput> = {}): AnimInput => ({
  speed: 0,
  pose: null,
  t: 0,
  strike: 0.4,
  actKey: '',
  airborne: false,
  stunned: false,
  down: false,
  frozen: false,
  dead: false,
  aiming: false,
  hurt: 0,
  armed: false,
  kneel: false,
  ...over,
});

describe('animator', () => {
  it('pins the clip\'s moment of impact to the tick the sim deals the hit', () => {
    const { root, hand } = skeleton();
    const lib = new ClipLib([held('Idle_Loop', 0.5), clock('Sword_Regular_A', 0.43)]);
    const anim = new Animator(root, lib, HERO_MOVES);
    // Settle the blend at the strike, then read the clip time back out of the hand.
    for (let i = 0; i < 60; i++) anim.update(input({ pose: 'slashR', t: 0.3, strike: 0.3, actKey: 'a' }), 1 / 60);
    expect(angleX(hand)).toBeCloseTo(0.25, 2);
    // Halfway to the strike is halfway to the impact; the end of the action is the end of the clip.
    for (let i = 0; i < 60; i++) anim.update(input({ pose: 'slashR', t: 0.15, strike: 0.3, actKey: 'a' }), 1 / 60);
    expect(angleX(hand)).toBeCloseTo(0.125, 2);
    for (let i = 0; i < 60; i++) anim.update(input({ pose: 'slashR', t: 1, strike: 0.3, actKey: 'a' }), 1 / 60);
    expect(angleX(hand)).toBeCloseTo(0.43, 2);
  });

  it('never lets either half of the body sag toward the bind pose while blending', () => {
    const { root, pelvis, hand } = skeleton();
    // Every clip holds the same pose, so any blend of them must too; a weight sum below one would
    // pull the bones back toward their bind rotation (zero).
    const names = ['Idle_Loop', 'Sword_Idle', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Pistol_Idle_Loop', 'Pistol_Shoot', 'Sword_Regular_A', 'Sword_Regular_B', 'Hit_Chest', 'Death01', 'Jump_Loop', 'Hit_Knockback', 'Idle_Shield_Break', 'Crouch_Idle_Loop', 'Roll'];
    const lib = new ClipLib(names.map((n) => held(n, 0.7)));
    const anim = new Animator(root, lib, HERO_MOVES);
    const script: Partial<AnimInput>[] = [
      {},
      { speed: 1 },
      { speed: 3 },
      { speed: 6.5 },
      { speed: 4, aiming: true },
      { speed: 4, pose: 'shoot', t: 0.2, actKey: 's' },
      { pose: 'slashR', t: 0.1, actKey: 'a' },
      { pose: 'slashL', t: 0.5, actKey: 'b' },
      { speed: 2, hurt: 1 },
      { airborne: true },
      { airborne: true, down: true },
      { down: true },
      { stunned: true },
      { kneel: true },
      { armed: true },
      { dead: true },
    ];
    for (const step of script) {
      for (let i = 0; i < 12; i++) {
        anim.update(input(step), 1 / 60);
        expect(angleX(pelvis)).toBeCloseTo(0.7, 3);
        expect(angleX(hand)).toBeCloseTo(0.7, 3);
      }
    }
  });

  it('holds the pose while frozen', () => {
    const { root, hand } = skeleton();
    const lib = new ClipLib([held('Idle_Loop', 0.2), clock('Sword_Regular_A', 0.43)]);
    const anim = new Animator(root, lib, HERO_MOVES);
    for (let i = 0; i < 60; i++) anim.update(input({ pose: 'slashR', t: 0.3, strike: 0.3, actKey: 'a' }), 1 / 60);
    const before = angleX(hand);
    for (let i = 0; i < 30; i++) anim.update(input({ frozen: true }), 1 / 60);
    expect(angleX(hand)).toBeCloseTo(before, 5);
  });
});
