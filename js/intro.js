import * as THREE from 'three';
import { createArrivalPath, ufoFlight } from './arrival-path.js?v=arrival-polish-1';
import { EARTH_RADIUS, PLANK_HALF_LENGTH } from './physics.js';

const smooth = t => t * t * (3 - 2 * t);
const v = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(group, geometry, material, position) {
  const item = new THREE.Mesh(geometry, material);
  item.position.copy(position);
  group.add(item);
  return item;
}

function satellite() {
  const group = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a557, metalness: 0.65, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xcbd3db, metalness: 0.55, roughness: 0.3 });
  const cells = new THREE.MeshStandardMaterial({ color: 0x365e96, emissive: 0x142d59, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.32, side: THREE.DoubleSide });
  const grid = new THREE.MeshStandardMaterial({ color: 0x7594b1, metalness: 0.6, roughness: 0.4 });
  mesh(group, new THREE.BoxGeometry(3, 3.4, 3), foil, v(0, 0, 0));
  mesh(group, new THREE.CylinderGeometry(0.12, 0.12, 22, 8), metal, v(0, 0, 0)).rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    mesh(group, new THREE.BoxGeometry(9, 0.12, 5), cells, v(side * 7, 0, 0));
    for (let i = 0; i <= 9; i++) mesh(group, new THREE.BoxGeometry(0.04, 0.15, 5), grid, v(side * (2.5 + i), 0, 0));
    for (let i = -2; i <= 2; i++) mesh(group, new THREE.BoxGeometry(9, 0.15, 0.025), grid, v(side * 7, 0, i));
  }
  const dish = mesh(group, new THREE.SphereGeometry(1.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal, v(0, 2.4, 0));
  dish.rotation.z = 0.4;
  mesh(group, new THREE.CylinderGeometry(0.04, 0.04, 3, 8), metal, v(0, 3, 0));
  return group;
}

