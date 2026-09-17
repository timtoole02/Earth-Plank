/**
 * hud.js - Live telemetry HUD, vector inclinometer canvas, controls, and explanation drawer
 */
import { WAYPOINTS, calculatePlankPhysics } from './physics.js';
import { CAMERA_MODES } from './player.js';

export class HUD {
  constructor(player, soundSystem) {
    this.player = player;
    this.soundSystem = soundSystem;

    // DOM Elements
    this.distanceEl = document.getElementById('val-distance');
    this.altitudeEl = document.getElementById('val-altitude');
    this.speedEl = document.getElementById('val-speed');
    this.slopeDegEl = document.getElementById('val-slope-deg');
    this.slopeGradeEl = document.getElementById('val-slope-grade');
    this.gTotalEl = document.getElementById('val-g-total');
    this.gNormEl = document.getElementById('val-g-norm');
    this.gPullEl = document.getElementById('val-g-pull');
    this.pressureEl = document.getElementById('val-pressure');
    this.temperatureEl = document.getElementById('val-temperature');
    this.statusBadgeEl = document.getElementById('badge-status');
    this.statusDetailEl = document.getElementById('status-detail');

    this.inclinometerCanvas = document.getElementById('canvas-inclinometer');
    this.inclinometerCtx = this.inclinometerCanvas ? this.inclinometerCanvas.getContext('2d') : null;

    this.setupControls();
    this.setupWaypoints();
  }

