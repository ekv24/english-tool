const paper = '#faf9f5';
const ink = '#141413';
const muted = '#5e5d59';
const rule = '#857e72';
const grid = '#e8e6dc';
const rust = '#a64b2f';
const sans = 'Geist, Helvetica Neue, Arial, sans-serif';
const serif = 'Georgia, serif';

export function redrawTechnicalFigure(name) {
  switch (name) {
    case 'normal_dist.jpeg': return normalDistribution();
    case 'regr_time.png': return regressionOverTime();
    case 'regr_space.png': return regressionAcrossUnits(false);
    case 'regr_space_x.png': return regressionAcrossUnits(true);
    case 'rdd.png': return discontinuity(false);
    case 'rdd_fuzzy.png': return discontinuity(true);
    default: return null;
  }
}

function svg(width, height, title, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${title}</title>
<rect width="${width}" height="${height}" fill="${paper}"/>
<g font-family="${sans}" fill="${ink}">
${content.join('\n')}
</g>
</svg>\n`;
}

function label(x, y, value, size, attrs = '') {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" ${attrs}>${value}</text>`;
}

function line(x1, y1, x2, y2, stroke = rule) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}"/>`;
}

function path(d, stroke, width = 1, dash = '') {
  const pattern = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${pattern}/>`;
}

function normalDistribution() {
  const left = 48;
  const right = 346;
  const baseline = 137;
  const top = 8;
  const x = value => +(left + (value + 4) * (right - left) / 8).toFixed(2);
  const y = value => +(baseline - value * (baseline - top) / .4).toFixed(2);
  const density = value => Math.exp(-(value ** 2) / 2) / Math.sqrt(2 * Math.PI);
  const curve = (start, end) => Array.from({ length: Math.round((end - start) * 24) + 1 }, (_, index) => {
    const value = start + index / 24;
    return `${x(value)},${y(density(value))}`;
  }).join(' L');

  const chart = [];
  for (let tick = 0; tick <= 8; tick++) {
    const vertical = y(tick * .05);
    chart.push(line(left, vertical, right, vertical, grid));
    const value = (tick * .05).toFixed(2);
    chart.push(label(39, vertical + 3.5, tick === 8 ? value : value.slice(1), 10, `style="text-anchor:end" fill="${muted}"`));
  }
  const fills = ['#a64b2f', '#c9775e', '#e7b8a5', '#f5e7e0'];
  for (let band = -4; band < 4; band++) {
    const fill = fills[band < 0 ? band + 4 : 3 - band];
    chart.push(`<path d="M${x(band)},${baseline} L${curve(band, band + 1)} L${x(band + 1)},${baseline}Z" fill="${fill}"/>`);
    if (band > -4 && band < 4) chart.push(line(x(band), baseline, x(band), y(density(band)), rule));
  }
  chart.push(path('M' + curve(-4, 4), rust, 1.75));
  chart.push(line(left, top, left, baseline, ink), line(left, baseline, right, baseline, ink));
  for (let tick = -4; tick <= 4; tick++) {
    chart.push(line(x(tick), baseline, x(tick), baseline + 5), label(x(tick), 157, String(tick), 10));
  }
  chart.push(label(13, 72, 'Probability', 11, 'transform="rotate(-90 13 72)" font-weight="600"'));
  const probabilities = ['0.1%', '2.1%', '13.6%', '34.1%', '34.1%', '13.6%', '2.1%', '0.1%'];
  const values = [135, 124, 90, 30, 30, 90, 124, 135];
  for (let i = 0; i < probabilities.length; i++) {
    chart.push(label(x(i - 3.5), values[i], probabilities[i], 10));
  }
  for (const [standardDeviations, vertical, probability] of [[1, 165, '68.3%'], [2, 192, '95.4%'], [3, 220, '99.7%']]) {
    chart.push(path(`M${x(-standardDeviations)},${vertical - 3} v3 H${x(standardDeviations)} v-3`, rule));
    chart.push(label(x(0), vertical + 14, probability, 10.5, 'font-weight="600"'));
  }
  return svg(350, 239, 'Standard normal probability distribution', chart);
}

function matrix(x, y, width, height, columns, rows, fills = ['#f5f4ed']) {
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    const fill = fills[Math.floor(row / rows * fills.length)];
    for (let column = 0; column < columns; column++) {
      cells.push(`<rect x="${x + column * cellWidth}" y="${y + row * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="${fill}"/>`);
    }
  }
  for (let index = 1; index < columns; index++) {
    const column = x + index * cellWidth;
    cells.push(line(column, y, column, y + height));
  }
  for (let index = 1; index < rows; index++) {
    const row = y + index * cellHeight;
    cells.push(line(x, row, x + width, row));
  }
  cells.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${rule}"/>`);
  return cells.join('\n');
}

