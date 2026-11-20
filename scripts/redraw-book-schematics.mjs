const paper = '#faf9f5';
const ink = '#141413';
const rule = '#777269';
const neutral = '#f0eee6';
const green = '#dce8d7';
const amber = '#f6eacc';
const rose = '#f5e7e0';
const blue = '#e4edf2';
const purple = '#e8e1ed';
const rust = '#a64b2f';
const slate = '#365b73';

const figures = new Map([
  ['cross-validation.png', crossValidation],
  ['cross-prediction.png', crossPrediction],
  ['customers.png', customers],
  ['synth_img.png', syntheticControl],
  ['graph-flow.png', graphFlow],
  ['kfold-cv.png', kFold],
  ['aug-data.png', augmentedData],
  ['graph-1.png', () => causalGraphs(1)],
  ['graph-2.png', () => causalGraphs(2)],
  ['graph-3.png', () => causalGraphs(3)],
  ['fe-graph.png', () => fixedEffects(false)],
  ['control-unit.png', () => fixedEffects(true)],
  ['ps-experiment.png', propensityExperiment],
  ['slice-1.png', () => slices(false)],
  ['slice-2.png', () => slices(true)],
  ['s-learner.png', () => learner(false)],
  ['t-learner.png', () => learner(true)],
  ['always_takers.png', alwaysTakers],
  ['diagram.png', orthogonalization],
  ['qob.png', quarterOfBirth],
  ['translation.png', translation],
  ['non-linear.png', nonLinear],
  ['extrapolation.png', extrapolation],
  ['opt-deriv.png', optimalDerivative],
  ['linear-aprox.png', linearApproximation],
  ['ml-flow.png', machineLearningFlow],
  ['x-learner.png', xLearner],
  ['block-perm.png', blockPermutation],
  ['anatomy1.png', () => anatomy(1)], ['anatomy2.png', () => anatomy(2)],
  ['anatomy3.png', () => anatomy(3)], ['anatomy4.png', () => anatomy(4)],
  ['p_value.png', pValue],
  ['cashflow-1.png', () => cashflow(0)],
  ['cascade-1.png', () => cashflow(1)], ['cascade-2.png', () => cashflow(2)],
  ['cf-pred.png', counterfactualPredictions],
  ['model-opt.png', modelOptimization],
  ['cumm_elast.png', () => cumulative(false)], ['cumm_gain.png', () => cumulative(true)],
  ['elasticity.png', elasticity], ['elast-partition.png', elasticityPartition], ['elast-split.png', elasticitySplit],
  ['personalise.png', personalisedCoupons], ['waiting-time.png', waitingTime],
  ['logistic.png', logistic], ['linear-case.png', () => demand(false)], ['non-linear-case.png', () => demand(true)],
  ['cop-ex1.png', () => marketing(false)], ['cop-ex2.png', () => marketing(true)],
  ['ate_bins.png', ateBins],
]);

export function redrawBookSchematic(name) {
  return figures.get(name)?.() ?? null;
}

function svg(width, height, title, shapes) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${title}</title><rect width="${width}" height="${height}" fill="${paper}"/>
<defs>${[[rule, 'arrow'], [slate, 'flow']].map(([fill, id]) => `<marker id="${id}" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="9" refY="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10 2 5Z" fill="${fill}"/></marker>`).join('')}</defs>
<g fill="${ink}" font-family="Geist, Helvetica Neue, Arial, sans-serif" font-size="14" text-anchor="middle">
${shapes.join('\n')}
</g></svg>\n`;
}

function label(x, y, value, attrs = '') {
  return `<text x="${x}" y="${y}" dominant-baseline="central" ${attrs}>${value}</text>`;
}

function textBlock(x, y, labels, step, attrs = '') {
  return labels.map((line, i) => label(x, y + (i - (labels.length - 1) / 2) * step, line, attrs)).join('\n');
}

function rect(x, y, w, h, fill = neutral) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${rule}"/>`;
}

function box(x, y, w, h, text, fill, size = 16) {
  return rect(x, y, w, h, fill) + textBlock(x + w / 2, y + h / 2, [text].flat(), size * 1.2, `font-size="${size}"`);
}

function oval(cx, cy, rx, ry, fill = neutral, text = '', size = 14, stroke = rule) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}"/>` + (text ? label(cx, cy, text, `font-size="${size}"`) : '');
}

function path(d, attrs = '') {
  return `<path d="${d}" fill="none" stroke="${rule}" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>`;
}

