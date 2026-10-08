import type { AudioEngine } from './engine';

/** What the music is doing: a mood picked from the game state each frame. */
export type Mood = 'silent' | 'title' | 'hub' | 'explore' | 'combat' | 'boss';

type Layer = 'drone' | 'pad' | 'melody' | 'bass' | 'drums';
const LAYERS: Layer[] = ['drone', 'pad', 'melody', 'bass', 'drums'];

/** Layer levels and tempo per mood. Moods crossfade; the beat clock never stops. */
const MIX: Record<Mood, { bpm: number } & Record<Layer, number>> = {
  silent: { bpm: 64, drone: 0, pad: 0, melody: 0, bass: 0, drums: 0 },
  title: { bpm: 60, drone: 0.5, pad: 0.7, melody: 0.5, bass: 0, drums: 0 },
  hub: { bpm: 64, drone: 0.35, pad: 0.6, melody: 0.7, bass: 0, drums: 0 },
  explore: { bpm: 72, drone: 0.6, pad: 0.5, melody: 0.35, bass: 0.15, drums: 0 },
  combat: { bpm: 100, drone: 0.4, pad: 0.35, melody: 0.15, bass: 0.7, drums: 0.7 },
  boss: { bpm: 112, drone: 0.6, pad: 0.4, melody: 0, bass: 0.9, drums: 1 },
};

const ROOT = 73.42; // D2
/** D minor, with the Dorian sixth for the melody: i, VI, III, VII (Dm, Bb, F, C). */
const CHORDS = [
  [0, 3, 7],
  [-4, 0, 3],
  [3, 7, 10],
  [-2, 2, 5],
];
const MELODY = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];
const hz = (semi: number, oct = 0) => ROOT * 2 ** ((semi + oct * 12) / 12);

/**
 * Generated music: a drone, slow chords, a sparse melody over them in peace; a bass ostinato and
 * war drums in a fight, heavier for a boss. A lookahead scheduler places notes on the audio clock,
 * so frame hitches never make it stumble. No audio files ship.
 */
export class Music {
  private gains: Partial<Record<Layer, GainNode>> = {};
  private droneOsc: OscillatorNode[] = [];
  private mood: Mood = 'silent';
  private next = 0;
  private beat = 0;

  constructor(private readonly a: AudioEngine) {}

  private setup(ctx: AudioContext, out: GainNode): void {
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      this.gains[l] = g;
    }
    // The drone: root and fifth, slightly detuned, through a slow low-pass sweep.
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(f.frequency);
    lfo.start();
    for (const [freq, type] of [
      [hz(0), 'sawtooth'],
      [hz(7), 'triangle'],
      [hz(0, -1) * 1.003, 'sine'],
    ] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = type === 'sawtooth' ? 0.05 : 0.12;
      o.connect(g).connect(f);
      o.start();
      this.droneOsc.push(o);
    }
    f.connect(this.gains.drone!);
  }

  /** Call every frame with the mood the game is in. */
  update(mood: Mood): void {
    const ctx = this.a.context;
    const out = this.a.music;
    if (!ctx || !out || ctx.state !== 'running') return;
    if (!this.gains.drone) {
      this.setup(ctx, out);
      this.next = ctx.currentTime + 0.1;
    }
    if (mood !== this.mood) {
      this.mood = mood;
      const mix = MIX[mood];
      for (const l of LAYERS) this.gains[l]!.gain.setTargetAtTime(mix[l], ctx.currentTime, mood === 'boss' || mood === 'combat' ? 0.6 : 2);
    }
    const spb = 60 / MIX[this.mood].bpm;
    while (this.next < ctx.currentTime + 0.25) {
      this.play(ctx, this.next, spb);
      this.next += spb / 2;
      this.beat++;
    }
  }

  /** One eighth note's worth of events. */
  private play(ctx: AudioContext, t: number, spb: number): void {
    const eighth = this.beat % 8;
    const bar = Math.floor(this.beat / 8);
    const chord = CHORDS[bar % CHORDS.length]!;
    const mix = MIX[this.mood];
    if (eighth === 0 && mix.pad > 0) for (const n of chord) this.note(ctx, 'pad', t, hz(n, 1), spb * 4, 'triangle', 0.07, 0.9);
    if (mix.melody > 0 && eighth % 2 === 0 && Math.random() < 0.3) {
      const n = MELODY[Math.floor(Math.random() * MELODY.length)]!;
      this.note(ctx, 'melody', t, hz(n, 2), spb * 2.5, 'sine', 0.06, 0.02);
    }
    if (mix.bass > 0) {
      const root = chord[0]!;
      const pattern = this.mood === 'boss' ? [0, 0, 12, 0, 0, 7, 0, 10] : [0, -1, 0, 12, 0, -1, 7, -1];
      const step = pattern[eighth]!;
      if (step >= 0) this.note(ctx, 'bass', t, hz(root + step, 0), spb * 0.45, 'sawtooth', 0.12, 0.005, 600);
    }
    if (mix.drums > 0) {
      const boss = this.mood === 'boss';
      if (eighth === 0 || eighth === 4 || (boss && eighth === 6)) this.kick(ctx, t);
      if (eighth === 2 || eighth === 6) this.hit(ctx, t, boss ? 180 : 140, 0.18);
      if (boss && bar % 2 === 1 && eighth === 7) this.hit(ctx, t, 2600, 0.12, 'highpass');
    }
  }

  private note(ctx: AudioContext, layer: Layer, t: number, f: number, dur: number, type: OscillatorType, gain: number, attack: number, cutoff = 0): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src: AudioNode = o;
    if (cutoff) {
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = cutoff;
      o.connect(f2);
      src = f2;
    }
    src.connect(env).connect(this.gains[layer]!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(ctx: AudioContext, t: number): void {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(env).connect(this.gains.drums!);
    o.start(t);
    o.stop(t + 0.32);
  }

  private hit(ctx: AudioContext, t: number, f: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    const buf = this.a.noiseBuffer;
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    filt.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(filt).connect(env).connect(this.gains.drums!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.25);
  }
}
