/**
 * music.js - "Tangent Drift", an original, gently swung soundtrack synthesized live.
 *
 * In the spirit of lazy 90s flight-sim cruising music: a warm electric piano
 * comping major-seventh chords, a soft vibraphone melody with a slow echo,
 * a round bass, airy pads and hushed brushes. Everything is generated with
 * the Web Audio API, so there are no audio files to download.
 *
 * The drums thin out as the air does, and the reverb opens up in space.
 */

const BPM = 84;
const BEAT = 60 / BPM;
const SWING = 0.16; // offbeat eighths land a little late

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// 16-bar form. voicing: electric piano, bass: root note.
const CHORDS = [
  { name: 'Fmaj9', voicing: [57, 60, 64, 67], bass: 41, fifth: 48 },
  { name: 'Bbmaj9', voicing: [57, 60, 62, 65], bass: 46, fifth: 41 },
  { name: 'Am7', voicing: [55, 60, 64, 69], bass: 45, fifth: 40 },
  { name: 'Dm9', voicing: [57, 60, 64, 65], bass: 38, fifth: 45 },
  { name: 'Gm9', voicing: [57, 58, 62, 65], bass: 43, fifth: 38 },
  { name: 'C9sus4', voicing: [55, 58, 62, 65], bass: 36, fifth: 43 },
  { name: 'Fmaj9', voicing: [57, 60, 64, 67], bass: 41, fifth: 48 },
  { name: 'C13sus', voicing: [57, 58, 62, 65], bass: 36, fifth: 43 },
  { name: 'Bbmaj9', voicing: [57, 60, 62, 65], bass: 46, fifth: 41 },
  { name: 'Bbm6', voicing: [56, 58, 61, 67], bass: 46, fifth: 41 },
  { name: 'Am7', voicing: [55, 60, 64, 69], bass: 45, fifth: 40 },
  { name: 'D9', voicing: [54, 57, 60, 64], bass: 38, fifth: 45 },
  { name: 'Gm9', voicing: [57, 58, 62, 65], bass: 43, fifth: 38 },
  { name: 'C9sus4', voicing: [55, 58, 62, 65], bass: 36, fifth: 43 },
  { name: 'Fmaj9', voicing: [57, 60, 64, 67], bass: 41, fifth: 48 },
  { name: 'Fmaj9', voicing: [57, 60, 64, 67], bass: 41, fifth: 48 }
];

// Original melody: [bar, beat, length in beats, midi note].
const MELODY = [
  [0, 1.5, 0.5, 72], [0, 2, 1, 76], [0, 3, 1.5, 79],
  [1, 0.5, 0.5, 77], [1, 1, 1, 74], [1, 2, 2, 72],
  [2, 1, 0.5, 76], [2, 1.5, 0.5, 79], [2, 2, 1.5, 81], [2, 3.5, 0.5, 79],
  [3, 0, 1.5, 76], [3, 1.5, 0.5, 74], [3, 2, 2, 69],
  [4, 0.5, 0.5, 70], [4, 1, 0.5, 74], [4, 1.5, 1, 77], [4, 2.5, 1.5, 81],
  [5, 0, 1, 79], [5, 1, 0.5, 77], [5, 1.5, 1, 74], [5, 2.5, 1.5, 72],
  [6, 0, 1, 69], [6, 1, 0.5, 72], [6, 1.5, 1, 76], [6, 2.5, 0.5, 79], [6, 3, 1, 76],
  [7, 0, 2, 74],
  [8, 0.5, 0.5, 81], [8, 1, 1, 84], [8, 2, 0.5, 81], [8, 2.5, 1.5, 77],
  [9, 0, 1, 79], [9, 1, 0.5, 77], [9, 1.5, 1.5, 73], [9, 3, 1, 70],
  [10, 0, 1.5, 72], [10, 1.5, 0.5, 76], [10, 2, 2, 79],
  [11, 0, 1, 78], [11, 1, 0.5, 76], [11, 1.5, 0.5, 72], [11, 2, 2, 69],
  [12, 0.5, 0.5, 74], [12, 1, 0.5, 77], [12, 1.5, 1, 81], [12, 2.5, 0.5, 82], [12, 3, 1, 81],
  [13, 0, 1.5, 79], [13, 1.5, 0.5, 77], [13, 2, 1, 74], [13, 3, 1, 72],
  [14, 0, 3, 76],
  [15, 2, 0.5, 72], [15, 2.5, 0.5, 74], [15, 3, 1, 76]
];

// Electric-piano comping patterns: [beat, length].
const COMPS = [
  [[0, 1.5], [2.5, 1.5]],
  [[0, 0.5], [1.5, 2]],
  [[0.5, 1], [2, 0.5], [3.5, 0.5]],
  [[0, 2.5], [3, 1]]
];