function pathInColor(d, color, attrs = '') {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>`;
}

function arrow(d, attrs = '') {
  return path(d, `marker-end="url(#arrow)" ${attrs}`);
}

function flow(d) {
  return pathInColor(d, slate, 'marker-end="url(#flow)"');
}

function crossValidation() {
  const chart = [];
  chart.push(box(15, 16, 314, 147, 'Internal Data', neutral, 22));
  chart.push(box(352, 16, 137, 147, ['Unseen', 'Data'], rose, 22));
  chart.push(box(15, 204, 202, 146, 'Train Data', green, 22));
  chart.push(box(217, 204, 112, 146, ['Test', 'Data'], amber, 22));
  chart.push(box(352, 204, 137, 146, ['Unseen', 'Data'], rose, 22));
  return svg(500, 361, 'Cross-validation data split', chart);
}

function crossPrediction() {
  const chart = [box(16, 24, 86, 222, 'Data', blue), arrow('M111 135 H172')];
  const positions = [196, 308, 420, 533];
  for (let fold = 0; fold < positions.length; fold++) {
    let y = 24;
    const x = positions[fold];
    for (const [height, estimate] of [[55.5 * fold, true], [55.5, false], [55.5 * (3 - fold), true]]) {
      if (height) chart.push(box(x, y, 95, height, estimate ? 'Estimate' : 'Predict', estimate ? blue : neutral));
      y += height;
    }
  }
  chart.push(arrow('M633 135 H694'), box(707, 24, 85, 222, 'Predict', neutral));
  return svg(800, 263, 'Cross-prediction folds', chart);
}

function kFold() {
  const chart = [];
  for (let row = 0; row < 6; row++) {
    const y = 12 + (row ? 4 + row * 26.5 : 0);
    if (row) chart.push(label(24, y + 9, 'Split ' + row, 'font-size="10"'));
    for (let column = 0; column < 5; column++) {
      const fill = row === 0 ? neutral : column === row - 1 ? blue : green;
      chart.push(box(49 + column * 50, y, 45, 18, 'Fold ' + (column + 1), fill, 10));
    }
  }
  return svg(300, 178, 'Five-fold cross-validation splits', chart);
}

function customers() {
  // Centers measured from the published raster. Its axes have no numeric scale.
  const points = [[52.5,37],[52.5,122],[56.3,68],[56.4,154],[64.1,97.5],[71.5,55.8],
    [78.4,136.9],[82,80.2],[82.1,111.3],[93.4,34],[97.5,63.1],[97.6,119],
    [104.5,88.2],[112,148.6],[116.5,47.9],[123.4,127],[123.5,103.6],[138,72],
    [145.2,143.5],[145.3,33.9],[145.3,111.2],[153.2,119.1],[162.5,63.1],[169.7,88.4],
    [177.2,153.8],[179.5,132.1],[184.6,116],[191.7,83.8],[195.3,58.1],[206.4,143.6],
    [213.5,111.2],[229.3,50],[229.3,77.2],[235.6,132],[242.7,103.6],[252.5,156.2]];
  return svg(300, 208, 'Customers and treatment levels', [
    flow('M30.5 172.5 V6'), flow('M30.5 172.5 H293'),
    ...points.map(([x, y]) => oval(x, y, 3.7, 3.7, '#e2ddd1', '', 10, '#8c8474')),
    label(151, 183, 'T (Price, Discount, Interest Rate…)', 'font-size="9"'),
    label(18, 92, 'Y (Sales, Conversion, Profit)', 'font-size="9" transform="rotate(-90 18 92)"'),
  ]);
}

function syntheticControl() {
  const serif = 'font-family="Georgia, serif" font-style="italic"';
  const curve = 'M55 274 C58 252 82 242 99 237 C119 231 135 243 152 236 C181 223 197 192 226.5 186';
  return svg(500, 369, 'Synthetic control intervention and potential outcomes', [
    arrow('M55 312 V45', 'stroke-width="1.7"'), arrow('M55 312 H460', 'stroke-width="1.7"'),
    path('M226.5 46 V307', 'stroke-width="1.3" stroke-dasharray="1 7"'),
    label(226.5, 31, 'Intervention', 'font-size="18"'),
    label(25, 65, 'Y', 'font-size="19"'), label(437, 344, 'T', 'font-size="19"'),
    pathInColor(curve + ' C250 182 273 189 302 186 C332 186 351 157 372 149 C394 141 426 173 443 156', ink, 'stroke-width="1.65"'),
    pathInColor('M226.5 186 C257 188 271 174 287 162 C300 151 314 154 326 144 C351 123 366 108 386 102 C408 94 424 113 445 102', rust, 'stroke-width="1.75"'),
    path('M409 110 V146', 'marker-start="url(#arrow)" marker-end="url(#arrow)" stroke-width="1.3"'),
    label(467, 99, 'Y<tspan baseline-shift="sub" font-size="10">jt</tspan><tspan dx="-8" baseline-shift="super" font-size="11">N</tspan>', serif),
    label(467, 157, 'Y<tspan baseline-shift="sub" font-size="10">jt</tspan><tspan dx="-8" baseline-shift="super" font-size="11">I</tspan>', serif),
    label(420, 128, 'τ<tspan baseline-shift="sub" font-size="10">1t</tspan>', serif),
  ]);
}

function graphFlow() {
  const chart = [];
  for (const [source, conditioned] of [[122, false], [286, true]]) {
    chart.push(arrow(`M47 ${source} H135`), arrow(`M173 ${source} H262`));
    for (const [index, x] of [30, 156, 282].entries()) chart.push(oval(x, source, 17.5, 17.5, index === 1 && conditioned ? '#b8b2a8' : paper, '', 14, ink));
  }
  chart.push(flow('M127 94 H195'), flow('M185 150 H116'), flow('M104 266 H134'), flow('M209 307 H178'));
  chart.push(pathInColor('M138 260 V272 M174 301 V313', slate));
  for (const y of [28, 186]) {
    chart.push(arrow(`M405 ${y + 15} L363 ${y + 91}`), arrow(`M423 ${y + 15} L467 ${y + 91}`));
    chart.push(arrow(`M556 ${y + 15} L599 ${y + 91}`), arrow(`M664 ${y + 15} L622 ${y + 91}`));
    const nodes = [[415, y], [352, y + 108], [478, y + 108], [547, y], [673, y], [610, y + 108]];
    chart.push(...nodes.map(([x, cy], index) => oval(x, cy, 17.5, 17.5, y === 186 && (index === 0 || index === 5) ? '#b8b2a8' : paper, '', 14, ink)));
  }
  chart.push(pathInColor('M387 94 Q415 42 443 94', slate, 'marker-start="url(#flow)" marker-end="url(#flow)"'));
  chart.push(flow('M369 222 L386 193'), flow('M462 222 L445 193'));
  chart.push(pathInColor('M383 189 L392 194 M439 194 L448 189', slate));
  chart.push(flow('M567 102 L583 128'), flow('M653 102 L637 128'));
  chart.push(pathInColor('M579 134 L587 129 M633 129 L641 134', slate));
  chart.push(pathInColor('M582 228 Q610 282 638 228', slate, 'marker-start="url(#flow)" marker-end="url(#flow)"'));
  return svg(700, 321, 'Open and blocked paths in causal graphs', chart);
}

function augmentedData() {
  const chart = [arrow('M163 66 V121')];
  for (const [y, numbers] of [[9, [1,2,3,4,5,6,7,8,9]], [144, [1,2,3,4,5,6,7]], [211, [1,2,3,4,5,6,8]], [278, [1,2,3,4,5,6,9]]]) {
    chart.push(...numbers.map((num, index) => box(26.5 + index * 37.6, y, 37.6, 31, num, num > 6 ? amber : neutral, 18)));
  }
  return svg(380, 334, 'Augmenting pre-treatment observations with one post-treatment time', chart);
}

function propensityExperiment() {
  const fields = ['Customer', 'Features', '(Ex:', 'Age,', 'Income', '…)'];
  return svg(400, 263, 'Assigning an email probability using customer features', [
    oval(155.5, 36, 56, 22.5, amber), textBlock(155.5, 36, ['Business', 'Intuition'], 16),
    rect(30, 101, 88, 135), rect(250, 101, 88, 135), rect(338, 101, 42, 135, rose),
    textBlock(37, 169, fields, 16, 'style="text-anchor:start"'),
    textBlock(257, 169, fields, 16, 'style="text-anchor:start"'),
    label(359, 168.5, 'Email Probability', 'transform="rotate(-90 359 168.5)"'),
    arrow('M118 168.5 H248'), arrow('M153 59 C147 124 138 139 214 164'),
  ]);
}

function slices(satisfaction) {
  const height = satisfaction ? 160 : 173;
  const points = satisfaction ? [[48.1,51,0],[58,78.4,1],[65.9,60.4,0],[79.4,102.2,1],[87.2,92.3,1],
    [96.9,122.9,0],[115.1,115.1,0],[123,132.5,0],[148.3,122.9,0],[176,129.5,0],
    [180.2,145.6,0],[212,132.5,0],[238.9,137.3,0]] : [[59.1,140,0],[62.6,122.2,0],
    [86.9,101.1,1],[110.4,73.9,0],[114.6,96.6,1],[135.2,73.9,0],[143.1,51.1,0],[173.2,51.1,0],
    [190.3,66.6,0],[206.1,88.5,1],[214,66.5,0],[230.9,106.9,1],[237.9,93.1,1],[254.6,122.2,0]];
  const left = satisfaction ? 35 : 33;
  const right = satisfaction ? 263 : 298;
  const [top, bottom] = satisfaction ? [76.5, 110] : [83.5, 117];
  return svg(300, height, satisfaction ? 'Satisfaction slice' : 'Net Value slice', [
    arrow(`M${left} ${height - 13} V${satisfaction ? 5 : 12}`), arrow(`M${left} ${height - 13} H294`),
    path(`M${left} ${top} H${right} M${left} ${bottom} H${right}`, 'stroke-dasharray="1 3"'),
    label(20, height / 2 - 2, satisfaction ? 'Satisfaction' : 'Net Value', `font-size="15" transform="rotate(-90 20 ${height / 2 - 2})"`),
    pathInColor(satisfaction ? 'M64 77 L89 105' : 'M84 111 L114 84 M218 84 L242 113', '#557752', 'stroke-width="1.35"'),
    ...points.map(([x, y, selected]) => oval(x, y, 3.7, 3.7, selected ? '#bda4c7' : slate, '', 14, selected ? '#775680' : '#2e4d62')),
  ]);
}

function causalGraphs(number) {
  const chart = [];
  if (number === 1) {
    chart.push(arrow('M77 67 L55 123'), arrow('M92 67 C101 111 109 173 93 235'), arrow('M55 179 L77 235'));
    chart.push(oval(87, 40, 42, 28, neutral, 'X', 20), oval(44, 152, 42, 28, neutral, 'T', 20), oval(87, 263, 42, 28, neutral, 'Y', 20));
    for (const [x, y, red] of [[301, 26, false], [508, 30, true]]) {
      chart.push(arrow(`M${x-8} ${y+20} L${x-24} ${y+62}`), arrow(`M${x+5} ${y+20} Q${x+19} ${y+82} ${x+5} ${y+146}`),
        arrow(`M${x-25} ${y+104} L${x-7} ${y+147}`), arrow(`M${x} ${y+188} v42`));
      chart.push(oval(x, y, 31, 21, neutral, 'X', 16), oval(x-31, y+83, 31, 21, neutral, 'T', 16),
        oval(x, y+167, 47, 21, red ? rose : neutral, 'M(T, X)', 16, red ? rust : rule), oval(x, y+250, 31, 20, neutral, 'Y', 16));
    }
    return svg(559, 300, 'Causal graphs with joint covariates and treatment', chart);
  }
  if (number === 2) {
    for (const [x, y, red] of [[131, 65, false], [411, 61, true], [717, 61, true]]) {
      chart.push(arrow(`M${x-14} ${y+29} L${x-50} ${y+94}`), arrow(`M${x+14} ${y+29} L${x+50} ${y+94}`),
        arrow(`M${x-50} ${y+153} L${x-15} ${y+218}`), arrow(`M${x+50} ${y+153} L${x+15} ${y+218}`));
      chart.push(oval(x, y, 47, 31, neutral, 'X', 22), oval(x-65, y+123, 47, 31, neutral, 'T', 22),
        oval(x+65, y+123, 54, 31, red ? rose : neutral, 'M(X)', 22, red ? rust : rule), oval(x, y+246, 47, 31, neutral, 'Y', 22));
    }
    chart.push(flow('M643 152 C646 57 626 7 711 7 C807 7 799 56 801 152'));
    return svg(856, 350, 'Causal graphs with an estimated covariate function', chart);
  }
  for (const [x, red] of [[190, false], [490, true]]) {
    chart.push(arrow(`M${x} 82 V144`), arrow(`M${x-117} 207 L${x-83} 272`), arrow(`M${x-15} 207 L${x-50} 272`));
    chart.push(oval(x, 51, 47.5, 31.5, neutral, 'X', 22), oval(x-133, 177, 48, 31.5, neutral, 'T', 22),
      oval(x, 177, 55, 31.5, red ? rose : neutral, 'M(X)', 22, red ? rust : rule), oval(x-67, 303, 47.5, 31.5, neutral, 'Y', 22));
  }
  return svg(556, 350, 'Causal graphs with independent treatment and covariates', chart);
}

function fixedEffects(person) {
  const chart = [];
  const y = person ? 227 : 137;
  const xs = person ? [72,229,383,544] : [63,221,377,539];
  const centralY = person ? 119 : 27;
  const centerX = person ? 306 : 299;
  const outcomeY = [y+131, y+131, y+135, y+131];
  for (let index = 0; index < xs.length; index++) {
    const x = xs[index];
    const top = y - 22;
    const bottom = outcomeY[index] - 22;
    const dx = x < centerX ? -1 : 1;
    const beyond = index === 0 || index === 3;
    const sourceX = centerX + (beyond ? 42 * dx : 2 * dx);
    const targetX = x + (beyond ? 0 : -32 * dx);
    chart.push(arrow(`M${sourceX} ${centralY + (beyond ? 17 : 24)} L${targetX} ${bottom}`, 'stroke-width="1.7"'));
    chart.push(arrow(`M${centerX + 42 * dx} ${centralY+17} L${x} ${top}`));
    chart.push(arrow(`M${x} ${y+22} V${bottom}`));
    chart.push(oval(x, y, 45.5, 22.5, index < 2 ? neutral : purple, 'Marriage', 12),
      oval(x, outcomeY[index], 45.5, 22.5, index < 2 ? amber : green, 'Income', 12));
    chart.push(label(x, person ? 413 : 325, 'T=' + index, 'font-size="16"'));
    if (index < 3) chart.push(path(`M${(x+xs[index+1])/2} ${y-20} V${person ? 428 : 339}`, 'stroke-dasharray="1 3"'));
  }
  if (person) {
    chart.push(arrow('M197 52 L304 94'), arrow('M306 60 V94'), arrow('M416 52 L308 94'));
    chart.push(oval(150, 36, 67, 25, blue, 'DNA', 16), oval(306, 36, 57, 25, blue, 'Beauty', 16),
      oval(467, 36, 67, 25, blue, 'Intelligence', 16), oval(centerX, centralY, 57, 25, rose, 'Person', 16));
  } else chart.push(oval(centerX, centralY, 57, 25, blue, 'Beauty', 16));
  return svg(600, person ? 438 : 357, person ? 'Unobserved traits and time-varying outcomes' : 'Fixed effects over four periods', chart);
}

function learner(split) {
  const height = split ? 319 : 321;
  const divider = split ? 298 : 291;
  const chart = [path(`M${divider} 7 V${height-7}`, 'stroke-dasharray="1 5"'),
    label(divider-34, 21, 'Training'), label(divider+41, 21, 'Predicting')];
  if (split) {
    chart.push(box(12,96,65,56,'X',blue,13), box(12,152,65,20,'T',amber,13));
    chart.push(arrow('M83 136 L103 105'), arrow('M83 140 L103 171'));
    for (let treatment = 0; treatment <= 1; treatment++) {
      const y = 70 + treatment * 98;
      const x = 432 + treatment * 119;
      const model = 'M' + treatment + '(X)';
      chart.push(box(114,y,65,27,'X',blue,12), box(114,y+27,65,20,'T='+treatment,amber,12));
      chart.push(arrow(`M184 ${y+22} H208`), oval(236,y+22,27.5,22.5,neutral,model,10));
      chart.push(box(x-33,41,65,57,'X',blue,12), arrow(`M${x} 98 V133`));
      chart.push(oval(x,156,27.5,22.5,neutral,model,10), arrow(`M${x} 179 V202`));
      chart.push(box(x-33,202,65,28,'y*|T='+treatment,amber,12));
      chart.push(arrow(`M${x} 230 L${490 + treatment * 2} 267`));
    }
    chart.push(box(458,267,65,28,'CATE',green,12));
  } else {
    chart.push(box(12,85,95,100,'X',blue,13), box(12,185,95,35,'T',amber,13));
    chart.push(arrow('M120 157 H171'), oval(223,157,39.5,28,neutral,'M(X,T)',13));
    chart.push(oval(494,167,39.5,28,neutral,'M(X,T)',13));
    for (let treatment = 0; treatment <= 1; treatment++) {
      const x = 435 + treatment * 122;
      const dx = treatment ? -1 : 1;
      chart.push(box(x-36,26,70,61,'X',blue,12), box(x-36,87,70,21,'T='+treatment,amber,12));
      chart.push(arrow(`M${x-4*dx} 114 C${x+16*dx} 145 ${x+54*dx} 172 ${x} 211`));
      chart.push(box(x-36,216,70,30,'y*|T='+treatment,amber,12));
      chart.push(arrow(`M${x} 246 L${495+2*treatment} 286`));
    }
    chart.push(box(463,286,69,30,'CATE',green,12));
  }
  return svg(600, height, split ? 'T-learner training and prediction' : 'S-learner training and prediction', chart);
}

function alwaysTakers() {
  const chart = [];
  for (const [x, y, top, bottom, comparison] of [[63,188,79,324,194],[425,195,117,276,569]]) {
    const second = x > 100;
    const outX = second ? 600 : 238;
    const topEndY = second ? 117 : 80;
    chart.push(arrow(`M${x+42} ${y-36} L${outX-60} ${topEndY}`, 'stroke-width="1.7"'));
    chart.push(arrow(`M${x+42} ${y+36} L${outX-60} ${bottom}`, 'stroke-width="1.7"'));
    chart.push(oval(x,y,58.5,50.5,neutral,'Population'), oval(outX,top,58.5,50.5,green,'Treated'),
      oval(outX,bottom,58.5,50.5,blue,'Control'));
    const y1 = second ? 171 : 129;
    const y2 = second ? 225 : 268;
    chart.push(path(`M${comparison-8} ${y1} h16 m-8 0 V${y2} m-8 0 h16`, 'stroke-width="1.3"'));
    chart.push(textBlock(second ? 640 : 257, second ? 197 : 195,
      ['E[Y|Assigned =1]', '-', 'E[Y|Assigned =0]'], 16, 'font-size="13"'));
    if (second) chart.push(oval(outX,246,31,20,green), textBlock(outX,246,['Always','Takers'],12,'font-size="9"'));
  }
  return svg(700,390,'Population, treatment assignment and always takers',chart);
}

function orthogonalization() {
  const chart = [label(330,25,'Orthogonalization','font-size="16"'), label(474,25,'Causal Modeling','font-size="16"'),
    path('M403 7 V439','stroke-dasharray="1 5"'),
    box(8,196,109,73,'X',blue), box(8,269,109,24,'T',amber), box(8,293,109,25,'Y',green),
    arrow('M132 252 L166 212'), arrow('M132 261 L166 301'),
    arrow('M356 74 L459 232'), arrow('M356 166 L459 232'),
    arrow('M356 329 L459 255'), arrow('M356 423 L459 255'),
    box(460,146,175,73,'X',blue), box(460,219,175,26,'T-res','#efc7b8'), box(460,245,175,23,'Y-res',rose),
    arrow('M547 269 V307'), oval(548,335,63,26.5,neutral,'M-Final(X)',12),
    arrow('M611 335 H685'), box(686,317,109,36,'CATE',green)];
  for (let index = 0; index < 2; index++) {
    const x = 182 + index * 87;
    chart.push(box(x,61,87,26,'T̂',index ? amber : '#f0dbab'), oval(x+43.5,120.5,43.5,16,neutral,'Mt(X)',12));
    chart.push(box(x,154,87,26,'T',index ? '#f0dbab' : amber), box(x,180,87,35,'X',index ? '#a9c4d6' : blue));
    chart.push(box(x,280,87,36,'X',index ? '#a9c4d6' : blue), box(x,316,87,25,'Y',index ? green : '#bed5b9'));
    chart.push(oval(x+43.5,374,43.5,16,neutral,'My(X)',12), box(x,410,87,25,'Ŷ',index ? '#bed5b9' : green));
  }
  chart.push(arrow('M288 152 L227 87'), arrow('M253 153 L313 87'), arrow('M286 343 L228 410'), arrow('M252 343 L312 410'));
  return svg(800,442,'Orthogonalization and causal modeling',chart);
}

function quarterOfBirth() {
  const chart = [pathInColor('M230 2 V265',rust,'stroke-dasharray="6 4"'),
    arrow('M193 87 H661'), arrow('M37 221 H495'),
    label(196,102,'Birthday','font-size="12"'), label(33,237,'Birthday','font-size="12"'),
    textBlock(661,121,['Dropout','Age'],16,'font-size="12"'), textBlock(498,253,['Dropout','Age'],16,'font-size="12"'),
    textBlock(230,302,['Enrolled','in','School'],18)];
  for (const [x,y] of [[9,22],[474,18],[9,152],[480,152]]) {
    chart.push(...[47,59,58,47].map((width,i,all) => box(x+all.slice(0,i).reduce((sum,n)=>sum+n,0),y,width,57,'Q'+(i+1),neutral,14)));
  }
  return svg(700,334,'Quarter of birth and school enrollment',chart);
}

function translation() {
  return svg(300,273,'Translation as a function',[
    label(150,27,'よろしくおねがいします','font-size="23" font-family="Hiragino Mincho ProN, Noto Serif CJK JP, serif"'),
    arrow('M162 84 V190','stroke-width="1.25"'),
    label(127,131,'F(x)','font-size="23" font-family="Georgia, serif"'),
    label(162,235,'Nice to meet you','font-size="23" font-family="Georgia, serif"'),
  ]);
}

function nonLinear() {
  return svg(300,165,'Ice cream sales and temperature',[
    arrow('M34 135 V7'), arrow('M34 135 H294'),
    path('M103 17 V135 M197 17 V135','stroke-dasharray="1 4"'),
    pathInColor('M50 122 C98 89 141 57 169 60 C193 60 220 81 266 114',ink,'stroke-width="1.2"'),
    label(18,69,'Ice Cream Sales','font-size="11" transform="rotate(-90 18 69)"'),
    label(157,152,'Temperature','font-size="11"'),
    label(64,81,'Too Cold',`font-size="11" fill="${slate}"`),
    label(149,38,'Just Right','font-size="11" fill="#436540"'),
    label(244,55,'Too Hot',`font-size="11" fill="${rust}"`),
  ]);
}

function extrapolation() {
  const chart = [];
  for (const [shift,title,right] of [[0,'Extrapolation',false],[440,'Interpolation',true]]) {
    chart.push(`<g transform="translate(${shift} ${right ? -2 : 0})">`);
    chart.push(label(191,42,title,'font-size="17"'),arrow('M38 293 V84','stroke-width="1.5"'),arrow('M38 293 H355','stroke-width="1.5"'),
      label(190,319,'retprice','font-size="16"'),label(23,188,'cigsale','font-size="16" transform="rotate(-90 23 188)"'));
    chart.push(...(right ? [path('M143 109 H238 L182 201Z','stroke-dasharray="1 6"'),arrow('M312 247 L202 179')] :
      [arrow('M149 116 L312 245'),arrow('M244 115 L317 242')]));
    chart.push(oval(143,109,8.5,8.5), oval(238,109,8.5,8.5), oval(181.5,200.5,8.5,8.5), oval(319,252,8.5,8.5,'#d6a9c1'),
      label(140,90,'Control 2','font-size="10"'),label(236,90,'Control 1','font-size="10"'),
      label(179,219,'Control 3','font-size="10"'),label(321,270,'Treated','font-size="10"'),'</g>');
  }
  return svg(800,340,'Extrapolation and interpolation',chart);
}

function optimalDerivative() {
  // Marks and turning point are traces in figure coordinates, with no numeric coupon scale in the source.
  const points = [[111,211],[116,183],[153,150],[189,107],[195.5,143],[227,107],[239,71.5],
    [285,71.5],[311,95.5],[335,130],[347.5,95.5],[383.5,137.5],[409,183]];
  return svg(500,577,'Coupon optimum and derivative',[
    arrow('M71.5 242 V8','stroke-width="1.7"'), arrow('M71.5 242 H468','stroke-width="1.7"'),
    arrow('M65 530 V296','stroke-width="1.7"'), arrow('M65 530 H463','stroke-width="1.7"'),
    path('M265 60 V517 M84 429.5 H265','stroke-dasharray="1 4"'),
    pathInColor('M98 212 C157 154 210 77 266 77 C310 77 375 147 426 199','#557752','stroke-width="3"'),
    pathInColor('M102 341 L422 514',rust,'stroke-width="3"'),
    ...points.map(([x,y])=>oval(x,y,6,6,slate,'',14,'#2e4d62')),
    label(59,126,'Net Value','font-size="20" transform="rotate(-90 59 126)"'),
    label(38,412,"Net Value′(Coupon)",'font-size="20" transform="rotate(-90 38 412)"'),
    label(255,265,'Coupon','font-size="20"'),label(250,554,'Coupon','font-size="20"'),label(74,428,'0','font-size="19"'),
  ]);
}

function linearApproximation() {
  const chart = [rect(53.5,8.5,376,244,'#f5f4ed')];
  for (let tick = 0; tick <= 6; tick++) {
    const x = 70 + 58.65 * tick;
    chart.push(pathInColor(`M${x} 9 V252`,'#d9d4c8'),label(x,268,String(tick*20),'font-size="12"'));
  }
  for (let tick = 0; tick <= 5; tick++) {
    const y = 251.5 - 42.8 * tick;
    chart.push(pathInColor(`M54 ${y} H429`,'#d9d4c8'),label(43,y,String(20+20*tick),'font-size="12" style="text-anchor:end"'));
  }
  chart.push(label(11,130,'Sales','font-size="13" transform="rotate(-90 11 130)"'),label(242,285,'Discount','font-size="13"'),
    pathInColor('M70 243 C75 191 115 161 153 136 C181 118 219 98 258 81 C304 59 367 34 412 19',rust,'stroke-width="1.8"'),
    pathInColor('M59 247 L113.5 147 M160 123.6 L339 39',slate,'stroke-width="1.5"'));
  return svg(450,299,'Local linear approximations of the sales curve',chart);
}

function machineLearningFlow() {
  const baseFields = ['customer_id','region','income','age','net_value'];
  const target = [
    [9995,39,4570,30,'?',-36],[9996,2,1588,33,'?',-14],[9997,29,780,31,'?',-90],
    [9998,44,1832,25,'?',11],[9999,17,2169,28,'?',116],
  ];
  const training = [[0,30,1025,24,130],[1,41,1649,26,10],[2,18,2034,33,-6],[3,20,1859,35,136],[4,1,1243,26,-8]];
  const chart = [
    ...gridTable(4,135,[68,41,46,31,59],baseFields,training),
    ...gridTable(403,5,[70,42,47,30,56],baseFields,target.map(row=>row.slice(0,5))),
    ...gridTable(362,255,[68,41,46,31,61,84],[...baseFields,'net_value_pred'],target),
    arrow('M269 206 H418','stroke-width="1.4"'),label(343,191,'Training','font-size="15"'),
    oval(463,204,28,24,amber,'ML',14),arrow('M530 145 C476 187 451 199 542 228 L613 254','stroke-width="1.3"'),
    label(556,222,'Predicting','font-size="15" transform="rotate(22 556 222)"'),
  ];
  return svg(700,395,'Machine learning training and prediction tables',chart);
}

function gridTable(x, y, widths, fields, rows) {
  const chart = [];
  const width = widths.reduce((sum,n)=>sum+n,0);
  chart.push(path(`M${x} ${y+22} h${width}`));
  for (const [rowIndex,row] of [fields,...rows].entries()) {
    const vertical = y + 11 + rowIndex * 22;
    if (rowIndex % 2 === 1) chart.push(`<rect x="${x}" y="${vertical-11}" width="${width}" height="22" fill="${neutral}"/>`);
    let column = x;
    for (const [index,datum] of row.entries()) {
      const field = widths[index];
      chart.push(rowIndex === 0 ? label(column+field/2,vertical,datum,'font-size="10" font-weight="650"') :
        label(column+field-5,vertical,datum,'font-family="ui-monospace, monospace" font-size="10" style="text-anchor:end"'));
      column += field;
    }
  }
  return chart;
}

function blockPermutation() {
  const chart = [label(489,18,'Post-treatment'),
    path('M459 49 Q459 41 472 41 H480 Q489 41 489 34 Q489 41 499 41 H508 Q520 41 520 49'),
    label(244,66,'û=','font-size="25" font-family="Georgia, serif" font-style="italic"')];
  chart.push(...Array.from({length:8},(_,i)=>box(271+31.25*i,53,31.25,26,i+1,i>5?amber:neutral,14)));
  const nodes = [[190,241],[218,308],[190,385],[111,414],[35,385],[7,308],[35,241],[111,207]];
  for (const [offset, permutation, values] of [[0,1,[1,2,3,4,5,6,7,8]],[264,2,[8,1,2,3,4,5,6,7]],[579,8,[2,3,4,5,6,7,8,1]]]) {
    chart.push(label(offset+127,323,'Permutation-'+permutation,'font-size="14"'));
    chart.push(oval(offset+86,237,68,30,'none').replace('<ellipse ','<ellipse transform="rotate(-24 '+(offset+86)+' 237)" '));
    chart.push(label(offset+67,202,'Calculate S(u)',`font-size="14" transform="rotate(-24 ${offset+67} 202)"`));
    chart.push(...nodes.map(([x,y],i)=>box(x+offset,y,29,24,values[i],values[i]>=7?amber:neutral,14)));
  }
  chart.push(label(550,321,'⋯','font-size="21"'));
  return svg(830,456,'Block permutations of residuals',chart);
}

function xLearner() {
  const chart = [label(772,45,'First Stage','font-size="39"'),label(1088,45,'Second Stage','font-size="39"'),
    path('M918 88 V1030','stroke-width="3" stroke-dasharray="4 13"'),
    box(7,274,215,185,'X',blue,39),box(7,459,215,63,'T',amber,39),box(7,522,215,65,'Y',green,39),
    arrow('M240 407 L307 304','stroke-width="2"'), arrow('M243 420 L310 523','stroke-width="2"'),
    arrow('M120 622 C233 708 330 896 540 953 C770 1009 1137 981 1427 988','stroke-width="2"'),
    oval(1528,977,91,73,neutral,'PS(X)',31),
    arrow('M1592 925 L1809 458','stroke-width="2"'),
    box(1812,342,180,221,['CATE','Final'],green,36),label(804,424,'Prediction','font-size="26"')];
  for (const [index,leftX,leftY,modelX,modelY,caseX,caseY] of [[0,342,187,793,275,1012,315],[1,333,512,782,594,1017,480]]) {
    chart.push(box(leftX,leftY,215,91,'X',blue,38),box(leftX,leftY+91,215,64,'T='+index,amber,38),box(leftX,leftY+155,215,65,'Y'+index,green,38));
    chart.push(arrow(`M${leftX+236} ${modelY} H${modelX-106}`,'stroke-width="2"'),label(leftX+282,modelY-20,'Train','font-size="25"'));
    chart.push(oval(modelX,modelY,90,73,rose,'M'+index+'(X)',31));
    chart.push(box(caseX,caseY,120,91,'X',blue,38),box(caseX+120,caseY,174,91,'CATE '+index,green,36));
    chart.push(arrow(`M${caseX+307} ${caseY+48} H${1430+index*5}`,'stroke-width="2"'),label(caseX+355,caseY+21,'Train','font-size="25"'));
    chart.push(oval(1591,caseY+49,153,73,purple,'MTAU'+index+'(X)',29));
    chart.push(arrow(`M1744 ${caseY+49} L1811 452`,'stroke-width="2"'));
  }
  chart.push(box(990,162,214,65,'M1(X)',green,38),label(1245,195,'-','font-size="39"'),box(1286,162,214,65,'Y0',green,38),
    box(990,663,214,64,'Y1',green,38),label(1245,693,'-','font-size="39"'),box(1301,663,215,64,'M0(X)',green,38));
  chart.push(arrow('M1098 228 L1216 313','stroke-width="2"'),arrow('M1392 228 L1222 313','stroke-width="2"'),
    arrow('M1098 662 L1220 572','stroke-width="2"'),arrow('M1407 662 L1226 572','stroke-width="2"'),
    arrow('M845 541 L988 195','stroke-width="2"'),arrow('M859 320 C911 499 931 619 983 761 C1029 836 1150 761 1280 717','stroke-width="2"'));
  return svg(2006,1080,'X-learner training and estimation stages',chart);
}

function brace(x, y1, y2) {
  const middle = (y1+y2)/2;
  return path(`M${x} ${y1} Q${x+10} ${y1} ${x+10} ${y1+11} V${middle-11} Q${x+10} ${middle} ${x+20} ${middle} Q${x+10} ${middle} ${x+10} ${middle+11} V${y2-11} Q${x+10} ${y2} ${x} ${y2}`);
}

function axes(x, y, xEnd, yEnd, xLabel, yLabel, size = 14) {
  const cx = x + (xEnd - x) / 2;
  const cy = y - (y - yEnd) / 2;
  return [arrow(`M${x} ${y} H${xEnd}`), arrow(`M${x} ${y} V${yEnd}`),
    label(cx, y+1.35*size, xLabel, `font-size="${size}"`),
    label(x-1.1*size, cy, yLabel, `font-size="${size}" transform="rotate(-90 ${x-1.1*size} ${cy})"`)];
}

function anatomy(edition) {
  const sizes = [[500,200],[694,200],[620,250],[937,230]];
  const [width,height] = sizes[edition-1];
  const chart = [];
  const formula = 'font-family="Georgia, serif" font-style="italic"';
  const a1 = [[69,104],[69,136],[85,124],[93,93],[101,136],[108,116],[108,72],[119,93],[129,113],[145,100]];
  const a2 = [[132,72],[146,51],[156,76],[170,30],[179,55],[186,78],[197,31],[212,55],[220,31],[232,47]];
  const a3 = [[80,131],[102,157],[132,146],[146,117],[179,124],[201,112],[213,52],[225,84],[248,52],[295,75]];
  const a4 = [[80,156],[112,101],[123,158],[131,72],[159,131],[164,84],[182,61],[235,96],[268,67],[279,35]];
  const r = edition === 1 || edition === 2 ? 3.85 : 5;
  const point = (x,y,f,stroke=rule) => oval(x+.35,y+.35,r,r,f,'',14,stroke);
  const groups = { b:[slate,'#29495e'], r:[rust,'#84351f'], p:['#ebc8ba','#a86653'], l:['#b3cad8','#6a8b9e'] };
  if (edition === 1 || edition === 3) {
    const bigger = edition === 3;
    chart.push(...(bigger ? axes(33,209,329,7,'School Tuition','Test Score',18) : axes(33,164,256,11,'School Tuition','Test Score',13)));
    chart.push(...(bigger?a3:a1).map(([x,y])=>point(x,y,...groups.b)),...(bigger?a4:a2).map(([x,y])=>point(x,y,...groups.r)));
    const bx = bigger ? 310 : 245;
    const groupTextX = bigger ? 383 : 294;
    chart.push(brace(bx,bigger?44:20,bigger?153:84),brace(bx,bigger?75:78,bigger?160:143));
    chart.push(label(groupTextX,bigger?96:52,'E[Y|T = 1]',`${formula} font-size="${bigger?16:12}"`));
    chart.push(label(groupTextX,bigger?122:111,'E[Y|T = 0]',`${formula} font-size="${bigger?16:12}"`));
    if (bigger) chart.push(path('M421 90 Q427 90 427 96 V103 Q427 107 432 108 Q427 109 427 113 V121 Q427 126 421 126'));
    else chart.push(brace(330,47,114));
    chart.push(label(bigger?522:424,bigger?108:80,'E[Y|T = 1] − E[Y|T = 0]',`${formula} font-size="${bigger?15:12}"`));
  } else {
    const bigger = edition === 4;
    chart.push(...(bigger ? axes(27,194,294,11,'School Tuition','Test Score',15) : axes(27,162,238,17,'School Tuition','Test Score',12)));
    chart.push(...(bigger ? axes(418,196,686,13,'School Tuition','Test Score',15) : axes(348,163,555,21,'School Tuition','Test Score',12)));
    const pairs = bigger ? [[69.5,106,122.8,'p','b'],[69.5,144.8,160.1,'r','l'],[89.1,132,146.5,'p','b'],[98.6,95.9,110,'r','l'],
      [108,147,160.3,'r','l'],[116,68.8,83.8,'r','l'],[116.1,119.5,136.5,'p','b'],[129.2,95.2,109.9,'p','b'],[140.8,122.9,135.9,'r','l'],
      [145.4,80.4,97,'r','l'],[159.5,103,116.6,'p','b'],[161.3,59.5,72.1,'r','l'],[179.3,90.4,105.9,'p','b'],[189.8,34.7,51.5,'p','b'],
      [200.7,64.3,79.6,'p','b'],[209.3,91.1,108.8,'r','l'],[222,35.4,51.5,'p','b'],[240.1,64.4,83.5,'r','l'],[249.5,35.4,51.5,'r','l'],[263.8,54.7,72.2,'p','b']]
      : [[60.6,92.1,105.6,'p','b'],[60.6,123,135,'p','b'],[76,112.9,124.3,'p','b'],[83.7,84.2,95.4,'p','b'],[91,124.8,135.2,'p','b'],
      [97.4,62.9,75,'p','b'],[97.4,103,116.4,'p','b'],[108,83.9,95.3,'p','b'],[116.9,105.8,115.9,'p','b'],[120.6,72,85.2,'r','l'],
      [131.8,89.9,100.8,'p','b'],[133.1,55.7,65.7,'r','l'],[147.5,80,92.2,'r','l'],[155.7,36,49.2,'r','l'],[164.1,59.6,71.3,'r','l'],
      [171.1,80.6,94.4,'r','l'],[181.1,36.7,49.2,'r','l'],[195.4,59.5,74.7,'r','l'],[202.9,36.7,49.2,'r','l'],[214,51.8,65.8,'r','l']];
    for (const [x,top,bottom,c,d] of pairs) chart.push(path(`M${x} ${top} V${bottom}`),point(x,top,...groups[c]),point(x,bottom,...groups[d]));
    const potentials = bigger ? [[460.2,125,'b'],[460.4,162.4,'l'],[480,148.7,'b'],[489.5,112,'l'],[498.9,162.4,'l'],[507,85.9,'l'],[507,138.7,'b'],
      [520.1,112,'b'],[531.5,138,'l'],[536.3,99.1,'l'],[550.4,118.8,'b'],[552.2,74.3,'l'],[570.1,108,'b'],[580.7,53.7,'b'],[591.6,81.7,'b'],
      [600.5,110.9,'l'],[613,53.7,'b'],[631,85.6,'l'],[640.4,53.8,'l'],[654.6,74.4,'b']]
      : [[380.2,108,'b'],[380.2,137,'b'],[395.6,126.1,'b'],[402.9,97.8,'b'],[410.2,137,'b'],[416.4,77.7,'b'],[416.4,118.5,'b'],
      [426.8,97.9,'b'],[435.6,118,'b'],[439.1,87.9,'l'],[450.1,103.1,'b'],[451.5,68.7,'l'],[465.4,94.8,'l'],[473.6,52.8,'l'],
      [482,74.2,'l'],[489,97,'l'],[498.5,52.7,'l'],[512.6,77.2,'l'],[519.8,52.6,'l'],[530.9,68.7,'l']];
    chart.push(...potentials.map(([x,y,c])=>point(x,y,...groups[c])));
    const x = bigger ? 273 : 225;
    const y = bigger ? 64 : 61;
    chart.push(path(`M${x} ${y-11} q6 0 6 5 v2 q0 4 4 4 q-4 0 -4 4 v2 q0 6 -6 6`),
      label(bigger?312:257,y,'Y₁ − Y₀',`${formula} font-size="${bigger?15:12}"`));
    if (bigger) chart.push(brace(702,59,160),label(836,110,'E[Y₀|T = 0] = E[Y₀|T = 1]',`${formula} font-size="16"`));
    else chart.push(brace(537,45,100),brace(537,89,144),brace(629,67,123),label(593,72,'E[Y₀|T = 1]',`${formula} font-size="12"`),
      label(593,116,'E[Y₀|T = 0]',`${formula} font-size="12"`),label(667,95,'BIAS','font-size="12"'));
  }
  return svg(width,height,'Anatomy of causal effect and bias, figure '+edition,chart);
}

function cashflow(cascade) {
  const [height,x,zero,bottom,right,bars] = [
    [273,74,127,230,578,[[75,128,33,58],[118,128,33,21],[163,106,33,21],[212,96,34,31],[263,106,33,21],
      [312,101,33,26],[361,116,33,11],[401,128,33,11],[440,106,34,21],[483,101,33,26],[526,128,33,11]]],
    [235,85,108,196,517,[[86,109,29,50],[123,159,28,17],[162,157,28,17],[204,129,28,26],[246,111,28,17],
      [288,85,29,22],[328,74,28,9],[365,74,28,9],[397,66,28,17],[434,43,28,22],[471,42,28,9]]],
    [285,68,136,236,559,[[70,137,32,57],[111,194,33,20],[155,201,32,12],[203,189,33,11],[252,188,32,11],[298,188,33,11],[349,186,32,20]]],
  ][cascade];
  const negatives = [[0,1,7,10],[0,1,7,10],[0,1,4,6]][cascade];
  return svg(600,height,cascade?'Financial waterfall over time':'Cash flow over time',[
    arrow(`M${x} ${bottom} V${cascade===2?24:10}`,'stroke-width="1.5"'), arrow(`M${x} ${bottom} H${right}`,'stroke-width="1.5"'),
    path(`M${x} ${zero} H${right-5}`,'stroke-width="1.5" stroke-dasharray="1 6"'),
    label(x-9,zero,'0','font-size="16"'),label(x-40,zero-7,'$$$',`font-size="18" transform="rotate(-90 ${x-40} ${zero-7})"`),
    label((x+right)/2+20,bottom+19,'Time','font-size="17"'),
    ...bars.map(([x,y,w,h],i)=>rect(x,y,w,h,negatives.includes(i)?'#c9775e':'#84a6ba')),
  ]);
}

function counterfactualPredictions() {
  const curve = 'M56 84 C94 156 111 180 155 203 C218 233 303 233 403 239';
  const marks = [[508,92],[523,138],[569,169],[638,199],[699,215],[753,215],[806,230]];
  return svg(911,300,'Linear CATE approximation and counterfactual predictions',[
    ...axes(36,255,446,51,'Price','Sales',17),...axes(494,255,902,51,'Price','Sales',17),
    path(curve,'stroke-width="1.6" stroke-dasharray="1 6"'),`<g transform="translate(458 0)">${path(curve,'stroke-width="1.6" stroke-dasharray="1 6"')}</g>`,
    pathInColor('M55 113 L161 225',rust,'stroke-width="2"'),oval(112,168,8,8,'#bda4c7'),
    ...marks.map(([x,y],i)=>oval(x,y,8,8,i===2?'#bda4c7':'#d6a9c1')),
    label(235,194,'Linear CATE Approximation','font-size="13"'),label(729,173,'Counterfactual Predictions','font-size="13"'),
  ]);
}

function modelOptimization() {
  const chart = [...axes(40,234,408,19,'Coupon','Net Value',18)];
  for (const [i,y] of [43,92,141,189].entries()) {
    chart.push(path(`M41 ${y} H414`,'stroke-dasharray="1 3"'),label(455,y+21,'Band '+(i+1),'font-size="17"'));
  }
  const points = [[77,205],[81,180],[116,149],[149,109],[155,142],[184,109],[195,76],[237,76],
    [261,99],[284,131],[295,99],[328,138],[352,180]];
  chart.push(...points.map(([x,y])=>oval(x,y,5.6,5.6,slate,'',14,'#2e4d62')));
  chart.push(pathInColor('M166 75 L284 74 M125 120 H352 M88 169 L378 168 M53 210 H411','#75966f','stroke-width="2.5"'));
  return svg(500,275,'Coupon optimization by observed value band',chart);
}

function pValue() {
  const bell = 'M69 216 C144 216 158 203 183 169 C209 134 231 74 254 73 C276 74 307 145 327 176 C348 209 373 217 438 216';
  const chart = [arrow('M55 221 V67','stroke-width="1.6"'),
    path('M69 234 H440','stroke-width="1.6" marker-start="url(#arrow)" marker-end="url(#arrow)"'),
    label(29,144,'Probability density','transform="rotate(-90 29 144)"'),label(254,260,'Set of possible results'),
    label(254,22,'More likely observation'),arrow('M254 34 V56','stroke-width="1.3"'),path('M237 71 V62 H272 V71','stroke-width="1.4"'),
    path('M69 208 V199 H104 V208 M404 208 V199 H439 V208','stroke-width="1.4"'),
    textBlock(112,151,['Very un-likely','observations'],18),textBlock(405,151,['Very un-likely','observations'],18),
    arrow('M87 169 V193'),arrow('M422 169 V193'),
    `<path d="M320 165 L327 176 C348 209 373 217 438 216 H320Z" fill="#91b284"/>`,pathInColor(bell,ink,'stroke-width="4"'),
    path('M320 165 V231','stroke-dasharray="3 4"'),oval(320,234,4,4,rust,'',14,'#84351f'),
    pathInColor('M283 205 L314 229',rust,'marker-end="url(#arrow)"'),
    textBlock(246,203,['Observed','data point'],16,`fill="${rust}"`),
    label(350,81,'P-value','fill="#436540" font-weight="700"'),arrow('M349 91 C332 120 336 153 345 192','stroke-width="1.4"'),
    arrow('M345 192 L331 212'),arrow('M345 192 L352 215'),arrow('M345 192 L327 187'),
    label(254,304,'A <tspan fill="#436540" font-weight="700">p-value</tspan> (shaded green area) is the probability of an observed'),
    label(254,322,'(or more extreme) result assuming that the null hypothesis is true.'),
  ];
  return svg(500,332,'P-value and the null distribution',chart);
}

function cumulative(gain) {
  const top = gain ? [[42,128,74,74,90],[270,124,34,59,87],[502,125,87,87,87]] : [[38,132,78,78,110],[268,128,46,82,121],[503,129,91,91,91]];
  const bottom = gain ? [[42,341,330,310,303],[270,338,310,286,300],[502,338,330,316,300]] : [[38,334,281,281,297],[268,331,241,265,293],[503,331,294,294,294]];
  const names = ['Model-1','Model-2','Random Variable'];
  const chart = [];
  for (const [row,panels] of [top,bottom].entries()) {
    const head = row ? (gain?217:211) : (gain?5:8);
    for (const [index,[x,y,...bars]] of panels.entries()) {
      const w = [52.5,55.5,61.5][index];
      chart.push(arrow(`M${x} ${y} V${head}`),arrow(`M${x} ${y} H${x+w*3+13}`));
      chart.push(...bars.map((bar,i)=>rect(x+i*w,bar,w,y-bar,['#f0eee6','#e4edf2','#eee8db'][index])));
      chart.push(label(x+w*1.63,y+29,names[index]));
      if (gain && row) {
        chart.push(pathInColor(`M${x+2} ${y-1} L${x+w*2.6} ${bars[2]}`,slate,'stroke-width="1.8" stroke-dasharray="1 7"'));
        const lines = ['M44 338 C94 322 123 305 177 302','M275 335 C349 276 350 274 420 302','M503 337 L655 300'];
        chart.push(pathInColor(lines[index],rust,'stroke-width="1.65"'));
      }
    }
    const ylabel = row ? (gain?['Cumulative','Gain']:['Cumulative','Elasticity']) : (gain?['Cumulative','Elasticity']:['ATE']);
    const y = (head+panels[0][1])/2;
    chart.push(textBlock(18,y,ylabel,16,`transform="rotate(-90 18 ${y})"`));
  }
  return svg(700,gain?385:377,gain?'Cumulative elasticity and gain':'Average treatment effect and cumulative elasticity',chart);
}

function elasticity() {
  const points = [[45,101,11,8],[49,153,20,2],[52,193,5,14],[76,58,20,2],[84,109,10,15],[88,149,11,15],
    [128,83,20,1.5],[128,124,16,3.5],[128,163,17,11],[130,187,11,14],[179,64,20,2.2],[179,163,13,9],
    [182,112,5,14],[214,136,15,12],[223,190,20,2],[226,98,5,14],[264,155,20,2]];
  const chart = [flow('M21 213 V2'),flow('M21 213 H346'),label(184,227,'T','font-size="12"'),
    label(8,107,'Y','font-size="12" transform="rotate(-90 8 107)"')];
  for (const [x,y,dx,dy] of points) {
    chart.push(pathInColor(`M${x-dx} ${y+dy} L${x+dx} ${y-dy}`,slate),oval(x,y,4.6,5,'#ddad9c','',14,'#a86653'));
  }
  return svg(350,234,'Local elasticity around each observation',chart);
}

function elasticityPartition() {
  const marks = [[46,128,0],[46,42,0],[51,73,0],[51,162,2],[58,103,0],[66,61,0],[74,144,1],[77,118,1],
    [77,86,0],[89,38,0],[93,68,0],[93,126,1],[100,94,1],[108,156,2],[112,52,0],[120,134,2],[120,110,1],
    [134,78,1],[142,38,0],[142,118,1],[142,151,2],[150,126,2],[160,68,1],[167,94,1],[175,161,2],[177,139,2],
    [182,123,2],[190,89,1],[193,63,1],[205,151,2],[212,118,2],[228,55,1],[229,82,1],[235,139,2],[242,110,2],[252,164,2]];
  return svg(300,199,'Local elasticity split into three bands',[
    flow('M24 180 V10'),flow('M24 180 H292'),label(159,192,'T','font-size="10"'),
    label(12,95,'Y','font-size="10" transform="rotate(-90 12 95)"'),
    path('M25 155 C100 75 157 60 248 24 M28 173 C102 125 181 121 266 98'),
    ...bandPoints(marks,3.8),label(221,22,'Band 1','font-size="10"'),label(263,90,'Band 2','font-size="10"'),label(280,165,'Band 3','font-size="10"'),
  ]);
}

function bandPoints(marks,radius) {
  return marks.map(([x,y,i])=>oval(x,y,radius,radius*1.06,['#b7cbb0','#82a77a','#446a43'][i],'',14,['#789278','#54794a','#2e512c'][i]));
}

function elasticitySplit() {
  const groups = [
    [[37,37],[37,105],[41,62],[47,86],[54,52],[63,72],[74,35],[77,58],[94,46],[121,35]],
    [[317,99],[319,76],[331,83],[337,55],[352,68],[362,40],[368,76],[382,32],[387,55],[404,51],[407,28],[434,20],[434,44]],
    [[144,260],[184,256],[192,238],[207,252],[213,231],[230,260],[232,242],[236,229],[251,252],[257,225],[272,242],[277,219],[284,263]],
  ];
  const frames = [[17,116,186,13,95,130,10,72,154,105,'High','M22 103 C46 75 75 37 129 23'],
    [279,131,482,5,390,145,270,55,441,116,'Med','M306 90 C345 58 382 42 442 36'],
    [125,276,311,138,230,290,112,207,351,267,'Low','M137 270 C172 254 207 243 286 236']];
  const chart = [];
  for (const [i,[x,y,right,top,tx,ty,yx,yy,lx,ly,level,line]] of frames.entries()) {
    chart.push(flow(`M${x} ${y} V${top}`),flow(`M${x} ${y} H${right}`),label(tx,ty,'T','font-size="11"'),
      label(yx,yy,'Y',`font-size="11" transform="rotate(-90 ${yx} ${yy})"`));
    chart.push(pathInColor(line,rust),...bandPoints(groups[i].map(([x,y])=>[x,y,i]),i===2?2.7:3.1));
    chart.push(label(lx,ly,`Band ${i+1} = ${level} Elasticity`,'font-size="10"'));
  }
  return svg(500,298,'Elasticity within each band',chart);
}

function personalisedCoupons() {
  const points = [[49,142,0],[51,125,0],[59,113,0],[65,125,0],[70,104,0],[77,89,0],[83,107,0],[88,77,0],[91,99,0],[101,65,0],
    [107,77,0],[113,54,0],[119,71,0],[133,143,1],[135,126,1],[136,54,0],[137,71,0],[149,89,0],[149,69,0],[154,105,1],
    [161,91,0],[167,69,0],[172,78,1],[175,100,1],[179,113,0],[185,131,0],[185,96,0],[191,78,1],[191,107,0],[197,55,1],
    [197,143,0],[198,125,0],[220,55,1],[233,70,1],[245,92,1],[251,70,1],[269,97,1],[282,126,1]];
  return svg(350,193,'Coupon value with personalized choices',[
    arrow('M23 164 V4'),arrow('M23 164 H345'),path('M128 0 V164 M216 0 V164','stroke-dasharray="1 4"'),
    label(14,83,'Net Value','font-size="12" transform="rotate(-90 14 83)"'),label(176,185,'Coupon','font-size="13"'),
    label(128,173,'5','font-size="13"'),label(216,173,'10','font-size="13"'),
    ...points.map(([x,y,g])=>oval(x,y,2.7,3.8,g?'#82a77a':slate,'',14,g?'#54794a':'#29495e')),
  ]);
}

function waitingTime() {
  const scatter = [[55,105],[58,92],[76,77],[93,57],[96,73],[111,57],[117,40],[139,40],[151,51],[163,67],[169,51],[186,71],[198,92],
    [311,44],[319,65],[324,51],[335,83],[340,75],[348,98],[361,92],[367,105],[386,98],[407,103],[410,115],[433,105],[454,109]];
  return svg(500,291,'Coupon and waiting time, outcomes and derivatives',[
    arrow('M37 120 V11'),arrow('M37 120 H227'),arrow('M301 118 V10'),arrow('M301 118 H491'),
    arrow('M33 254 V146'),arrow('M33 254 H224'),arrow('M298 252 V145'),arrow('M298 252 H489'),
    path('M129 32 V253 M47 207 H129 M311 177 H486','stroke-dasharray="1 3"'),
    pathInColor('M49 107 C76 80 104 45 129 44 C151 44 176 69 207 100 M311 31 C326 90 350 107 471 111','#557752','stroke-width="1.7"'),
    pathInColor('M51 166 L205 247 M304 245 C319 210 326 191 361 187 C401 183 437 183 485 181',rust,'stroke-width="1.6"'),
    ...scatter.map(([x,y])=>oval(x,y,2.7,2.7,slate,'',14,'#29495e')),
    ...[[27,64,'Net Value'],[292,64,'Satisfaction'],[23,204,'Net Value′(Coupon)'],[288,203,'Satisfaction′(WT)']].map(([x,y,text])=>label(x,y,text,`font-size="11" transform="rotate(-90 ${x} ${y})"`)),
    label(122,268,'Coupon','font-size="11"'),textBlock(386,273,['Waiting Time','(WT)'],14,'font-size="11"'),
    label(40,208,'0','font-size="10"'),label(305,177,'0','font-size="10"'),
  ]);
}

function logistic() {
  const chart = [rect(46,15,320,259,'#f5f4ed')];
  for (let i=0;i<=6;i++) {
    const x = 46+i*(320/6);
    chart.push(pathInColor(`M${x} 15 V274`,'#d0d2c9'),path(`M${x} 270 v8`));
    if (i>0) chart.push(path(`M${x-26.67} 272 v5`));
  }
  for (let i=0;i<=5;i++) {
    const y = 15+i*(259/5);
    chart.push(pathInColor(`M46 ${y} H366`,'#d0d2c9'),path(`M41 ${y} h10`));
    if (i>0) chart.push(path(`M44 ${y-25.9} h5`));
  }
  chart.push(path('M46 15 V274 H366','stroke-width="1.2"'),
    pathInColor('M46 274 C108 273 145 273 178 208 C199 165 213 116 235 77 C268 18 307 17 366 15',ink,'stroke-width="1.15"'),
    flow('M99 272 H121'),flow('M122 267 V262'),flow('M179 208 H205'),flow('M206 207 V145'),
    ...[[100,269],[122,262],[178,208],[206,140]].map(([x,y])=>oval(x,y,3.4,4.1,rust,'',14,'#84351f')),
    label(187,297,'Intervention Level','font-size="13"'),label(18,145,'Conversion','font-size="13" transform="rotate(-90 18 145)"'));
  return svg(374,307,'Logistic conversion curve with local effects',chart);
}

function demand(curved) {
  const x1 = curved?42:58; const x2 = curved?486:481;
  const bottom1 = 240; const bottom2 = curved?226:231;
  const chart = [...axes(x1,bottom1,curved?332:275,curved?74:41,'Price','Demand',20),
    ...axes(x2,bottom2,curved?775:734,curved?61:30,'Price','Demand',20)];
  const paths = curved ? ['M57 143 C74 214 85 240 296 238','M59 124 C111 177 149 195 306 212','M498 126 C514 189 527 222 567 223 H740','M503 110 C560 168 628 182 750 198'] :
    ['M63 139 L195 240','M80 102 L250 168','M486 130 L615 229','M503 92 L671 158'];
  for (const [i,d] of paths.entries()) chart.push(pathInColor(d,i%2===0?'#457b9b':'#bb842b','stroke-width="2.75"'));
  const points = curved ? [[[57,143],[67,166],[70,206],[90,209],[104,228],[141,232],[172,224],[207,235],[236,236]],
    [[83,128],[91,151],[121,159],[129,182],[152,182],[160,197],[205,197],[244,205]]] :
    [[[77,124],[89,153],[110,172],[125,194],[151,208],[177,231],[205,231]],[[108,106],[126,124],[153,134],[181,143],[200,152],[209,161],[237,143]]];
  for (const [i,marks] of points.entries()) chart.push(...marks.map(([x,y])=>oval(x,y,curved?4.4:5.3,curved?4.4:5.3,i?'#ebcaa0':slate,'',14,rule)));
  if (curved) chart.push(path('M513 120 V139 H535Z M522 196 V214 H546Z'),arrow('M594 69 L537 137'),arrow('M703 72 L547 213'),
    label(668,50,'E[τᵢ|X = x₁] = E[τᵢ|X = x₂]','font-size="19" font-family="Georgia, serif" font-style="italic"'));
  else chart.push(path('M538 111 V130 H581Z M518 158 V194 H562Z'),arrow('M677 81 L584 129'),arrow('M695 99 L563 192'),
    label(742,69,'E[τᵢ|X]','font-size="24" font-family="Georgia, serif" font-style="italic"'));
  return svg(800,293,curved?'Nonlinear demand curves':'Linear demand curves',chart);
}

function marketing(two) {
  const chart = [];
  if (!two) {
    chart.push(...axes(50,297,377,49,'Marketing','Spend',22));
    chart.push(label(209,357,'Marketing','font-size="22"'));
    chart.splice(2,1);
    chart.push(...marketingLegend(89,37,10.5,18),...marketingMarks([[90,228,298,0,true],[133,198,248,1,true],[284,228,298,0,false],[326,198,248,1,false]],10.5));
    chart.push(brace(153,248,307),label(205,282,'E[Y|T=0]'),brace(351,185,234),label(397,209,'E[Y|T=1]'),brace(439,215,284),label(472,249,'ATE'));
  } else {
    for (const [offset,right] of [[0,false],[705,true]]) {
      chart.push(`<g transform="translate(${offset} 0)">`);
      chart.push(...axes(65,382,470,74,'Marketing','Spend',27),label(261,454,'Marketing','font-size="27"'));
      chart.splice(chart.length-3,1);
      chart.push(...marketingLegend(right?118:113,right?76:60,13.5,23));
      const observations = right ? [[105,259,321,1,true],[354,297,384,0,false],[406,259,321,1,false]] : [[115,297,384,0,true],[168,259,321,1,true],[355,297,384,0,false],[407,259,321,1,false]];
      chart.push(...marketingMarks(observations,13.5));
      if(!right) chart.push(brace(196,319,396));
      chart.push(label(right?168:249,right?327:362,'E[Y|T=0]','font-size="19"'));
      chart.push(brace(440,245,303),label(495,273,'E[Y|T=1]','font-size="19"'),brace(549,279,right?322:367),
        label(right?638:589,right?301:324,right?'E[Y|T=1]-E[Y|T=0]':'ATE','font-size="19"'),'</g>');
    }
  }
  return svg(two?1435:500,two?500:386,'Marketing and potential spending outcomes',chart);
}

function marketingLegend(x,y,r,s) {
  return [oval(x,y,r,r,'#9e84b7'),oval(x,y+2.9*r+17,r,r,'#c187a8'),
    label(x+2.2*r,y,'Need Mkt. to Spend (Frugal)',`font-size="${s}" style="text-anchor:start"`),
    label(x+2.2*r,y+2.9*r+17,'Spend Anyway (Rich)',`font-size="${s}" style="text-anchor:start"`)];
}

function marketingMarks(observations,r) {
  return observations.flatMap(([x,y1,y2,group,bottomObserved]) => {
    const color = group ? '#c187a8' : '#9e84b7';
    const unseen = group ? '#edd6e1' : '#e3dbee';
    const observed = bottomObserved ? y2 : y1;
    const hidden = bottomObserved ? y1 : y2;
    return [path(`M${x} ${y1} V${y2}`),oval(x,observed,r,r,color),
      `<circle cx="${x}" cy="${hidden}" r="${r}" fill="${unseen}" stroke="${rule}" stroke-dasharray="2 4"/>`];
  });
}

function ateBins() {
  const chart = [];
  const names = ['Model-1','Model-2','Random Variable'];
  const panels = [[28,146,228,12,37,344,207,221,89,141,89,142,[322,322,332]],
    [260,142,456,12,266,341,448,220,326,381,326,381,[333,295,258]],
    [499,142,692,9,498,341,692,219,561,622,561,622,[307,307,307]]];
  const red = [
    [[43,106],[56,97],[69,86],[86,82],[103,70],[104,90],[119,63],[146,55],[162,41],[164,60],[178,34],[194,30],[204,40]],
    [[269,116],[281,109],[298,97],[311,83],[334,87],[346,71],[358,55],[378,55],[387,41],[410,16],[410,34],[434,16],[434,32]],
    [[518,75],[535,63],[539,97],[554,91],[554,73],[586,86],[603,61],[623,70],[640,97],[656,81],[662,63],[677,60],[681,85]],
  ];
  const bluePoints = [
    [[49,123],[74,123],[77,104],[97,109],[116,104],[124,82],[138,70],[144,90],[162,82],[183,61],[188,40],[191,50],[204,60]],
    [[281,119],[290,109],[309,99],[319,89],[331,78],[346,83],[365,78],[382,76],[400,82],[400,71],[417,71],[434,71],[448,68]],
    [[510,106],[523,91],[554,109],[565,99],[576,84],[593,99],[597,84],[614,97],[627,84],[640,70],[654,97],[671,97],[688,102]],
  ];
  for (const [index,[x1,y1,right1,top1,x2,y2,right2,top2,b1,b2,d1,d2,tops]] of panels.entries()) {
    chart.push(arrow(`M${x1} ${y1} H${right1}`),arrow(`M${x1} ${y1} V${top1}`),arrow(`M${x2} ${y2} H${right2}`),arrow(`M${x2} ${y2} V${top2}`));
    chart.push(path(`M${b1} 21 V${tops[1]} M${b2} 21 V${tops[2]}`,'stroke-dasharray="1 3"'));
    chart.push(label((x1+right1)/2,y1+14,names[index]),label((x2+right2)/2,y2+31,names[index]));
    const edges = [index===1?271:x2,d1,d2,index===0?194:index===1?436:683];
    for (const [i,top] of tops.entries()) chart.push(rect(edges[i],top,edges[i+1]-edges[i],y2-top));
    chart.push(...red[index].map(([x,y])=>oval(x,y,3.2,3.2,rust,'',14,'#84351f')),
      ...bluePoints[index].map(([x,y])=>oval(x,y,3.2,3.2,slate,'',14,'#29495e')));
  }
  chart.push(oval(49,14,3.2,3.2,rust),oval(49,33,3.2,3.2,slate),label(67,14,'Low','font-size="10"'),label(67,33,'High','font-size="10"'));
  chart.push(label(10,79,'Sales','font-size="13" transform="rotate(-90 10 79)"'),label(17,281,'ATE','font-size="13" transform="rotate(-90 17 281)"'));
  return svg(700,392,'Average treatment effects by group and model',chart);
}
