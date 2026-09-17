/**
 * audio.js - Web Audio API procedural synthesizer for footstep, wind, and space ambience
 */

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isInitialized = false;

    // Wind synthesizer nodes
    this.windGain = null;
    this.windFilter = null;

    // Thruster hum nodes
    this.thrusterGain = null;
    this.thrusterOsc = null;

    // Footstep timer
    this.lastStepTime = 0;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // 1. Procedural Wind generator (filtered white noise)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 400;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.0;

      whiteNoise.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.ctx.destination);
      whiteNoise.start();

      // 2. Thruster Hum generator
      this.thrusterOsc = this.ctx.createOscillator();
      this.thrusterOsc.type = 'sawtooth';
      this.thrusterOsc.frequency.value = 65; // low sci-fi rumble

      const thrusterFilter = this.ctx.createBiquadFilter();
      thrusterFilter.type = 'lowpass';
      thrusterFilter.frequency.value = 120;

      this.thrusterGain = this.ctx.createGain();
      this.thrusterGain.gain.value = 0.0;

      this.thrusterOsc.connect(thrusterFilter);
      thrusterFilter.connect(this.thrusterGain);
      this.thrusterGain.connect(this.ctx.destination);
      this.thrusterOsc.start();

      this.isInitialized = true;
    } catch (err) {
      console.warn('Web Audio API not supported or blocked:', err);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.ctx && this.isMuted) {
      if (this.windGain) this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      if (this.thrusterGain) this.thrusterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    return this.isMuted;
  }

  playFootstep(speedFactor = 1.0) {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStepTime < 0.25 / Math.min(speedFactor, 3)) return;
    this.lastStepTime = now;

    // Crisp metallic footstep tap
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.06);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.07);
  }

  update(speed, airDensityRatio, isMoving) {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;

    const now = this.ctx.currentTime;

    // Wind Sound: scales with speed * air density!
    // In space (airDensityRatio = 0), wind sound drops to absolute ZERO!
    const targetWindVol = Math.min(0.35, (speed / 100) * airDensityRatio * 0.35);
    const targetFilterFreq = 200 + Math.min(2000, speed * 15 * airDensityRatio);

    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(targetWindVol, now, 0.1);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(targetFilterFreq, now, 0.1);
    }

    // Thruster Hum: audible when speed > 50 m/s
    const targetThrusterVol = speed > 50 ? Math.min(0.25, (speed / 2000) * 0.25) : 0;
    if (this.thrusterGain) {
      this.thrusterGain.gain.setTargetAtTime(targetThrusterVol, now, 0.1);
    }

    // Trigger footstep when moving on foot at normal speeds
    if (isMoving && speed > 0.5 && speed < 50) {
      this.playFootstep(speed / 5.0);
    }
  }
}
