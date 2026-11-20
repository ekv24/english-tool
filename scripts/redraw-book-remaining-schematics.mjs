import geometry from './redraw-book-remaining-schematics.data.json' with { type: 'json' };

const paper = '#faf9f5';
const panel = '#f5f4ed';
const rule = '#cfc9be';
const axis = '#777269';
const colors = { ink: '#141413', rust: '#a64b2f', slate: '#365b73' };

export function redrawRemainingBookSchematic(name) {
  switch (name) {
    case 'model-fit.png': return modelComparison(name, false);
    case 'test.png': return modelComparison(name, true);
    case 'iptw.png': return propensityWeights();
    case 'zero-bias-s-learner.png': return biasSimulation();
    case 't-learner-problem.png': return learnerComparison(name, 0);
    case 'second-stage-x.png': return learnerComparison(name, 1);
    case 't-vs-x-learner.png': return learnerComparison(name, 2);
    default: return null;
  }
}

function svg(width, height, title, shapes) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${title}</title><rect width="${width}" height="${height}" fill="${paper}"/>
<g font-family="Geist, Helvetica Neue, Arial, sans-serif" fill="${colors.ink}">
${shapes.join('\n')}
</g></svg>\n`;
}

function path(points, stroke, size = 1, dash = '') {
  const d = points.map(([x,y]) => `${x},${y}`).join(' L');
  const style = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<path d="M${d}" fill="none" stroke="${stroke}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round"${style}/>`;
}

function label(x, y, value, size, extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" dominant-baseline="central" text-anchor="middle" ${extra}>${value}</text>`;
}

function dot(x,y,r,fill) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
}

function rect(x,y,w,h,fill,stroke = 'none',size = 1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${size}"/>`;
}

function chartGrid({x0,x1,y0,y1,xTicks,yTicks,xLabel,yLabel,labelsLeft = true, labelsBottom = true, size = 10}) {
  const chart = [rect(x0,y0,x1-x0,y1-y0,panel)];
  for (const [x,value] of xTicks) {
    chart.push(path([[x,y0],[x,y1]],rule,.7),path([[x,y0-4],[x,y0]],axis,.7),path([[x,y1],[x,y1+4]],axis,.7));
    if(labelsBottom) chart.push(label(x,y1+size+3,value,size));
  }
  for (const [y,value] of yTicks) {
    chart.push(path([[x0,y],[x1,y]],rule,.7),path([[x0-4,y],[x0,y]],axis,.7),path([[x1,y],[x1+4,y]],axis,.7));
    if(labelsLeft) chart.push(label(x0-8,y,value,size,'style="text-anchor:end"'));
  }
  if(xLabel) chart.push(label((x0+x1)/2,y1+size*2.65,xLabel,size));
  if(yLabel) {
    const x=x0-21.5, y=(y0+y1)/2;
    chart.push(label(x,y,yLabel,size,`transform="rotate(-90 ${x} ${y})"`));
  }
  return chart;
}

// Coordinates extracted from the source raster retain the plotted observations and model trajectories.
function modelComparison(name, test) {
  const {marks,lines} = geometry[name];
  const panels = test ? [[45,229,71,202],[266,451,292,425],[487,672,502,656]] : [[45,256,75,225],[297,507,327,477],[549,758,565,741]];
  const [y0,y1] = test ? [28,213] : [38,243];
  const chart = [];
  for (const [index,[x0,x1,zero,ten]] of panels.entries()) {
    const xValues = index === 2 ? [0,2,4,6,8,10] : [-2,0,2,4,6,8,10,12];
    const xTicks = xValues.map(x=>[zero+(ten-zero)*x/10,x===-2?'−2':String(x)]);
    const yTicks = Array.from({length:5},(_,i)=>[y1-(y1-y0)*i/4,String(i*5)]);
    chart.push(...chartGrid({x0,x1,y0,y1,xTicks,yTicks,labelsLeft:index===0,size:test?14:17}));
    chart.push(...marks[index].map(([x,y])=>dot(x,y,test?2.9:3.2,colors.slate)));
    chart.push(path(lines[index],colors.rust,1.35));
  }
  return svg(test?709:793,test?266:290,test?'Regression comparison on test data':'Regression comparison on training data',chart);
}

function propensityWeights() {
  const {marks,lines} = geometry['iptw.png'];
  const chart = [];
  const plot = (x0,x1,y0,y1,xTicks,yTicks,xLabel,yLabel) => chartGrid({x0,x1,y0,y1,xTicks,yTicks,xLabel,yLabel,size:6.3});
  for (const [index,left] of [25.5,314.5].entries()) {
    const yTicks = Array.from({length:5},(_,i)=>[116-i*22.85,String(i*2)]);
    const xTicks = Array.from({length:5},(_,i)=>[left+34.3+35.4*i,String((i+1)*2)]);
    chart.push(...plot(left,left+183,4,122,xTicks,yTicks,index?'X':'','Y'));
    chart.push(...marks[index].map(([x,y,r,c])=>dot(x,y,r,c?colors.rust:colors.slate)));
  }
  const ticks = Array.from({length:5},(_,i)=>[33.2+33.5*i,String(i*2)]);
  ticks.push([200.7,'10']);
  const probabilities = Array.from({length:5},(_,i)=>[256.5-23.3*i,(i/5).toFixed(i?1:0)]);
  chart.push(...plot(25.5,208.5,142,261,ticks,probabilities,'','P(X)'));
  chart.push(label(117,274,'X',6.3));
  chart.push(path(lines[0],colors.rust,.85));
  chart.push(path([[226,61.5],[292,61.5]],axis,1.05));
  chart.push(`<path d="M285 58.8 l7 2.7 -7 2.7z" fill="${axis}"/>`);
  chart.push(label(259,52,'IPTW',10,'font-weight="600"'));
  return svg(500,278,'Inverse probability of treatment weighting',chart);
}