function equals(x, y, width, height) {
  return `<path d="M${x},${y} h${width} M${x},${y + height} h${width}" stroke="${rust}" stroke-width="${height * .55}"/>`;
}

function regressionOverTime() {
  return svg(500, 377, 'Regression over time', [
    label(124.5, 31, 'Time', 17, 'font-weight="600"'),
    label(268, 31, 'W', 17, 'font-weight="600"'),
    label(450.5, 35, 'Y', 17, 'font-weight="600"'),
    label(37, 204, 'Units', 17, 'transform="rotate(-90 37 204)" font-weight="600"'),
    matrix(70, 50, 109, 307, 2, 6),
    matrix(240, 46, 55, 103, 1, 2),
    matrix(423, 50, 55, 307, 1, 6),
    equals(338, 170, 46, 19),
  ]);
}

function regressionAcrossUnits(withCovariates) {
  const geometry = withCovariates ? {
    y: 39, height: 246, mainX: 63, mainWidth: 154, outX: 440, outWidth: 40, weightHeight: 154,
    titles: [137, 302, 460], rowX: 46, eqX: 369, eqY: 66,
  } : {
    y: 40, height: 254, mainX: 56, mainWidth: 159, outX: 444, outWidth: 43, weightHeight: 158,
    titles: [133, 302, 466], rowX: 39, eqX: 372, eqY: 68,
  };
  const { y, height, mainX, mainWidth, outX, outWidth, weightHeight, titles, rowX, eqX, eqY } = geometry;
  // X1 and X2 occupy separate rows in the source and have matching colors in Y.
  const fills = withCovariates ? ['#dce8d7', '#f6eacc'] : undefined;
  const chart = [
    label(titles[0], 23, 'Units', 13, 'font-weight="600"'),
    label(titles[1], 23, 'W', 13, 'font-weight="600"'),
    label(titles[2], 23, 'Y = Unit 1', 13, 'font-weight="600"'),
    matrix(mainX, y, mainWidth, height, 4, 6, fills),
    matrix(281, y - 1, withCovariates ? 41 : 43, weightHeight, 1, 4),
    matrix(outX, y, outWidth, height, 1, 6, fills),
    equals(eqX, eqY, 36, 15),
  ];
  for (let row = 0; row < 6; row++) {
    chart.push(label(rowX, Math.round(y + (row + .5) * height / 6 + 4), 't' + (row % (withCovariates ? 3 : 6) + 1), 13));
  }
  if (withCovariates) {
    chart.push(label(20, 109, 'X1', 13, 'transform="rotate(-90 20 109)"'));
    chart.push(label(20, 220, 'X2', 13, 'transform="rotate(-90 20 220)"'));
  } else chart.push(label(14, 167, 'Time', 13, 'transform="rotate(-90 14 167)"'));
  return svg(500, withCovariates ? 304 : 309, 'Regression across units' + (withCovariates ? ' using covariates' : ''), chart);
}

