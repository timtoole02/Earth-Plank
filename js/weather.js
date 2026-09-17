import * as THREE from 'three';
import { EARTH_RADIUS } from './physics.js';
import { cloudDensityAt, birdVisibility, cloudSurfaceY } from './weather-model.js';

function hash(x,z,salt=0) {
  const n=Math.sin(x*127.1+z*311.7+salt*73.3)*43758.5453;
  return n-Math.floor(n);
}

function cloudTexture() {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');
  // Soft overlapping lobes, shaded along the underside, with transparent edges.
  const puffs=[];
  for(let i=0;i<34;i++){
    const x=75+hash(i,1)*360;
    const envelope=Math.sin((x-40)/440*Math.PI);
    puffs.push({x,y:155-envelope*(30+hash(i,2)*50),r:30+hash(i,3)*43});
  }
  puffs.sort((a,b)=>b.y-a.y);
  for(const p of puffs){
    const g=ctx.createRadialGradient(p.x,p.y-p.r*.3,p.r*.1,p.x,p.y,p.r);
    g.addColorStop(0,'rgba(255,255,252,0.78)');
    g.addColorStop(.45,'rgba(238,244,247,0.65)');
    g.addColorStop(.78,'rgba(200,216,230,0.3)');
    g.addColorStop(1,'rgba(188,207,224,0)');
    ctx.fillStyle=g;ctx.fillRect(p.x-p.r,p.y-p.r,p.r*2,p.r*2);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

function bird(index) {
  const group=new THREE.Group();
  const white=new THREE.MeshStandardMaterial({color:0xd9dce0,roughness:.9,transparent:true});
  const dark=new THREE.MeshStandardMaterial({color:0x323941,roughness:.9,transparent:true});
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),white);
  body.scale.set(.48,.15,.18);group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),white);head.position.set(.37,.09,0);group.add(head);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(.06,.2,6),dark);beak.rotation.z=-Math.PI/2;beak.position.set(.56,.08,0);group.add(beak);
  const wings=[];
  for(const side of [-1,1]){
    const wing=new THREE.Group();wing.position.set(-.06,.07,side*.09);group.add(wing);
    const shape=new THREE.Shape();shape.moveTo(.16,0);shape.lineTo(-.12,side*.75);shape.lineTo(-.43,side*1.0);shape.lineTo(-.34,side*.32);shape.lineTo(-.3,0);
    const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);
    const material=white.clone();material.side=THREE.DoubleSide;
    wing.add(new THREE.Mesh(geometry,material));wings.push(wing);
  }
  return {group,wings,materials:[white,dark,...wings.map(w=>w.children[0].material)],index,baseX:0,baseZ:0};
}

export class WeatherSystem {
  constructor(scene) {
    this.time=0;
    this.group=new THREE.Group();scene.add(this.group);
    this.fog=new THREE.FogExp2(0xcbd9e3,0);scene.fog=this.fog;
    this.texture=cloudTexture();
    this.clouds=[];
    for(let i=0;i<49;i++){
      const material=new THREE.SpriteMaterial({map:this.texture,transparent:true,depthWrite:false,fog:true});
      const sprite=new THREE.Sprite(material);this.group.add(sprite);this.clouds.push(sprite);
    }
    this.birds=Array.from({length:3},(_,i)=>bird(i));
    this.birds.forEach(b=>this.group.add(b.group));
    this.status=document.getElementById('weather-status');
    this.density=0;
  }

  update(delta,player,camera,{intro=false,orbit=false,altitude=0}={}) {
    if(!document.hidden)this.time+=delta;
    const enabled=!orbit&&(!intro||altitude<8000);
    const arrivalFade=intro?1-THREE.MathUtils.smoothstep(altitude,5000,8000):1;
    this.group.visible=enabled;
    this.density=enabled?cloudDensityAt(altitude,player.worldX,player.worldZ,this.time):0;
    this.fog.density=this.density;
    this.status.hidden=intro||!enabled||altitude>18000;
    this.status.textContent=this.density>.001
      ? 'IN THE CLOUDS · Reduced visibility'
      : altitude>2350?'ABOVE THE CLOUDS': 'LOW CLOUDS · Clear at deck level';
    if(!enabled)return;
    const visibility=arrivalFade*(1-THREE.MathUtils.smoothstep(altitude,8000,18000));
    const cell=4000;
    const tileX=Math.floor((player.worldX-this.time*9)/cell),tileZ=Math.floor((player.worldZ-this.time*4)/cell);
    let index=0;
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){
      const sprite=this.clouds[index++];
      const gx=tileX+dx,gz=tileZ+dz;
      const x=(gx+.2+hash(gx,gz)*.6)*cell+this.time*9;
      const z=(gz+.2+hash(gx,gz,1)*.6)*cell+this.time*4;
      const height=1300+hash(gx,gz,2)*500;
      const y=cloudSurfaceY(x,z,height,EARTH_RADIUS);
      sprite.position.set(x-player.worldX,y,z-player.worldZ);
      const width=1100+hash(gx,gz,3)*1600;
      sprite.scale.set(width,width*.5,1);
      const distance=sprite.position.distanceTo(camera.position);
      // Fade before billboards pass the lens. Interior fog carries the effect.
      sprite.material.opacity=visibility*.85*THREE.MathUtils.smoothstep(distance,180,600)
        *(1-THREE.MathUtils.smoothstep(distance,10000,14000));
      sprite.visible=sprite.material.opacity>.001;
    }
    const birdAlpha=birdVisibility(altitude);
    for(const b of this.birds){
      if(Math.abs(b.baseX-player.worldX)>220||Math.abs(b.baseZ-player.worldZ)>220){b.baseX=player.worldX;b.baseZ=player.worldZ;}
      const phase=this.time*.28+b.index*2.1;
      const x=b.baseX+40+Math.sin(phase)*22,z=b.baseZ+Math.cos(phase)*30;
      b.group.position.set(x-player.worldX,7+b.index*1.4+Math.sin(phase*2)*1.2,z-player.worldZ);
      b.group.rotation.y=-Math.atan2(-30*Math.sin(phase),22*Math.cos(phase));
      const fade=birdAlpha*(1-THREE.MathUtils.smoothstep(b.group.position.length(),100,200));
      b.group.visible=fade>.01;
      b.materials.forEach(m=>m.opacity=fade);
      // Alternate a few flaps with short glides.
      const flap=Math.sin(this.time*8+b.index)*(.25+.3*Math.max(0,Math.sin(this.time*.7+b.index)));
      b.wings[0].rotation.x=flap;b.wings[1].rotation.x=-flap;
    }
  }
}
