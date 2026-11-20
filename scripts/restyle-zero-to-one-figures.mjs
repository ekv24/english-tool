import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// These are the charts, tables and diagrams embedded in the supplied edition.
// The cover, title page and illustrations keep their original JPEGs.
const pages = [
  10, 11, 19, 23, 28, 30, 32, 45, 46, 59, 68, 70, 72, 75, 79, 80, 83, 84, 85,
  89, 118, 124, 135, 142, 145, 148, 151, 152, 153, 163, 169, 170, 172, 174,
  190, 191, 192, 193,
];
const areaPlots = new Set([19, 23, 75, 145]);
const proportionalAreas = new Set([30, 32, 151, 152, 153]);
const ink = '141413';
const paper = 'faf9f5';

// The technical images share a source ramp from blue-black to white. Map its
// lightness in order. Area fills and the two-index chart need different ramps
// to preserve the distinctions between their original fills or series.
const standard = buildRamp([
  [0, ink], [87, '242821'], [121, '484943'], [170, '716e65'],
  [208, 'a69e91'], [232, 'ded9cd'], [255, paper],
]);
const filledPlot = buildRamp([
  [0, ink], [87, '3b2d25'], [121, '695248'], [168, '82756a'],
  [207, 'e6d4c8'], [234, 'f0e7de'], [255, paper],
]);
const areaDiagram = buildRamp([
  [0, ink], [88, '392c25'], [120, '6a4e41'], [172, 'b29986'],
  [206, 'd8c5b3'], [224, 'e9dcd0'], [255, paper],
]);
const twoSeries = buildRamp([
  [0, ink], [93, '355568'], [168, '776e62'], [216, 'a88c78'],
  [235, 'dfd2c7'], [255, paper],
]);

function buildRamp(stops) {
  const rgbStops = stops.map(([level, color]) => [
    level, color.match(/../g).map(channel => Number.parseInt(channel, 16)),
  ]);
  const ramp = new Uint8Array(256 * 3);
  for (let i = 1; i < rgbStops.length; i++) {
    const [start, from] = rgbStops[i - 1];
    const [end, to] = rgbStops[i];
    for (let level = start; level <= end; level++) {
      const fraction = (level - start) / (end - start);
      for (let channel = 0; channel < 3; channel++) {
        ramp[level * 3 + channel] = Math.round(from[channel] + fraction * (to[channel] - from[channel]));
      }
    }
  }
  return ramp;
}

export async function restyleZeroToOneFigures(originalDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const figures = {};
  const methods = {};
  for (const page of pages) {
    const ramp = areaPlots.has(page) ? filledPlot
      : proportionalAreas.has(page) ? areaDiagram
      : page === 163 ? twoSeries : standard;
    const pageName = 'page-' + String(page).padStart(3, '0');
    const count = page === 28 ? 2 : 1;
    for (let index = 1; index <= count; index++) {
      const stem = pageName + '-' + String(index).padStart(2, '0');
      const source = stem + '.jpg';
      const target = stem + '.png';
      const { data, info } = await sharp(join(originalDir, source))
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 3) {
        const lightness = Math.round((2126 * data[i] + 7152 * data[i + 1] + 722 * data[i + 2]) / 10000);
        const offset = lightness * 3;
        data[i] = ramp[offset];
        data[i + 1] = ramp[offset + 1];
        data[i + 2] = ramp[offset + 2];
      }
      // Per-pixel recoloring with a lossless output at the native dimensions.
      await sharp(data, { raw: info }).png().toFile(join(targetDir, target));
      figures[source] = target;
      methods[source] = 'published-palette';
    }
  }
  return { figures, methods };
}

if (import.meta.main) {
  const [originalDir, targetDir] = process.argv.slice(2);
  if (!originalDir || !targetDir) {
    throw new Error('Usage: node scripts/restyle-zero-to-one-figures.mjs <original-dir> <target-dir>');
  }
  const result = await restyleZeroToOneFigures(originalDir, targetDir);
  console.log(JSON.stringify(result));
}
