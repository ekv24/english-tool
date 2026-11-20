import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { restyleDiagram } from './restyle-book-diagram.mjs';
import { redrawTechnicalFigure } from './redraw-technical-figures.mjs';
import { redrawBookSchematic } from './redraw-book-schematics.mjs';
import { redrawRemainingBookSchematic } from './redraw-book-remaining-schematics.mjs';

const named = JSON.parse(await readFile(new URL('../materials/causal-inference.figures.json', import.meta.url), 'utf8'));
const namedFigures = new Set([...named.charts, ...named.diagrams]);
const notebookFolders = ['redrawn-book-plots', 'redrawn-book-part-one', 'redrawn-book-part-two', 'redrawn-book-sdid'];

// Ordered hues map to separate, subdued series colors while retaining their
// order around the wheel. Neutral levels retain contrast on warm paper.
const palette = [
  [0, 12], [30, 24], [60, 44], [105, 89], [145, 143], [180, 183],
  [210, 211], [245, 235], [280, 276], [320, 319], [360, 372],
];

/** Repaint existing samples at the published resolution without resampling. */
export async function restyleRaster(input) {
  const { data, info } = await sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let painted = colors.get(key);
    if (painted === undefined) {
      painted = paint(data[i], data[i + 1], data[i + 2]);
      colors.set(key, painted);
    }
    data[i] = painted >> 16;
    data[i + 1] = (painted >> 8) & 255;
    data[i + 2] = painted & 255;
  }
  return { data, width: info.width, height: info.height };
}

/**
 * Trace the published marks as SVG paths without resampling. Merge adjoining
 * runs of the same paint into rectangles, including antialiased edges. This
 * keeps the source's geometry where the numeric observations are unavailable.
 */
export function tracePaintedFigure({ data, width, height }) {
  const paths = new Map();
  let rowAbove = new Map();
  for (let y = 0; y < height; y++) {
    const row = new Map();
    for (let x = 0; x < width;) {
      const start = x;
      const color = data.readUInt32BE((y * width + x) * 4);
      do { x++; } while (x < width && data.readUInt32BE((y * width + x) * 4) === color);
      if (!(color & 255)) continue;
      const key = start + ':' + x + ':' + color;
      const rect = rowAbove.get(key) ?? { x: start, y, width: x - start, height: 0 };
      rect.height++;
      row.set(key, rect);
      if (!rowAbove.has(key)) {
        if (!paths.has(color)) paths.set(color, []);
        paths.get(color).push(rect);
      }
    }
    rowAbove = row;
  }

  const shapes = Array.from(paths, ([color, rects]) => {
    const paint = (color >>> 8).toString(16).padStart(6, '0');
    const alpha = color & 255;
    const opacity = alpha === 255 ? '' : ' fill-opacity="' + (alpha / 255).toFixed(6) + '"';
    const geometry = rects.map(({ x, y, width, height }) => `M${x} ${y}h${width}v${height}h-${width}z`).join('');
    return `<path fill="#${paint}"${opacity} d="${geometry}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${shapes.join('\n')}\n</svg>\n`;
}

function paint(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const light = (max + min) / 2;
  const paper = [250, 249, 245];
  const ink = [20, 20, 19];
  const tone = 1 - (1 - light) ** 1.23;
  const base = ink.map((channel, index) => channel + (paper[index] - channel) * tone);
  if (!span) return pack(...base);

  const hue = ((max === r ? (g - b) / span : max === g ? 2 + (b - r) / span : 4 + (r - g) / span) * 60 + 360) % 360;
  const right = palette.findIndex(([from]) => from > hue);
  const [from, leftHue] = palette[right - 1];
  const [to, rightHue] = palette[right];
  const targetHue = (leftHue + (rightHue - leftHue) * (hue - from) / (to - from)) % 360;
  const chroma = span * .7;
  const middle = chroma * (1 - Math.abs((targetHue / 60) % 2 - 1));
  const offset = chroma / 2;
  const channels = [[chroma, middle, 0], [middle, chroma, 0], [0, chroma, middle],
    [0, middle, chroma], [middle, 0, chroma], [chroma, 0, middle]][Math.floor(targetHue / 60)];
  return pack(...base.map((channel, index) => channel + (channels[index] - offset) * 255));
}

function pack(red, green, blue) {
  return (byte(red) << 16) | (byte(green) << 8) | byte(blue);
}

function byte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export async function restyleBookFigures(images, originalDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const figures = {};
  const methods = {};
  const redraws = await readNotebookRedraws();
  // Generated output names in the pinned edition are their notebook output hashes.
  for (const name of [...images].sort()) {
    const isDiagram = name.endsWith('.svg');
    const isTechnicalRaster = /^[a-f0-9]{64}\.png$/.test(name) || namedFigures.has(name);
    if (!isDiagram && !isTechnicalRaster) continue;
    const notebook = redraws.get(name);
    const redrawn = notebook ?? redrawTechnicalFigure(name) ?? redrawBookSchematic(name) ?? redrawRemainingBookSchematic(name);
    let output = redrawn;
    if (!output) {
      const input = await readFile(new URL(name, originalDir));
      output = isDiagram ? restyleDiagram(input.toString('utf8')) : tracePaintedFigure(await restyleRaster(input));
    }
    if (!output) throw new Error('Could not restyle figure: ' + name);
    const targetName = name.replace(/\.[^.]+$/, '.svg');
    await writeFile(new URL(targetName, targetDir), output);
    figures[name] = targetName;
    methods[name] = notebook ? 'notebook' : redrawn ? 'reconstructed' : isDiagram ? 'vector-style' : 'published-trace';
  }
  for (const expected of namedFigures) {
    if (!figures[expected]) throw new Error('Missing expected book figure: ' + expected);
  }
  for (const name of redraws.keys()) {
    if (!figures[name]) throw new Error('Notebook redraw is absent from publication: ' + name);
  }
  return { figures, methods };
}

async function readNotebookRedraws() {
  const verified = new Map();
  for (const folder of notebookFolders) {
    const directory = new URL('../.local/' + folder + '/', import.meta.url);
    const records = await readFile(new URL('manifest.json', directory), 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const { source, file, baseline, svgSha256 } of records) {
      if (!/^[a-f0-9]{64}\.png$/.test(source) || file !== source.replace(/\.png$/, '.svg') ||
          !verifiedBaseline(baseline) || verified.has(source)) {
        throw new Error('Invalid verified notebook figure: ' + source);
      }
      const contents = await readFile(new URL(file, directory), 'utf8');
      const digest = createHash('sha256').update(contents).digest('hex');
      if (digest !== svgSha256 || !contents.startsWith('<svg')) throw new Error('Changed notebook redraw: ' + file);
      verified.set(source, contents);
    }
  }
  return verified;
}

function verifiedBaseline(baseline) {
  if (!baseline) return false;
  const exactSize = baseline.recreatedWidth === undefined ||
    (baseline.width === baseline.recreatedWidth && baseline.height === baseline.recreatedHeight);
  if (baseline.structuralSimilarity >= .98 && exactSize) return true;
  const deltaX = Math.abs(baseline.width - baseline.recreatedWidth);
  const deltaY = Math.abs(baseline.height - baseline.recreatedHeight);
  return baseline.structuralSimilarity >= .92 && deltaX <= 4 && deltaY <= 4 &&
    baseline.registrationOffsetPx?.length === 2 && baseline.registrationOffsetPx.every(value => Math.abs(value) <= 1) &&
    baseline.maxMarkDistancePx <= 3 && baseline.minMarkShareWithinTwoPx >= .995;
}
