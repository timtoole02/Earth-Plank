import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudDensityAt, birdVisibility, cloudSurfaceY } from '../js/weather-model.js';
import { EARTH_RADIUS, WAYPOINTS, calculatePlankPhysics } from '../js/physics.js';

test('cloud layer has clear air below and above, with soft boundaries',()=>{
 for(const h of [0,800,2350,100000])assert.equal(cloudDensityAt(h),0);
 assert.ok(cloudDensityAt(1550)>0.008);
 for(const h of [850,1200,1900,2350])assert.ok(Math.abs(cloudDensityAt(h-.1)-cloudDensityAt(h+.1))<0.0001);
});
test('drifting cloud density stays bounded on either half of the plank',()=>{
 for(const x of [-160000,-140000,140000,160000])for(let t=0;t<100;t++){
  const density=cloudDensityAt(calculatePlankPhysics(x).altitude,x,0,t);assert.ok(density>=0 && density<=.017);
 }
});
test('cloud shells follow the spherical Earth instead of the flat plank',()=>{
 for(const x of [0,140000,-140000]){
  const height=1550,y=cloudSurfaceY(x,0,height,EARTH_RADIUS);
  assert.ok(Math.abs(Math.hypot(x,EARTH_RADIUS+y)-EARTH_RADIUS-height)<1e-6);
 }
});
test('cloud waypoint enters mist; birds stay in the lower atmosphere',()=>{
 const waypoint=WAYPOINTS.find(w=>w.id==='clouds');
 const altitude=calculatePlankPhysics(waypoint.distKm*1000).altitude;
 assert.ok(cloudDensityAt(altitude,waypoint.distKm*1000)>0.008);
 assert.equal(birdVisibility(0),1);assert.equal(birdVisibility(1500),0);assert.equal(birdVisibility(100000),0);
});
