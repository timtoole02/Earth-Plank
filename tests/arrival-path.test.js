import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalPath, ufoFlight } from '../js/arrival-path.js';
const frames=[[0,{x:0,y:14000000,z:40000000}],[4,{x:-7000000,y:7500000,z:21000000}],[8,{x:-100000,y:420200,z:100000}],[11,{x:-99940,y:419990,z:99940}],[14,{x:-18000,y:120200,z:24000}],[17,{x:-17960,y:119990,z:23940}],[20,{x:-1500,y:9350,z:1600}],[23,{x:-1450,y:9050,z:1500}],[26,{x:-50,y:90,z:65}],[29,{x:0,y:1.8,z:0}]];
const sample=createArrivalPath(frames);
test('arrival passes through every pose without going below the deck',()=>{
 for(const [t,expected] of frames){const p={};sample(t,p);for(const axis of ['x','y','z'])assert.ok(Math.abs(p[axis]-expected[axis])<1e-6);}
 for(let t=0;t<=29;t+=1/120){const p={};const {index}=sample(t,p);for(const axis of ['x','y','z']){const a=frames[index][1][axis],b=frames[index+1][1][axis];assert.ok(p[axis]>=Math.min(a,b)-1e-6&&p[axis]<=Math.max(a,b)+1e-6);}assert.ok(p.y>=1.8-1e-9);}
});
test('arrival velocity is continuous through zoom/flyby joins',()=>{
 const eps=1e-5;
 for(const [t] of frames.slice(1,-1)) {
  const a={},b={},c={};sample(t-eps,a);sample(t,b);sample(t+eps,c);
  for(const axis of ['x','y','z']){
   const f=n=>axis==='y'?Math.log(n):Math.asinh(n/10);
   const left=(f(b[axis])-f(a[axis]))/eps,right=(f(c[axis])-f(b[axis]))/eps;
   assert.ok(Math.abs(left-right)<0.001);
  }
 }
});
test('UFO crosses once after the second satellite and before the airplane',()=>{
 assert.equal(ufoFlight(17).visible,false);assert.equal(ufoFlight(17.2).visible,true);
 assert.ok(Math.abs(ufoFlight(17.675).progress-.5)<1e-9);
 assert.equal(ufoFlight(18.16).visible,false);assert.equal(ufoFlight(20).visible,false);
});
