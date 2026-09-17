// Shape-preserving interpolation in signed-log coordinates. Matching tangent
// speeds at knots avoids stop/start jolts across the planet-to-deck scale range.
export function createArrivalPath(frames) {
  const times = frames.map(f => f[0]);
  const axes = ['x','y','z'].map(axis => {
    const values = frames.map(f => axis === 'y' ? Math.log(f[1][axis]) : Math.asinh(f[1][axis] / 10));
    const slopes = values.slice(1).map((value,i) => (value-values[i])/(times[i+1]-times[i]));
    const tangents = values.map((_,i) => {
      if(i===0 || i===values.length-1) return 0;
      const a=slopes[i-1],b=slopes[i];
      if(a*b<=0) return 0;
      const left=times[i]-times[i-1],right=times[i+1]-times[i];
      const w1=2*right+left,w2=right+2*left;
      return (w1+w2)/(w1/a+w2/b);
    });
    return {values,tangents};
  });
  return (time, position) => {
    const t=Math.max(times[0],Math.min(times.at(-1),time));
    let index=times.findIndex((_,i)=>i<times.length-1 && t<times[i+1]);
    if(index<0) index=times.length-2;
    const length=times[index+1]-times[index],u=(t-times[index])/length;
    for(const [j,axis] of ['x','y','z'].entries()) {
      const {values,tangents}=axes[j];
      const value=(2*u**3-3*u**2+1)*values[index]+(u**3-2*u**2+u)*length*tangents[index]
        +(-2*u**3+3*u**2)*values[index+1]+(u**3-u**2)*length*tangents[index+1];
      position[axis]=axis==='y'?Math.exp(value):10*Math.sinh(value);
    }
    return {index,u};
  };
}

export function ufoFlight(time) {
  const progress=(time-17.2)/0.95;
  return {visible:progress>=0 && progress<=1,progress:Math.max(0,Math.min(1,progress))};
}