function biasSimulation() {
  const {bars, lines} = geometry['zero-bias-s-learner.png'];
  const chart = [rect(18.5,3.5,324,321.2,paper,axis,.8)];
  for (let i=0; i<=10; i++) {
    const y = 324.6 - i * 30.6;
    chart.push(path([[18.5,y],[22,y]],axis,.8),path([[338.5,y],[342.5,y]],axis,.8),label(14,y,i,10,'style="text-anchor:end"'));
  }
  for (let i=-4;i<=4;i++) {
    const x = 180.5+i*34;
    const value = (i*.05).toFixed(2).replace(/0+$/,'').replace(/\.$/,'').replace('-','−');
    chart.push(path([[x,3.5],[x,7]],axis,.8),path([[x,321],[x,324.5]],axis,.8),label(x,339,value,9));
  }
  chart.push(...bars.map(([x,y,w])=>rect(x-w/2,y,w,324.5-y,'#8cb2c6',colors.slate,.65)));
  chart.push(path(lines[0],colors.rust,1));
  chart.push(rect(28,16,84,40,paper,axis,.85), rect(34,20,30,11,'#8cb2c6',colors.slate,.65));
  chart.push(label(68,26,'Simulation',10,'style="text-anchor:start"'),path([[34,43],[64,43]],colors.rust,1));
  chart.push(label(68,44,'N(0, Σ<tspan baseline-shift="sub" font-size="7">s</tspan>)',10,'style="text-anchor:start"'));
  return svg(350,345,'Simulation and centered normal reference',chart);
}

// Marker centers, estimator paths, and grid coordinates come from Künzel et al. (2019), Fig. 1, p. 4159.
// A uniform crop transform aligns those publication vectors with each of the book's three screenshots.
function learnerComparison(name, part) {
  const {grid,crosses,dots,lines} = geometry[name];
  const charts = [
    {size:[1228,422], title:'(a) Observed Outcome &amp; First Stage Base Learners', x:52,
      ticks:[[91,'2.5'],[165,'2.0'],[240,'1.5'],[313,'1.0'],[387,'0.5']],
      legends:[[142,'μ̂','0','rust',false],[184,'μ̂','1','slate',true]]},
    {size:[1238,412], title:'(b) Imputed Treatment Effects &amp; Second Stage Base Learners', x:58,
      ticks:[[115,'1.5'],[221,'1.0'],[329,'0.5']],
      legends:[[229,'τ̂','1','slate',false],[272,'τ̂','0','rust',true]]},
    {size:[1228,496], title:'(c) Individual Treatment Effects &amp; CATE Estimators', x:53,
      ticks:[[84,'1.6'],[176,'1.2'],[269,'0.8'],[361,'0.4']],
      legends:[[250,'τ̂','T','ink',false],[291,'τ̂','X','ink',true]]},
  ];
  const {size:[width,height],title,x,ticks,legends} = charts[part];
  const chart = [label(x,29,title,28,'style="text-anchor:start" font-weight="550"')];
  chart.push(...grid.map(points=>path(points,rule,1.4)));
  for(const [y,tick] of ticks) chart.push(label(x-11,y,tick,21,'style="text-anchor:end"'));
  if(part===2) {
    for(const [x,tick] of [[101,'−1.0'],[340,'−0.5'],[579,'0.0'],[817,'0.5'],[1056,'1.0']]) chart.push(label(x,472,tick,21));
  }
  const cross = (x,y) => `<path d="M${x-3.1} ${y-3.1} l6.2 6.2 m0 -6.2 l-6.2 6.2" stroke="${colors.rust}" stroke-width="1.35" opacity=".78"/>`;
  chart.push(...crosses.map(([x,y])=>cross(x,y)),...dots.map(([x,y])=>dot(x,y,5,colors.slate)));
  chart.push(...lines.map(({color,dash,points})=>path(points,colors[color],2.3,dash?'10.5 10.5':'')));
  for(const [y,glyph,index,color,dashed] of legends) {
    chart.push(path([[width-77,y],[width-45,y]],colors[color],2.3,dashed?'10.5 10.5':''));
    const shift=part===2?'super':'sub';
    chart.push(label(width-27,y,`${glyph}<tspan baseline-shift="${shift}" font-size="15">${index}</tspan>`,23,'font-family="Georgia, serif" font-style="italic"'));
  }
  if(part===0) chart.push(label(1160,274,'W',23),cross(1168,314),dot(1168,357,5,colors.slate),label(1200,315,'0',21),label(1200,358,'1',21));
  return svg(width,height,title,chart);
}
