/* =========================================================
   space-audio — procedural Web Audio "voice" per celestial body.

   No audio files: each body is synthesised (oscillators + filtered
   noise + LFOs) so it ships zero assets and is fully tweakable. One
   master gain feeds the destination; each body has its own gain so the
   sidebar can set per-body volume + on/off, plus a global mute.

   Browsers require a user gesture before audio starts — init()/resume()
   are called from the sidebar's first interaction.
   ========================================================= */

export class SpaceAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bodies = {};      // id -> { gain, enabled, vol }
    this.started = false;
    this.muted = true;
    this.masterVol = 0.6;
  }

  _noiseBuffer() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // brown-ish noise
      d[i] = last * 3.5;
    }
    return buf;
  }

  _bodyGain() {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    return g;
  }

  _osc(type, freq, target, gain = 1) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(target); o.start();
    return { o, g };
  }

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVol;
    this.master.connect(ctx.destination);
    const noise = this._noiseBuffer();

    // ── Sun: low filtered rumble that slowly swells ──
    {
      const g = this._bodyGain();
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180;
      src.connect(lp); lp.connect(g); src.start();
      const lfo = this._osc("sine", 0.08, g.gain, 0.35);   // gentle swell
      this.bodies.sun = { gain: g };
    }
    // ── Galactic core: deep two-tone drone ──
    {
      const g = this._bodyGain();
      this._osc("sine", 56, g, 0.5);
      this._osc("sine", 84, g, 0.28);
      this.bodies.galaxyCore = { gain: g };
    }
    // ── Binary black holes: very deep drone + slow tremolo ──
    {
      const g = this._bodyGain();
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 120;
      lp.connect(g);
      this._osc("sine", 42, lp, 0.6);
      this._osc("sawtooth", 43.5, lp, 0.12);
      this._osc("sine", 0.15, g.gain, 0.4);  // tremolo
      this.bodies.binaryBH = { gain: g };
    }
    // ── Nebula: airy detuned pad ──
    {
      const g = this._bodyGain();
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 320;
      hp.connect(g);
      this._osc("triangle", 220, hp, 0.18);
      this._osc("triangle", 221.5, hp, 0.18);
      this._osc("sine", 330, hp, 0.07);
      this._osc("sine", 0.05, g.gain, 0.5);  // slow swell
      this.bodies.nebula = { gain: g };
    }
    // ── Pulsar: rhythmic blips (carrier gated by a square LFO) ──
    {
      const g = this._bodyGain();
      const gate = ctx.createGain(); gate.gain.value = 0; gate.connect(g);
      this._osc("sine", 680, gate, 0.5);
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 1.6;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(gate.gain); lfo.start();
      const off = ctx.createConstantSource(); off.offset.value = 0.5; off.connect(gate.gain); off.start();
      this.bodies.pulsar = { gain: g, pulseLfo: lfo };
    }
    // ── Fleet: sweeping bandpass noise chatter ──
    {
      const g = this._bodyGain();
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1200; bp.Q.value = 6;
      src.connect(bp); bp.connect(g); src.start();
      this._osc("sawtooth", 0.7, bp.frequency, 600); // sweep the band
      const trem = this._osc("square", 3.2, g.gain, 0.5);
      const off = ctx.createConstantSource(); off.offset.value = 0.5; off.connect(g.gain); off.start();
      this.bodies.fleet = { gain: g };
    }

    this.started = true;
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  setMaster(vol) {
    this.masterVol = vol;
    if (this.master) this._ramp(this.master.gain, this.muted ? 0 : vol);
  }
  setMuted(muted) {
    this.muted = muted;
    if (this.master) this._ramp(this.master.gain, muted ? 0 : this.masterVol);
  }
  /* per-body: gain = (sound && !muted) ? volume : 0 */
  setBody(id, { sound, volume }) {
    const b = this.bodies[id];
    if (!b) return;
    this._ramp(b.gain.gain, sound ? volume : 0);
  }
  /* pulsar blip rate follows its spin slider */
  setPulsarRate(rate) {
    const b = this.bodies.pulsar;
    if (b && b.pulseLfo) b.pulseLfo.frequency.setTargetAtTime(Math.max(0.1, rate), this.ctx.currentTime, 0.1);
  }

  _ramp(param, v) {
    if (!this.ctx) return;
    try { param.setTargetAtTime(v, this.ctx.currentTime, 0.08); } catch { param.value = v; }
  }

  dispose() {
    try { if (this.ctx) this.ctx.close(); } catch {}
    this.ctx = null; this.started = false; this.bodies = {};
  }
}