  setupControls() {
    // Camera perspective buttons
    const btnGrav = document.getElementById('btn-cam-grav');
    const btnPlank = document.getElementById('btn-cam-plank');
    const btnThird = document.getElementById('btn-cam-third');
    const btnOrbit = document.getElementById('btn-cam-orbit');

    const updateActiveCamBtn = (mode) => {
      [btnGrav, btnPlank, btnThird, btnOrbit].forEach(b => b && b.classList.remove('active'));
      if (mode === CAMERA_MODES.GRAVITY_ALIGNED && btnGrav) btnGrav.classList.add('active');
      if (mode === CAMERA_MODES.PLANK_ALIGNED && btnPlank) btnPlank.classList.add('active');
      if (mode === CAMERA_MODES.THIRD_PERSON && btnThird) btnThird.classList.add('active');
      if (mode === CAMERA_MODES.MACRO_ORBIT && btnOrbit) btnOrbit.classList.add('active');
    };

    if (btnGrav) btnGrav.addEventListener('click', () => { this.player.setCameraMode(CAMERA_MODES.GRAVITY_ALIGNED); updateActiveCamBtn(CAMERA_MODES.GRAVITY_ALIGNED); });
    if (btnPlank) btnPlank.addEventListener('click', () => { this.player.setCameraMode(CAMERA_MODES.PLANK_ALIGNED); updateActiveCamBtn(CAMERA_MODES.PLANK_ALIGNED); });
    if (btnThird) btnThird.addEventListener('click', () => { this.player.setCameraMode(CAMERA_MODES.THIRD_PERSON); updateActiveCamBtn(CAMERA_MODES.THIRD_PERSON); });
    if (btnOrbit) btnOrbit.addEventListener('click', () => { this.player.setCameraMode(CAMERA_MODES.MACRO_ORBIT); updateActiveCamBtn(CAMERA_MODES.MACRO_ORBIT); });

    // Speed buttons
    const speedButtons = document.querySelectorAll('.btn-speed');
    speedButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mult = parseFloat(btn.dataset.mult);
        this.player.setSpeedMultiplier(mult);
        const slider = document.getElementById('speed-slider');
        if (slider) slider.value = Math.log10(mult);
      });
    });

    // Speed logarithmic slider
    const speedSlider = document.getElementById('speed-slider');
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const mult = Math.pow(10, val);
        this.player.setSpeedMultiplier(mult);
        speedButtons.forEach(b => b.classList.remove('active'));
      });
    }

    // Autopilot run toggle
    const btnAuto = document.getElementById('btn-autopilot');
    if (btnAuto) {
      btnAuto.addEventListener('click', () => {
        const active = this.player.toggleAutopilot();
        btnAuto.textContent = active ? '⏸ PAUSE RUN' : '▶ AUTO RUN';
        btnAuto.classList.toggle('active', active);
      });
    }

    // Mag-boots grip toggle
    const btnMag = document.getElementById('btn-mag-boots');
    if (btnMag) {
      btnMag.addEventListener('click', () => {
        this.player.magBootsEnabled = !this.player.magBootsEnabled;
        btnMag.textContent = this.player.magBootsEnabled ? '🧲 MAG-BOOTS: ON' : '🧲 MAG-BOOTS: OFF (REAL SLIP)';
        btnMag.classList.toggle('off', !this.player.magBootsEnabled);
      });
    }

    // Audio mute button
    const btnAudio = document.getElementById('btn-audio');
    if (btnAudio) {
      btnAudio.addEventListener('click', () => {
        this.soundSystem.init();
        const muted = this.soundSystem.toggleMute();
        btnAudio.textContent = muted ? '🔇 SOUND OFF' : '🔊 SOUND ON';
        btnAudio.classList.toggle('off', muted);
      });
    }

    // Guide Drawer Toggle
    const btnGuide = document.getElementById('btn-guide');
    const drawer = document.getElementById('guide-drawer');
    const btnCloseGuide = document.getElementById('btn-close-guide');
    if (btnGuide && drawer) {
      btnGuide.addEventListener('click', () => drawer.classList.toggle('open'));
    }
    if (btnCloseGuide && drawer) {
      btnCloseGuide.addEventListener('click', () => drawer.classList.remove('open'));
    }

    this.updateActiveCamBtn = updateActiveCamBtn;
    document.getElementById('look-sensitivity')?.addEventListener('input', e => {
      this.player.mouseSensitivity = Number(e.target.value) / 1000;
    });
    // Synchronize initial camera active button
    updateActiveCamBtn(this.player.cameraMode);
  }

  setupWaypoints() {
    const select = document.getElementById('select-waypoint');
    if (!select) return;

    select.innerHTML = '';
    WAYPOINTS.forEach((wp) => {
      const opt = document.createElement('option');
      opt.value = wp.distKm;
      opt.textContent = `${wp.name} (${wp.distKm.toLocaleString()} km)`;
      select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
      const km = parseFloat(e.target.value);
      this.player.teleportToKm(km);
    });
  }

  drawInclinometer(thetaRad, gNorm, gPull, gTotal) {
    if (!this.inclinometerCtx) return;
    const ctx = this.inclinometerCtx;
    const w = this.inclinometerCanvas.width;
    const h = this.inclinometerCanvas.height;
    const cx = w / 2;
    const cy = h / 2 - 10;
    const radius = 55;

    ctx.clearRect(0, 0, w, h);

    // Outer dial circle
    ctx.strokeStyle = '#27384e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Plank surface reference (horizontal line)
    ctx.strokeStyle = '#4e6a8e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - radius + 10, cy);
    ctx.lineTo(cx + radius - 10, cy);
    ctx.stroke();

    // Plank label
    ctx.fillStyle = '#6f8ba4';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PLANK SURFACE', cx, cy - 8);

    // Gravity vector arrow (angles downward and backward by theta)
    // In canvas: forward is +X (right), backward is -X (left), down is +Y
    const dirX = -Math.sin(thetaRad); // backward
    const dirY = Math.cos(thetaRad);  // downward
    const arrowLen = radius * 0.82;

    const tipX = cx + dirX * arrowLen;
    const tipY = cy + dirY * arrowLen;

    // Draw gravity vector line
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(tipY - cy, tipX - cx);
    const headLen = 8;
    ctx.fillStyle = '#ff0055';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6), tipY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6), tipY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();

    // Gravity vector text
    ctx.fillStyle = '#ff5588';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`GRAVITY VECTOR (Tilt: ${(thetaRad * 180 / Math.PI).toFixed(1)}°)`, cx, h - 8);
  }

  update() {
    this.updateActiveCamBtn(this.player.cameraMode);
    document.body.classList.toggle('mouse-locked', !this.player.paused);
    const hint = document.getElementById('instructions-hint');
    hint.textContent = this.player.cameraMode === CAMERA_MODES.MACRO_ORBIT
      ? 'ORBIT VIEW · Drag to rotate · Scroll to zoom · 1–3 return to deck'
      : !this.player.paused
        ? 'W/S along plank · A/D change lane · Drag to look · Esc / P pause'
        : 'PAUSED · Click scene to move · Drag to look · Esc / P pause';
    const auto = document.getElementById('btn-autopilot');
    auto.textContent = this.player.isAutopilot ? '⏸ STOP CRUISE' : '▶ AUTO RUN';
    auto.classList.toggle('active', this.player.isAutopilot);
    const physics = calculatePlankPhysics(this.player.worldX);
    const speed = Math.sqrt(this.player.vx * this.player.vx + this.player.vz * this.player.vz);

    // Distance display
    if (this.distanceEl) {
      if (physics.absX < 10000) {
        this.distanceEl.textContent = `${physics.absX.toFixed(0)} m`;
      } else {
        this.distanceEl.textContent = `${(physics.absX / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
      }
    }

    // Altitude display
    if (this.altitudeEl) {
      if (physics.altitude < 10000) {
        this.altitudeEl.textContent = `${physics.altitude.toFixed(0)} m`;
      } else {
        this.altitudeEl.textContent = `${(physics.altitude / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
      }
    }

    // Speed display
    if (this.speedEl) {
      const kmh = speed * 3.6;
      if (speed < 100) {
        this.speedEl.textContent = `${speed.toFixed(1)} m/s (${kmh.toFixed(0)} km/h)`;
      } else {
        this.speedEl.textContent = `${(speed / 1000).toFixed(1)} km/s (${(kmh / 1000).toFixed(0)}k km/h)`;
      }
    }

    // Slope angle & Grade
    if (this.slopeDegEl) this.slopeDegEl.textContent = `${physics.thetaDeg.toFixed(2)}°`;
    if (this.slopeGradeEl) this.slopeGradeEl.textContent = `${physics.slopePercent.toFixed(1)}%`;

    // Gravity metrics
    if (this.gTotalEl) this.gTotalEl.textContent = `${physics.gTotal.toFixed(2)} m/s² (${(physics.gTotal / 9.80665).toFixed(2)} g)`;
    if (this.gNormEl) this.gNormEl.textContent = `${physics.gNormal.toFixed(2)} m/s²`;
    if (this.gPullEl) this.gPullEl.textContent = `${physics.gPull.toFixed(2)} m/s²`;

    // Atmospheric pressure
    if (this.pressureEl) {
      if (physics.pressureKPa > 0.1) {
        this.pressureEl.textContent = `${physics.pressureKPa.toFixed(1)} kPa (${(physics.airDensityRatio * 100).toFixed(0)}% air)`;
      } else {
        this.pressureEl.textContent = `0.00 kPa (VACUUM)`;
      }
    }

    if (this.temperatureEl) {
      const c = physics.temperatureC;
      this.temperatureEl.textContent = c === null
        ? (physics.thermalLabel === 'VACUUM' ? 'No air temperature' : 'Above model range')
        : `${c.toFixed(1)} °C / ${(c * 1.8 + 32).toFixed(1)} °F`;
      this.temperatureEl.title = c === null
        ? 'A surface or suit temperature in space depends on sunlight, shade and thermal properties. This is not a suit-temperature simulation.'
        : 'Standard-atmosphere air temperature at your current altitude; not live weather or suit temperature.';
    }
    const powered = this.player.baseSpeed * this.player.speedMultiplier * (this.player.keys.sprint ? 2.5 : 1) > 12.5;
    document.getElementById('val-motion-mode').textContent = powered ? 'Powered travel assist' : this.player.magBootsEnabled ? 'Walking + mag-boots' : 'Walking / shoe grip';
    document.getElementById('val-travel-direction').textContent = Math.abs(this.player.vx) < 0.02 ? 'Stationary' : this.player.vx * this.player.worldX > 0 ? 'Away from anchor ↑' : 'Toward anchor ↓';
    const lane = this.player.worldZ;
    document.getElementById('val-lane').textContent = Math.abs(lane) < 0.05 ? 'Center' : `${Math.abs(lane).toFixed(1)} m ${lane > 0 ? 'right' : 'left'}`;
    let status = physics.statusText, detail = physics.statusDetail, color = physics.statusColor;
    if (powered) {
      status = 'POWERED TRAVEL ASSIST'; color = '#a7d2e3';
      detail = 'Exploration drive compensates gravity and drag. Choose Walk or Run for unassisted motion.';
    } else if (physics.isSlipping && this.player.magBootsEnabled) {
      status = 'MAG-BOOTS: GRIP ASSIST'; color = '#a7d2e3';
      detail = 'Magnetic adhesion increases traction. Gravity still pulls toward the anchor.';
    } else if (!this.player.paused && this.player.motionState.slipping) {
      status = 'SLIDING · SHOE GRIP LOST'; color = '#ff8888';
      detail = 'Gravity exceeds shoe traction; sliding friction opposes your motion.';
    }
    // Status badge
    if (this.statusBadgeEl) {
      this.statusBadgeEl.textContent = status;
      this.statusBadgeEl.style.backgroundColor = `${color}22`;
      this.statusBadgeEl.style.color = color;
      this.statusBadgeEl.style.borderColor = color;
    }

    if (this.statusDetailEl) {
      this.statusDetailEl.textContent = detail;
    }

    // Update inclinometer canvas
    this.drawInclinometer(physics.thetaRad * Math.sign(this.player.worldX), physics.gNormal, physics.gPull, physics.gTotal);
  }
}
