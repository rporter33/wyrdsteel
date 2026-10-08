/**
 * Every sound is synthesized: oscillators, filtered noise and envelopes. No audio files ship.
 * Voices are capped and each sound has a cooldown, so a forty-enemy brawl can't turn to mush.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Music has its own level under the master volume. */
  music: GainNode | null = null;
  musicLevel = 0.5;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private last = new Map<string, number>();
  volume = 0.7;
  muted = false;

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.musicLevel;
    this.music.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number, music = this.musicLevel): void {
    this.volume = v;
    this.musicLevel = music;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
    if (this.music) this.music.gain.value = music;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  /** Gate a sound by name: at most one per `gapMs`, and never past the voice cap. */
  gate(name: string, gapMs: number): boolean {
    if (!this.ready || this.voices >= 24) return false;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < gapMs) return false;
    this.last.set(name, now);
    return true;
  }

  private out(pan: number, gain: number): { node: GainNode; t: number; ctx: AudioContext } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master!);
    this.voices++;
    setTimeout(() => {
      this.voices--;
      g.disconnect();
    }, 1500);
    return { node: g, t: ctx.currentTime, ctx };
  }

  tone(opts: { type?: OscillatorType; f0: number; f1?: number; dur: number; gain?: number; pan?: number; attack?: number; delay?: number }): void {
    if (!this.ready) return;
    const { node, t: now, ctx } = this.out(opts.pan ?? 0, 1);
    const t = now + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + (opts.attack ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(env).connect(node);
    o.start(t);
    o.stop(t + opts.dur + 0.02);
  }

  noiseBurst(opts: { dur: number; gain?: number; f0: number; f1?: number; q?: number; type?: BiquadFilterType; pan?: number; delay?: number }): void {
    if (!this.ready || !this.noise) return;
    const { node, t: now, ctx } = this.out(opts.pan ?? 0, 1);
    const t = now + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + opts.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(opts.gain ?? 0.3, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(env).connect(node);
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.dur + 0.02);
  }
}
