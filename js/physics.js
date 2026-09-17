/**
 * physics.js - Exact spherical Earth physics & tangent plank mechanics
 */

export const EARTH_RADIUS = 6371000; // Earth radius in meters (6,371 km)
export const G0 = 9.80665;          // Standard gravity at surface (m/s^2)
export const PLANK_HALF_LENGTH = 25000000; // 25,000 km in each direction (50,000 km total)
export const PLANK_WIDTH = 30;       // 30 meters wide
export const SCALE_HEIGHT = 8500;    // Atmosphere scale height (8.5 km)
export const SEA_LEVEL_PRESSURE = 101.325; // kPa

export const WAYPOINTS = [
  { id: 'center', name: 'Center Touchpoint', distKm: 0, desc: 'Sea level, 0° slope, perfect 1.0g perpendicular gravity.' },
  { id: 'city', name: 'City Distant (100 km)', distKm: 100, desc: 'Altitude 785 m, 0.9° slope. Slight upward grade.' },
  { id: 'clouds', name: 'Inside the Clouds', distKm: Math.round(Math.sqrt(1550 * (2 * EARTH_RADIUS + 1550)) / 100) / 10, desc: 'Cloud layer at about 1.55 km altitude. Walk through drifting mist.' },
  { id: 'everest', name: 'Everest Death Zone (336 km)', distKm: 336, desc: 'Altitude 8,849 m. Oxygen depleted. 3.0° slope.' },
  { id: 'karman', name: 'Kármán Line / Space Edge (1,133 km)', distKm: 1133, desc: 'Altitude 100 km. Entering vacuum of space. 10.1° slope (17.8% grade).' },
  { id: 'iss', name: 'ISS Orbital Altitude (2,295 km)', distKm: 2295, desc: 'Altitude 400 km. 19.8° slope. Looking down at Earth from orbit.' },
  { id: 'friction', name: 'Shoe Friction Failure (3,678 km)', distKm: 3678, desc: 'Altitude 985 km. 30.0° slope! Backward pull exceeds shoe friction (tan 30° > 0.58). Slipping down!' },
  { id: 'wall45', name: 'The 45° Cliff (6,371 km)', distKm: 6371, desc: '1 Earth Radius out! Altitude 2,639 km. 45.0° slope. Halfway to a sheer vertical wall.' },
  { id: 'space', name: 'Deep Space Terminal (15,000 km)', distKm: 15000, desc: 'Altitude 10,000 km. 67.0° sheer cliff. Earth is a distant blue marble below.' }
];

// Layered standard atmosphere (geopotential heights, SI units).
// NASA/TM—2005-213659, standard lapse-rate table. Temperature is not weather.
export function atmosphereAtAltitude(altitude) {
  const h = EARTH_RADIUS * Math.max(0, altitude) / (EARTH_RADIUS + Math.max(0, altitude));
  const layers = [[0,-0.0065],[11000,0],[20000,0.001],[32000,0.0028],[47000,0],[51000,-0.0028],[71000,-0.002],[84852,0]];
  const gasConstant = 287.05287;
  let temperature = 288.15, pressure = 101325;
  for (let i = 0; i < layers.length - 1; i++) {
    const [base,lapse] = layers[i];
    const dh = Math.max(0, Math.min(h,layers[i+1][0]) - base);
    const next = temperature + lapse * dh;
    pressure *= lapse === 0 ? Math.exp(-G0 * dh / (gasConstant * temperature)) : Math.pow(temperature/next, G0/(gasConstant*lapse));
    temperature = next;
    if (h <= layers[i+1][0]) break;
  }
  // Above the model ceiling, only a labelled density/pressure tail is used.
  // No fabricated "air temperature" is displayed for the upper atmosphere.
  if(h > 84852) pressure *= Math.exp(-(h-84852)/7000);
  const density = pressure / (gasConstant * temperature);
  return {
    temperatureC: h <= 84852 ? temperature - 273.15 : null,
    pressureKPa: pressure / 1000,
    airDensity: density,
    airDensityRatio: density / 1.225,
    thermalLabel: altitude >= 100000 ? 'VACUUM' : 'ABOVE MODEL',
  };
}

/**
 * Calculates all physics metrics at distance x (meters) along the plank.
 * @param {number} x - Distance from touchpoint along the plank in meters.
 * @returns {object} Physics state telemetry
 */