function axes({ left, right, top, bottom, min, max, fraction }) {
  const frame = [];
  const x = value => +(left + (right - left) * value / 10).toFixed(2);
  const y = value => +(bottom - (bottom - top) * (value - min) / (max - min)).toFixed(2);
  for (let tick = 0; tick <= 10; tick++) {
    const at = x(tick);
    frame.push(line(at, top, at, bottom, grid));
    frame.push(label(at, bottom + 16, tick, 10, `fill="${muted}"`));
  }
  for (let tick = 0; tick <= 5; tick++) {
    const value = fraction ? tick / 5 : tick;
    const at = y(value);
    frame.push(line(left, at, right, at, grid));
    frame.push(label(left - 7, at + 3.5, value, 10, `style="text-anchor:end" fill="${muted}"`));
  }
  frame.push(`<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="none" stroke="${rule}"/>`);
  return frame;
}

function discontinuity(fuzzy) {
  const width = fuzzy ? 450 : 400;
  const assignment = fuzzy ? { left: 36, right: 436, top: 13, bottom: 119 } : { left: 29, right: 391, top: 8, bottom: 104 };
  const height = fuzzy ? 358 : 327;
  const chart = axes({ ...assignment, min: -.1, max: 1.1, fraction: true });
  const outcomes = fuzzy ? { left: 27, right: 436, top: 196, bottom: 305 } : { left: 20, right: 391, top: 182, bottom: 281 };
  if (fuzzy) {
    // Control points trace the raster curves. These are schematic paths, with the cutoff at x = 6.
    chart.push(path('M36,75 Q156,57 276,43 M276,78 Q356,69 436,59', muted, 1.2, '1 4'));
    chart.push(path('M36,110 Q156,91 276,78 V43 Q356,34 436,32', rust, 1.75));
    chart.push(label(296, 34, 'T₁', 12, `font-family="${serif}" font-style="italic"`));
    chart.push(label(296, 93, 'T₀', 12, `font-family="${serif}" font-style="italic"`));
  } else chart.push(path('M29,96 H246.2 V16 H391', rust, 1.75));
  chart.push(label(width / 2, fuzzy ? 163 : 144, fuzzy ? 'Fig. 3. Assignment probabilities (FRD).' : 'Fig. 1. Assignment probabilities (SRD).', 11, `font-family="${serif}"`));
  chart.push(...axes({ ...outcomes, min: 0, max: 5 }));
  if (fuzzy) {
    chart.push(path('M27,299 C96,257 132,230 247,230 C340,230 374,230 436,209', muted, 1.15, '4 3'));
    chart.push(path('M27,305 C82,271 103,259 149,259 C190,259 230,273 272.4,272 C330,272 391,234 436,203', muted, 1.15, '4 3'));
    chart.push(path('M27,305 C82,270 108,256 160,255 C211,253 226,259 272.4,256 V239 C339,239 390,225 436,210', rust, 1.75));
    chart.push(label(315, 224, 'Y₁', 12, `font-family="${serif}" font-style="italic"`));
    chart.push(label(315, 285, 'Y₀', 12, `font-family="${serif}" font-style="italic"`));
  } else {
    chart.push(path('M20,276 C92,235 154,212 242.6,212.5 C308,213 354,208 391,195', muted, 1.15, '4 3'));
    chart.push(path('M20,281 C75,249 105,238 142,240 C187,241 212,253 242.6,250.5 C295,248 350,206 391,189', muted, 1.15, '4 3'));
    chart.push(path('M20,281 C75,249 105,238 142,240 C187,241 212,253 242.6,250.5 V212.5 C308,213 354,208 391,195', rust, 1.75));
    chart.push(label(292, 208, 'Y₁', 12, `font-family="${serif}" font-style="italic"`));
    chart.push(label(292, 259, 'Y₀', 12, `font-family="${serif}" font-style="italic"`));
  }
  chart.push(label(width / 2, fuzzy ? 348 : 320, fuzzy ? 'Fig. 4. Potential and observed outcome regression (FRD).' : 'Fig. 2. Potential and observed outcome regression functions.', 11, `font-family="${serif}"`));
  return svg(width, height, fuzzy ? 'Fuzzy regression discontinuity' : 'Sharp regression discontinuity', chart);
}
