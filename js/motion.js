import { calculatePlankPhysics, PLANK_HALF_LENGTH, PLANK_WIDTH } from './physics.js';

// Gameplay assumptions: 90 kg suited walker, Cd*A = 0.7 m², dry shoe grip.
// Walk/run uses traction-limited locomotion. Hyper/Cosmic is powered travel.
export function stepPlankMotion(state, controls, delta) {
  if (!(delta > 0)) return { powered: controls.speed > 12.5, slipping: false };
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const dt = delta / steps;
  const powered = controls.speed > 12.5;
  const norm = Math.max(1, Math.hypot(controls.forward, controls.lateral));
  const targetX = controls.forward / norm * controls.speed;
  const targetZ = controls.lateral / norm * Math.min(controls.speed, 3.5);
  let slipping = false;
  for (let i = 0; i < steps; i++) {
    const p = calculatePlankPhysics(state.worldX);
    const gx = -Math.sign(state.worldX) * p.gPull;
    const normal = p.gNormal + (controls.magBoots ? 20 : 0);
    const staticGrip = p.frictionCoeff * normal;
    const kineticGrip = 0.45 * normal;
    const speed = Math.hypot(state.vx, state.vz);
    const drag = 0.5 * p.airDensity * 0.7 / 90;
    slipping = !powered && p.gPull > staticGrip;
    let ax, az;
    if (powered) {
      // An explicit exploration aid, not human running at orbital speeds.
      // The drive compensates gravity/drag; lateral speed stays human-scale.
      const response = 1 - Math.exp(-8 * dt);
      state.vx += (targetX - state.vx) * response;
      state.vz += (targetZ - state.vz) * response;
    } else {
      if (slipping) {
        // Feet have lost static grip: sliding friction opposes actual motion.
        const sx = speed > 0.001 ? state.vx / speed : Math.sign(gx);
        const sz = speed > 0.001 ? state.vz / speed : 0;
        ax = -sx * kineticGrip;
        az = -sz * kineticGrip;
      } else {
        // A gait controller supplies limited effort; uphill pull reduces speed,
        // downhill pull increases it. No-input braking can hold on gentle slopes.
        ax = controls.forward ? (targetX - state.vx) * 4 : -state.vx / dt - gx;
        az = controls.lateral ? (targetZ - state.vz) * 8 : -state.vz / dt;
        const grip = (!controls.forward && !controls.lateral && speed > 0.01) ? kineticGrip : staticGrip;
        const force = Math.hypot(ax, az);
        if (force > grip) { ax *= grip / force; az *= grip / force; }
      }
      state.vx += (ax + gx) * dt;
      state.vz += az * dt;
      // Exact dissipative drag step avoids overshoot and sign reversal.
      const dragFactor = 1 + drag * Math.hypot(state.vx, state.vz) * dt;
      state.vx /= dragFactor; state.vz /= dragFactor;
      if (Math.abs(state.vx) < 1e-8) state.vx = 0;
      if (Math.abs(state.vz) < 1e-8) state.vz = 0;
    }
    state.worldX += state.vx * dt;
    state.worldZ += state.vz * dt;
    const edge = PLANK_WIDTH / 2 - 0.8;
    // Rails remove outward velocity instead of accumulating a hidden shove.
    if (state.worldZ > edge) { state.worldZ = edge; state.vz = Math.min(0, state.vz); }
    if (state.worldZ < -edge) { state.worldZ = -edge; state.vz = Math.max(0, state.vz); }
    if (state.worldX > PLANK_HALF_LENGTH) { state.worldX = PLANK_HALF_LENGTH; state.vx = Math.min(0,state.vx); }
    if (state.worldX < -PLANK_HALF_LENGTH) { state.worldX = -PLANK_HALF_LENGTH; state.vx = Math.max(0,state.vx); }
  }
  return { powered, slipping };
}