export function calculatePlankPhysics(x) {
  const absX = Math.abs(x);

  // Radial distance from Earth's center of mass (0, -EARTH_RADIUS)
  const r = Math.sqrt(EARTH_RADIUS * EARTH_RADIUS + absX * absX);

  // Altitude above Earth spherical surface (meters)
  const altitude = r - EARTH_RADIUS;

  // Slope angle in radians and degrees: angle between plank normal and local gravity
  const thetaRad = Math.atan2(absX, EARTH_RADIUS);
  const thetaDeg = thetaRad * (180 / Math.PI);
  const slopePercent = Math.tan(thetaRad) * 100;

  // Total gravity magnitude at radial distance r: g = g0 * (R_E / r)^2
  const gTotal = G0 * Math.pow(EARTH_RADIUS / r, 2);

  // Perpendicular normal gravity pulling your feet into the plank:
  // gNorm = gTotal * cos(theta) = g0 * (R_E^3 / r^3)
  const gNormal = gTotal * Math.cos(thetaRad);

  // Backward tangential pull dragging you toward the center:
  // gPull = gTotal * sin(theta) = g0 * (R_E^2 * x / r^3)
  const gPull = gTotal * Math.sin(thetaRad);

  const atmosphere = atmosphereAtAltitude(altitude);
  const { pressureKPa, airDensityRatio } = atmosphere;

  // Shoe friction threshold (typical rubber runner on steel/composite: mu ≈ 0.575)
  // At theta = 30° (x = 3,678 km), tan(30°) = 0.577, causing shoe grip to fail!
  const frictionCoeff = 0.575;
  const maxFrictionPull = frictionCoeff * gNormal;
  const isSlipping = gPull > maxFrictionPull;

  // Human status verdict
  let statusText = 'Normal walking';
  let statusColor = '#00ffaa'; // green
  let statusDetail = 'Level ground, sea-level atmosphere.';

  if (altitude < 3000) {
    if (thetaDeg < 1.0) {
      statusText = 'Normal Walking';
      statusColor = '#00ffaa';
      statusDetail = 'Earth feels flat. Gravity pulls nearly straight down.';
    } else {
      statusText = 'Mild Uphill Hike';
      statusColor = '#66ff66';
      statusDetail = `Slight incline (${thetaDeg.toFixed(1)}°). Easily walkable.`;
    }
  } else if (altitude < 8850) {
    statusText = 'Hypoxia Warning (Thin Air)';
    statusColor = '#ffd000';
    statusDetail = `Altitude ${ (altitude/1000).toFixed(1) } km. Oxygen masks needed. Slope: ${thetaDeg.toFixed(1)}°.`;
  } else if (altitude < 100000) {
    statusText = 'Death Zone / Pressure Suit Required';
    statusColor = '#ff8800';
    statusDetail = `Very thin air. Environmental protection required. Slope: ${thetaDeg.toFixed(1)}°.`;
  } else if (!isSlipping) {
    statusText = 'Space Vacuum / Steep Ascent';
    statusColor = '#ff4444';
    statusDetail = `In space vacuum! Climbing a steep ${thetaDeg.toFixed(1)}° incline against ${gPull.toFixed(2)} m/s² pull.`;
  } else if (thetaDeg < 45) {
    statusText = 'SHOE GRIP LIMIT';
    statusColor = '#ff0055';
    statusDetail = `Slope ${thetaDeg.toFixed(1)}° exceeds shoe grip (${maxFrictionPull.toFixed(2)} m/s² max). Unassisted shoes cannot hold here.`;
  } else {
    statusText = 'EXTREME VERTICAL WALL';
    statusColor = '#cc00ff';
    statusDetail = `Over ${thetaDeg.toFixed(1)}° cliff face in deep space. Gravity acts almost entirely as a sheer cliff drop.`;
  }

  return {
    ...atmosphere,
    x,
    absX,
    distKm: x / 1000,
    r,
    altitude,
    altKm: altitude / 1000,
    thetaRad,
    thetaDeg,
    slopePercent,
    gTotal,
    gNormal,
    gPull,
    pressureKPa,
    airDensityRatio,
    frictionCoeff,
    maxFrictionPull,
    isSlipping,
    statusText,
    statusColor,
    statusDetail
  };
}