function airplane() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe2e7eb, metalness: 0.2, roughness: 0.48 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x25445d, metalness: 0.2, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15202c, roughness: 0.6 });
  const body = mesh(group, new THREE.SphereGeometry(1, 32, 20), white, v(0, 0, 0));
  body.scale.set(19, 2.1, 2.1);
  const wing = (points, material) => {
    const shape = new THREE.Shape(points.map(([x,z]) => new THREE.Vector2(x,z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    return mesh(group, geo, material, v(0, 0, 0));
  };
  for (const side of [-1, 1]) {
    wing([[4,side*1],[-6,side*18],[-9,side*18],[-3,side*1]], white);
    wing([[-11,side*1],[-17,side*7],[-19,side*7],[-16,side*1]], blue);
    const engine = mesh(group, new THREE.CylinderGeometry(1, 1.1, 4, 20), white, v(-1,-1.8,side*7));
    engine.rotation.z = Math.PI / 2;
    mesh(group, new THREE.CircleGeometry(0.82, 20), dark, v(1.01,-1.8,side*7)).rotation.y = Math.PI / 2;
    for (let x = -12; x < 12; x += 1.3) mesh(group, new THREE.SphereGeometry(0.16,8,6), dark, v(x,0.6,side*1.95));
  }
  const tail = wing([[-11,0],[-16,6],[-19,6],[-18,0]], blue);
  tail.rotation.x = -Math.PI / 2;
  mesh(group, new THREE.SphereGeometry(0.65, 12, 8), dark, v(16,0.9,0)).scale.set(1.5,0.5,1.8);
  return group;
}

function flyingSaucer() {
  const group = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({color:0x737e8d, metalness:0.7, roughness:0.28});
  const canopy = new THREE.MeshStandardMaterial({color:0x174e5b, emissive:0x087c89, emissiveIntensity:0.6, metalness:0.4, roughness:0.18});
  const glow = new THREE.MeshBasicMaterial({color:0x76ffe0, toneMapped:false});
  mesh(group,new THREE.SphereGeometry(1,40,16),hull,v(0,0,0)).scale.set(8,1.05,8);
  mesh(group,new THREE.SphereGeometry(1,24,16),canopy,v(0,1.15,0)).scale.set(3,1.8,3);
  const ring = mesh(group,new THREE.TorusGeometry(7.7,0.14,8,48),glow,v(0,-0.15,0));
  ring.rotation.x=Math.PI/2;
  for(let i=0;i<8;i++) {
    const angle=i*Math.PI/4;
    mesh(group,new THREE.SphereGeometry(0.23,8,6),glow,v(Math.cos(angle)*6,-0.8,Math.sin(angle)*6));
  }
  return group;
}

function moon() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#9c9c97'; ctx.fillRect(0,0,1024,512);
  let seed = 42;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  ctx.globalAlpha = 0.28;
  for(let i=0;i<600;i++) {
    const x=random()*1024,y=random()*512,r=1+random()**3*45;
    const g=ctx.createRadialGradient(x-r*.2,y-r*.2,0,x,y,r);
    g.addColorStop(0,'#666861');g.addColorStop(.65,'#81837c');g.addColorStop(.85,'#b8b8b0');g.addColorStop(1,'#9c9c9700');
    ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.SphereGeometry(1737400,64,48), new THREE.MeshStandardMaterial({map,roughness:1}));
}

export class ArrivalIntro {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.elapsed = 0;
    this.duration = 29;
    // Slow flyby sections separate the long, logarithmic descents.
    this.frames = [
      [0, v(0,14000000,40000000), v(0,-4000000,0)],
      [4, v(-7000000,7500000,21000000), v(0,-1000000,0)],
      [8, v(-100000,420200,100000), v(1500000,-100000,-1500000)],
      [11, v(-99940,419990,99940), v(1500000,-100000,-1500000)],
      [14, v(-18000,120200,24000), v(600000,-30000,-600000)],
      [17, v(-17960,119990,23940), v(600000,-30000,-600000)],
      [20, v(-1500,9350,1600), v(20000,5000,-35000)],
      [23, v(-1450,9050,1500), v(12000,2000,-20000)],
      [26, v(-50,90,65), v(12,0,0)],
      [29, v(0,1.8,0), v(30,1.8,0)]
    ];
    this.samplePath = createArrivalPath(this.frames);
    this.orientations = this.frames.map(frame => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(frame[1],frame[2],v(0,1,0))));
    this.group = new THREE.Group(); app.scene.add(this.group);
    this.moon = moon(); this.moon.position.set(-22000000,9500000,-46000000); app.scene.add(this.moon);
    // At planetary scale the real 30 m deck is subpixel. A thin route trace
    // reveals its actual 50,000 km extent, then fades as the deck resolves.
    this.trace = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(-PLANK_HALF_LENGTH,0,0),v(PLANK_HALF_LENGTH,0,0)]),new THREE.LineBasicMaterial({color:0xe9c485,transparent:true,depthTest:false}));
    this.trace.renderOrder = 5; this.group.add(this.trace);
    this.satellites = [satellite(), satellite()];
    this.satellites.forEach(s => s.scale.setScalar(1.6));
    this.placeFlyby(this.satellites[0],8,11,95,12);
    this.placeFlyby(this.satellites[1],14,17,100,-18);
    this.ufo = flyingSaucer(); this.ufo.visible=false; this.group.add(this.ufo);
    this.plane = airplane();
    this.placeFlyby(this.plane,20,23,200,20);
    this.plane.rotation.y = -0.35;
    this.planeBase = this.plane.position.clone();
    this.overlay = document.getElementById('arrival-intro');
    this.title = document.getElementById('intro-title');
    this.detail = document.getElementById('intro-detail');
    this.altitudeLabel = document.getElementById('intro-altitude');
    this.progress = document.getElementById('intro-progress');
    document.getElementById('btn-skip-intro').addEventListener('click',()=>this.finish());
    document.getElementById('btn-replay-intro').addEventListener('click',()=>this.start());
    window.addEventListener('keydown',e=>{
      if(this.active && (e.key==='Escape'||e.code==='KeyP')) this.finish();
    });
    this.start();
  }

  placeFlyby(object,start,end,distance,side) {
    const a=this.frames.find(f=>f[0]===start)[1], b=this.frames.find(f=>f[0]===end)[1];
    const center=a.clone().lerp(b,0.5);
    const look=this.frames.find(f=>f[0]===start)[2].clone().lerp(this.frames.find(f=>f[0]===end)[2],0.5);
    const forward=look.sub(center).normalize();
    const right=new THREE.Vector3().crossVectors(forward,v(0,1,0)).normalize();
    object.position.copy(center).addScaledVector(forward,distance).addScaledVector(right,side);
    object.rotation.set(0.25,0.4,0.3);
    this.group.add(object);
  }

  start() {
    const {player,orbitControls}=this.app;
    player.pause(); player.setCameraMode('gravity'); player.teleportToKm(0, { recenter: true });
    player.yaw=0; player.pitch=0; player.inputSuspended=true;
    orbitControls.enabled=false;
    player.astronaut.group.visible=false;
    this.elapsed=0;this.active=true;this.group.visible=true;
    this.overlay.hidden=false;
    document.body.classList.add('intro-playing');
    for(const id of ['top-bar','left-panel','bottom-dock','guide-drawer']) document.getElementById(id).inert=true;
    document.getElementById('guide-drawer').classList.remove('open');
    document.getElementById('btn-skip-intro').focus();
    this.update(0);
  }

  finish() {
    if(!this.active) return;
    this.active=false;this.group.visible=false;this.ufo.visible=false;this.overlay.hidden=true;
    this.app.player.inputSuspended=false;
    this.app.player.pause();
    this.app.camera.fov=65;this.app.camera.updateProjectionMatrix();
    document.body.classList.remove('intro-playing');
    for(const id of ['top-bar','left-panel','bottom-dock','guide-drawer']) document.getElementById(id).inert=false;
    document.getElementById('btn-skip-intro').blur();
    this.app.player.update(0);
  }

  update(delta) {
    if(!this.active) return;
    if(!document.hidden) this.elapsed+=delta;
    if(this.elapsed>=this.duration) {this.finish();return;}
    const t=this.elapsed;
    const {camera}=this.app;
    const {index,u}=this.samplePath(t,camera.position);
    // Blend orientations directly: a distant aim point must not whip across
    // the camera while its position is descending on a logarithmic scale.
    camera.up.set(0,1,0);
    camera.quaternion.copy(this.orientations[index]).slerp(this.orientations[index+1],smooth(u));
    const flight=ufoFlight(t);
    this.ufo.visible=flight.visible;
    if(flight.visible) {
      const span=90*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect+18;
      this.ufo.position.set(THREE.MathUtils.lerp(-span,span,flight.progress),10+Math.sin(flight.progress*Math.PI)*3,-90)
        .applyQuaternion(camera.quaternion).add(camera.position);
      this.ufo.quaternion.copy(camera.quaternion);
      this.ufo.rotateX(0.3);this.ufo.rotateZ(-0.2+flight.progress*0.35);
    }
    this.altitude=Math.max(0,camera.position.clone().add(v(0,EARTH_RADIUS,0)).length()-EARTH_RADIUS);
    this.moon.position.x=-22000000-this.app.player.worldX;
    this.trace.material.opacity=1-smooth(THREE.MathUtils.clamp((t-5)/3,0,1));
    this.satellites[0].rotation.y=0.4+t*0.025;
    this.satellites[1].rotation.y=-0.3-t*0.02;
    this.plane.position.copy(this.planeBase).add(v((t-21.5)*24,0,0));
    const chapter=t<6?['A world beneath your feet','50,000 km of plank. One point of contact with Earth.']
      :t<12?['Passing through orbit','Solar arrays catch the first light. Earth fills the view.']
      :t<18?['The edge of the atmosphere','One last satellite, then the blue of the sky.']
      :t<24?['Traffic at 30,000 feet','A passing airliner on the final descent.']
      :['Welcome to the plank','From planetary scale to your next footstep.'];
    this.title.textContent=chapter[0];this.detail.textContent=chapter[1];
    this.altitudeLabel.textContent=this.altitude>100000?`${Math.round(this.altitude/1000).toLocaleString()} km above Earth`:`${Math.round(this.altitude*3.28084).toLocaleString()} ft above Earth`;
    this.progress.style.transform=`scaleX(${t/this.duration})`;
  }
}
