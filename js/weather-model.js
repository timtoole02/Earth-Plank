const smooth = (a,b,x) => {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

// A staged low-cloud layer, not live weather. Both halves of the plank share it.
export function cloudDensityAt(altitude, x=0, z=0, time=0) {
  const layer=smooth(850,1200,altitude)*(1-smooth(1900,2350,altitude));
  const drifting=0.75+0.25*Math.sin((x-time*9)/1800)*Math.cos((z-time*4)/1400);
  return layer*drifting*0.017;
}

export function birdVisibility(altitude) {
  return 1-smooth(650,1500,altitude);
}

export function cloudSurfaceY(x,z,height,radius) {
  const horizontal=x*x+z*z;
  const shell=radius+height;
  if(horizontal>=shell*shell) return -radius;
  // Rationalized form preserves precision near the tangent point.
  return (2*radius*height+height*height-horizontal)/(Math.sqrt(shell*shell-horizontal)+radius);
}
