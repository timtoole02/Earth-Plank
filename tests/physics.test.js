import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereAtAltitude, calculatePlankPhysics, EARTH_RADIUS, PLANK_HALF_LENGTH } from '../js/physics.js';
import { stepPlankMotion } from '../js/motion.js';
const state=(x=0,z=0,vx=0,vz=0)=>({worldX:x,worldZ:z,vx,vz});
const controls=(forward=0,lateral=0,magBoots=false,speed=5)=>({forward,lateral,magBoots,speed});
const simulate=(s,c,time,dt=1/60)=>{for(let t=0;t<time-1e-8;t+=dt)stepPlankMotion(s,c,dt);return s;};
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

test('standard atmosphere matches sea level and 11 km reference',()=>{
 let a=atmosphereAtAltitude(0);near(a.temperatureC,15);near(a.pressureKPa,101.325);near(a.airDensity,1.225,0.001);
 a=atmosphereAtAltitude(EARTH_RADIUS*11000/(EARTH_RADIUS-11000));near(a.temperatureC,-56.5,0.001);near(a.pressureKPa,22.632,0.01);
 assert.equal(atmosphereAtAltitude(100000).temperatureC,null);
 assert.equal(atmosphereAtAltitude(100000).thermalLabel,'VACUUM');
});
test('atmosphere remains continuous at layer boundaries',()=>{
 for(const h of [11000,20000,32000,47000,51000,71000]){
  const alt=EARTH_RADIUS*h/(EARTH_RADIUS-h), a=atmosphereAtAltitude(alt-.01),b=atmosphereAtAltitude(alt+.01);
  near(a.temperatureC,b.temperatureC,.001);near(a.pressureKPa,b.pressureKPa,.001);
 }
});
test('gravity is symmetric and weakens at high altitude',()=>{
 const a=calculatePlankPhysics(4000000),b=calculatePlankPhysics(-4000000);
 near(a.gPull,b.gPull);near(a.altitude,b.altitude);assert.ok(a.gTotal<9.80665);
});
test('both lanes stay fixed during forward running',()=>{
 for(const z of [-12,12]) {const s=simulate(state(0,z),controls(1),5);near(s.worldZ,z);assert.ok(s.worldX>15);}
});
test('released strafe brakes without crossing to the other side',()=>{
 const s=simulate(state(),controls(0,1),1);assert.ok(s.worldZ>0);
 simulate(s,controls(),2);const stopped=s.worldZ;near(s.vz,0);simulate(s,controls(1),5);near(s.worldZ,stopped);
});
test('rails cancel outward velocity and permit immediate return',()=>{
 const s=simulate(state(0,14),controls(0,1),2);near(s.worldZ,14.2);near(s.vz,0);
 simulate(s,controls(0,-1),1);assert.ok(s.worldZ<14);
});
test('downhill running is faster than uphill, on both halves',()=>{
 for(const sign of [-1,1]){
  const uphill=simulate(state(sign*2000000),controls(sign),8);
  const downhill=simulate(state(sign*2000000),controls(-sign),8);
  assert.ok(Math.abs(downhill.vx)>Math.abs(uphill.vx)+0.5);
 }
});
test('unassisted shoes slide toward anchor; magnetic grip holds',()=>{
 for(const sign of [-1,1]){
  const s=simulate(state(sign*5000000),controls(),5);assert.ok(s.vx*sign<0);
  const held=simulate(state(sign*5000000),controls(0,0,true),5);near(held.vx,0);near(held.worldX,sign*5000000);
 }
});
test('kinetic friction reduces free downhill acceleration',()=>{
 const p=calculatePlankPhysics(5000000),s=simulate(state(5000000),controls(),1);
 assert.ok(Math.abs(s.vx)<p.gPull);assert.ok(Math.abs(s.vx)>0);
});
test('air drag is dissipative; no-input braking does not reverse motion',()=>{
 const s=simulate(state(0,0,5),controls(),4);near(s.vx,0);assert.ok(s.worldX>0);
 const run=simulate(state(),controls(1),10);assert.ok(run.vx<5 && run.vx>4.9);
});
test('powered travel is explicit, bounds lateral velocity, and respects endpoints',()=>{
 const s=state(PLANK_HALF_LENGTH-1,14);
 const result=stepPlankMotion(s,controls(1,1,false,50000),.1);
 assert.equal(result.powered,true);assert.ok(s.worldX<=PLANK_HALF_LENGTH);assert.ok(s.worldZ<=14.2);assert.ok(Math.abs(s.vz)<=3.5);
});
test('substeps keep results consistent across frame rates',()=>{
 const a=simulate(state(5000000),controls(),5,1/30),b=simulate(state(5000000),controls(),5,1/120);
 near(a.worldX,b.worldX,.001);near(a.vx,b.vx,.0001);
 const zero=state();stepPlankMotion(zero,controls(),0);assert.deepEqual(zero,state());
});
