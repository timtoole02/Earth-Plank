import * as THREE from 'three';
import { cloudDensityAt, birdVisibility } from './weather-model.js';

// Visible clouds are raymarched volumes (clouds.js). This module keeps the
// in-cloud mist, the status line and the birds.

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
    this.birds=Array.from({length:3},(_,i)=>bird(i));
    this.birds.forEach(b=>this.group.add(b.group));
    this.status=document.getElementById('weather-status');
    this.density=0;
  }

  update(delta,player,camera,{intro=false,orbit=false,altitude=0}={}) {
    if(!document.hidden)this.time+=delta;
    const enabled=!orbit&&(!intro||altitude<8000);
    this.group.visible=enabled;
    this.density=enabled?cloudDensityAt(altitude,player.worldX,player.worldZ,this.time):0;
    this.fog.density=this.density;
    this.status.hidden=intro||!enabled||altitude>18000;
    this.status.textContent=this.density>.001
      ? 'IN THE CLOUDS · Reduced visibility'
      : altitude>2350?'ABOVE THE CLOUDS': 'LOW CLOUDS · Clear at deck level';
    if(!enabled)return;
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