export class Music {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.enabled = true;
    this.playing = false;
    this.air = 1;
    let seed = 7;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);

    // Gentle glue compression keeps the mix even at low volume.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 2.5; comp.attack.value = 0.02; comp.release.value = 0.3;
    comp.connect(this.output);
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.9;
    this.mix.connect(comp);

    // Plate-like reverb from a generated impulse response.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.mix);

    // Tempo-synced echo for the melody (dotted eighth).
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = BEAT * 0.75;
    const feedback = ctx.createGain(); feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    this.delay.connect(tone); tone.connect(feedback); feedback.connect(this.delay);
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 0.28;
    this.delaySend.connect(this.delay);
    const delayOut = ctx.createGain(); delayOut.gain.value = 0.6;
    tone.connect(delayOut); delayOut.connect(this.mix); delayOut.connect(this.reverbSend);

    // Instrument buses.
    this.keys = this.bus(0.6, 0.35, { tremolo: true, lowpass: 3800 });
    this.pad = this.bus(0.35, 0.6, { lowpass: 1400 });
    this.bassBus = this.bus(0.2, 0.05, { lowpass: 700 });
    this.lead = this.bus(1.3, 0.4, { lowpass: 6000 });
    this.lead.connect(this.delaySend);
    this.drums = this.bus(0.75, 0.15, {});

    this.noise = this.noiseBuffer();
    this.step = 0; // eighth-note index
    this.chorus = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  bus(level, send, { tremolo = false, lowpass = 0 } = {}) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = level;
    let node = input;
    if (lowpass) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = 0.5;
      node.connect(f); node = f;
    }
    if (tremolo && ctx.createStereoPanner) {
      // Suitcase-piano style auto-pan.
      const pan = ctx.createStereoPanner();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 3.2;
      const depth = ctx.createGain(); depth.gain.value = 0.45;
      lfo.connect(depth); depth.connect(pan.pan); lfo.start();
      node.connect(pan); node = pan;
    }
    node.connect(this.mix);
    const sendGain = ctx.createGain(); sendGain.gain.value = send;
    node.connect(sendGain); sendGain.connect(this.reverbSend);
    return input;
  }

  impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Darkening tail: high frequencies decay faster than lows.
        const k = 0.35 + 0.6 * t;
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        data[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    return buffer;
  }

  noiseBuffer() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // ---------- Instruments ----------
  electricPiano(midi, time, length, velocity) {
    const ctx = this.ctx, f = mtof(midi);
    const carrier = ctx.createOscillator(); carrier.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 1.6 * velocity, time);
    modGain.gain.exponentialRampToValueAtTime(f * 0.18, time + 0.9);
    mod.connect(modGain); modGain.connect(carrier.frequency);
    // Bell-like "tine" on the attack.
    const tine = ctx.createOscillator(); tine.frequency.value = f * 7.02;
    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(0.05 * velocity, time);
    tineGain.gain.exponentialRampToValueAtTime(0.0005, time + 0.25);
    const amp = ctx.createGain();
    const end = time + length;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.16 * velocity, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.07 * velocity, time + 0.8);
    amp.gain.setTargetAtTime(0.0001, end, 0.18);
    carrier.connect(amp); tine.connect(tineGain); tineGain.connect(amp);
    amp.connect(this.keys);
    for (const o of [carrier, mod, tine]) { o.start(time); o.stop(end + 1.2); }
  }

  padChord(voicing, time, length) {
    const ctx = this.ctx;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(0.05, time + length * 0.4);
    amp.gain.linearRampToValueAtTime(0.0001, time + length + 0.8);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.3;
    filter.frequency.setValueAtTime(500, time);
    filter.frequency.linearRampToValueAtTime(1300, time + length * 0.6);
    filter.frequency.linearRampToValueAtTime(600, time + length + 0.8);
    filter.connect(amp); amp.connect(this.pad);
    for (const m of voicing) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(m + 12); o.detune.value = detune;
        o.connect(filter); o.start(time); o.stop(time + length + 1);
      }
    }
  }

  bass(midi, time, length, velocity = 1) {
    const ctx = this.ctx, f = mtof(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.5 * velocity, time + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.22 * velocity, time + 0.4);
    amp.gain.setTargetAtTime(0.0001, time + length * 0.92, 0.06);
    const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = f;
    const b = ctx.createOscillator(); b.frequency.value = f;
    const bg = ctx.createGain(); bg.gain.value = 0.7;
    a.connect(amp); b.connect(bg); bg.connect(amp); amp.connect(this.bassBus);
    for (const o of [a, b]) { o.start(time); o.stop(time + length + 0.5); }
  }

  vibes(midi, time, length, velocity = 1) {
    const ctx = this.ctx, f = mtof(midi);
    const amp = ctx.createGain();
    const ring = Math.max(1.4, length * BEAT + 0.8);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.2 * velocity, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + ring);
    // Slow motor tremolo on the resonators.
    const trem = ctx.createGain(); trem.gain.value = 0.85;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6;
    const depth = ctx.createGain(); depth.gain.value = 0.15;
    lfo.connect(depth); depth.connect(trem.gain);
    const fundamental = ctx.createOscillator(); fundamental.frequency.value = f;
    const overtone = ctx.createOscillator(); overtone.frequency.value = f * 3.98;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.28, time); og.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    fundamental.connect(trem); overtone.connect(og); og.connect(trem);
    trem.connect(amp); amp.connect(this.lead);
    for (const o of [fundamental, overtone, lfo]) { o.start(time); o.stop(time + ring + 0.1); }
  }

  noiseHit(time, { type = 'bandpass', freq = 4000, q = 0.8, gain = 0.1, decay = 0.1, attack = 0.002 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + this.random() * 0.4;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(gain, time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    src.connect(filter); filter.connect(amp); amp.connect(this.drums);
    src.start(time, this.random() * 0.5); src.stop(time + attack + decay + 0.05);
  }

  kick(time, gain = 0.35) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, time);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
    o.connect(amp); amp.connect(this.drums);
    o.start(time); o.stop(time + 0.4);
  }

  // ---------- Sequencer ----------
  scheduleStep(step, time) {
    const bar = Math.floor(step / 8) % CHORDS.length;
    const eighth = step % 8;
    const beat = eighth / 2;
    const chord = CHORDS[bar];
    const next = CHORDS[(bar + 1) % CHORDS.length];
    const swing = eighth % 2 ? SWING * BEAT : 0;
    const at = time + swing;
    const air = this.air;

    if (eighth === 0) {
      this.padChord(chord.voicing, time, BEAT * 4);
      this.comp = COMPS[Math.floor(this.random() * COMPS.length)];
    }
    // Electric piano comping, lightly humanized.
    for (const [b, len] of this.comp || []) {
      if (Math.abs(b - beat) < 0.01) {
        chord.voicing.forEach((m, i) => this.electricPiano(m, at + i * 0.008 + this.random() * 0.006, len * BEAT, 0.7 + this.random() * 0.25));
      }
    }
    // Bass: roots and fifths with a chromatic approach into the next bar.
    if (eighth === 0) this.bass(chord.bass, at, BEAT * 1.4);
    if (eighth === 3) this.bass(chord.fifth, at, BEAT * 0.5, 0.7);
    if (eighth === 4) this.bass(this.random() < 0.5 ? chord.bass + 12 : chord.fifth, at, BEAT * 1.2, 0.85);
    if (eighth === 7) {
      const target = next.bass;
      this.bass(target + (target > chord.bass ? -1 : 1), at, BEAT * 0.45, 0.6);
    }
    // Melody on alternate choruses; the other chorus leaves space for the keys.
    const withMelody = this.chorus % 2 === 0;
    if (withMelody) {
      for (const [mb, mbeat, len, note] of MELODY) {
        if (mb === bar && Math.abs(mbeat - beat) < 0.01) {
          // Every other melodic chorus drops an octave for a mellower variation.
          const shift = this.chorus % 4 === 2 ? -12 : 0;
          this.vibes(note + shift, at + this.random() * 0.01, len, 0.8 + this.random() * 0.2);
        }
      }
    } else if (eighth % 2 === 1 && this.random() < 0.18) {
      // Sparse improvised vibes fills from the chord.
      const note = chord.voicing[Math.floor(this.random() * chord.voicing.length)] + 12;
      this.vibes(note, at, 1, 0.5);
    }
    // Brushes: a soft swish on 2 and 4, feathered kick, ride taps.
    if (air > 0.02) {
      if (eighth === 2 || eighth === 6) this.noiseHit(at, { freq: 2600, q: 0.6, gain: 0.16 * air, decay: 0.22, attack: 0.03 });
      if (eighth === 0 || (eighth === 5 && this.random() < 0.4)) this.kick(at, 0.22 * air);
      this.noiseHit(at, { type: 'highpass', freq: 7000, q: 0.3, gain: (eighth % 2 ? 0.035 : 0.055) * air, decay: 0.06 });
    }
    if (eighth === 7 && bar === CHORDS.length - 1) this.chorus++;
  }

  schedule() {
    const ahead = this.ctx.currentTime + 0.25;
    while (this.nextTime < ahead) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += BEAT / 2;
      this.step++;
    }
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
    this.schedule();
    this.applyLevel(2.5);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  applyLevel(fade = 0.6) {
    const target = this.enabled ? 0.8 : 0.0001;
    const now = this.ctx.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(Math.max(0.0001, this.output.gain.value), now);
    this.output.gain.linearRampToValueAtTime(target, now + fade);
    if (!this.enabled) setTimeout(() => { if (!this.enabled) this.stop(); }, fade * 1000 + 50);
    else if (!this.playing) this.start();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.applyLevel();
  }

  /** air: 1 at sea level, 0 in vacuum. Drums fade and the room opens up in space. */
  update(air) {
    this.air += (air - this.air) * 0.05;
    const now = this.ctx.currentTime;
    this.reverbSend.gain.setTargetAtTime(0.32 + (1 - this.air) * 0.3, now, 0.5);
  }
}
