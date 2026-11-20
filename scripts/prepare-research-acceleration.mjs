import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFragment } from 'parse5';
import sharp from 'sharp';
import { escape } from '../html.mjs';

// Render-time tools only. Install vega@6.4.0 and vega-lite@6.5.0 under the given directory.
const renderTools = createRequire(join(resolve(process.argv[2] ?? '.'), 'package.json'));
const { View, parse } = await import(pathToFileURL(renderTools.resolve('vega')).href);
const { compile } = await import(pathToFileURL(renderTools.resolve('vega-lite')).href);
const id = 'research-acceleration-jagged-frontier';
const root = fileURLToPath(new URL('../', import.meta.url));
const originals = join(root, '.local', 'originals', id);
const output = join(root, '.local', 'materials', id);
const media = join(output, 'media');
const route = '/read/' + id + '/media/';
const metadata = JSON.parse(await readFile(join(root, 'materials', id + '.json'), 'utf8'));
const source = await readFile(originals + '.html');
assert.equal(createHash('sha256').update(source).digest('hex'), metadata.sha256, 'Unexpected source edition');
const records = readPageRecords(source.toString('utf8'));
const page = records.get('47')[3].children[3];
const [, body, references] = page.children[0][3].children;
assert.equal(page.pageTitle, metadata.title);
assert.equal(page.publicationDateText, metadata.date);

const allowed = new Set('a b blockquote br caption code dd div dl dt em figcaption figure h2 h3 h4 h5 hr i li ol p pre section span strong sub sup table tbody td th thead tr ul'.split(' '));
const charts = new Map();
const methods = new Set();
const content = render(body) + render(resolveNode(references)[0]);
assert.equal(methods.size, 14);
assert.equal(charts.size, 34);
const quiz = JSON.parse(await readFile(join(root, 'materials', id + '.quiz.json'), 'utf8'));
const document = parseFragment(content);
const anchors = new Set();
for (const node of descendants(document)) {
  const anchor = node.attrs?.find(attr => attr.name === 'id')?.value;
  if (!anchor) continue;
  assert.ok(!anchors.has(anchor), 'Duplicate anchor: ' + anchor);
  anchors.add(anchor);
}
for (const node of descendants(document)) {
  const fragment = node.attrs?.find(attr => attr.name === 'href')?.value;
  if (fragment?.startsWith('#')) assert.ok(anchors.has(fragment.slice(1)), fragment);
}
for (const question of quiz) assert.ok(anchors.has(question.anchor), question.anchor);
for (const anchor of Object.keys(body[3].contentHeadingsDict)) assert.ok(anchors.has(anchor), anchor);

await Promise.all([mkdir(media, { recursive: true }), mkdir(originals, { recursive: true })]);
const previewOriginal = join(originals, 'social.png');
const cover = 'preview.webp';
const image = await readFile(previewOriginal).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  const reply = await fetch(metadata.previewSource, { signal: AbortSignal.timeout(30_000) });
  assert.ok(reply.ok, 'Publisher artwork download failed');
  const bytes = Buffer.from(await reply.arrayBuffer());
  await writeFile(previewOriginal, bytes);
  return bytes;
});
await sharp(image).resize(480, 360, { fit: 'cover' })
  .webp({ quality: 87 }).toFile(join(media, cover));
const dimensions = new Map();
for (const [name, chart] of charts) dimensions.set(name, await writeChart(name, chart));
await writeFile(join(output, 'article.html'), content.replace(/<img data-chart="([\w-]+)"/g, (_, name) => {
  const [width, height] = dimensions.get(name);
  return '<img width="' + width + '" height="' + height + '"';
}));
await writeFile(join(output, 'metadata.json'), JSON.stringify({ ...metadata, previewMedia: cover }, null, 2) + '\n');
console.log(`Prepared ${metadata.title} with ${charts.size} charts and ${methods.size} methods and supplementary sections.`);

function readPageRecords(html) {
  // Next.js publishes the default and inactive tab contents in length-prefixed Flight records.
  const chunks = [];
  for (const [, payload] of html.matchAll(/<script[^>]*>self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)) {
    const [kind, data] = JSON.parse(payload);
    if (kind === 1) chunks.push(data);
  }
  const bytes = Buffer.from(chunks.join(''));
  const result = new Map();
  for (let index = 0; index < bytes.length;) {
    const colon = bytes.indexOf(58, index);
    if (colon === -1) throw new Error('Invalid Flight record');
    const key = bytes.toString('ascii', index, colon);
    index = colon + 1;
    const length = /^T([a-f0-9]+),/.exec(bytes.toString('ascii', index, index + 24));
    if (length) {
      index += length[0].length;
      const end = index + parseInt(length[1], 16);
      result.set(key, bytes.toString('utf8', index, end));
      index = end;
      continue;
    }
    const newline = bytes.indexOf(10, index);
    const end = newline < 0 ? bytes.length : newline;
    const record = bytes.toString('utf8', index, end);
    if (record.startsWith('[') || record.startsWith('{') || record.startsWith('"')) {
      result.set(key, JSON.parse(record));
    }
    index = end + 1;
  }
  return result;
}

function resolveNode(value) {
  const ref = typeof value === 'string' && /^\$L?([a-f0-9]+)$/.exec(value);
  return ref && records.has(ref[1]) ? records.get(ref[1]) : value;
}

function* descendants(node) {
  yield node;
  for (const child of node.childNodes ?? []) yield* descendants(child);
}

function render(value) {
  if (value == null || typeof value === 'boolean' || value === '$undefined') return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const decoded = resolveNode(value);
    return decoded === value ? escape(value.replace(/^\$\$/, '$')) : render(decoded);
  }
  assert.ok(Array.isArray(value), 'Unexpected source node');
  if (value[0] !== '$') return value.map(render).join('');
  const [, tag, , props] = value;
  const anchor = props.anchorId ?? props.id;
  const idAttr = anchor && anchor !== '$undefined' ? ' id="' + escape(anchor) + '"' : '';
  const children = props.children;
  if (props.data?.vegaLiteSpec) return chart(props, idAttr);
  if (props.contentHeadings || props.code && !props.language) return '';
  if (props.trigger && props.title) {
    const label = render(props.trigger) || props.title;
    methods.add(props.trigger);
    return '<details' + idAttr + '><summary>' + label + '</summary>' + render(children) + '</details>';
  }
  if (props.code && props.language) return '<pre><code>' + escape(props.code) + '</code></pre>';
  if (props.drawerId) return '<a href="#' + escape(props.drawerId) + '">' + render(children) + '</a>';
  if (props.href) {
    const url = new URL(props.href, metadata.source);
    assert.equal(url.protocol, 'https:');
    const local = url.href.split('#')[0] === metadata.source && url.hash;
    return '<a' + idAttr + ' href="' + escape(local ? url.hash : url.href) + '"' +
      (local ? '' : ' target="_blank" rel="noopener noreferrer"') +
      '>' + (render(children) || escape(props.ariaLabel ?? '↩')) + '</a>';
  }

  const tagName = props.fullWidthCaption !== undefined ? 'figcaption' : props.as ?? tag;
  if (allowed.has(tagName)) {
    const attrs = ['colSpan', 'rowSpan', 'scope', 'start'].map(key => props[key] != null &&
      props[key] !== '$undefined' ? ' ' + key.toLowerCase() + '="' + escape(String(props[key])) + '"' : '').join('');
    if (tagName === 'br' || tagName === 'hr') return '<' + tagName + '>';
    const inside = render(children);
    if (!inside.trim() && !idAttr) return '';
    return '<' + tagName + idAttr + attrs + '>' + inside + '</' + tagName + '>';
  }
  assert.ok(children !== undefined, 'Unhandled publisher component: ' + tag);
  return render(children);
}

function chart(props, idAttr) {
  const name = props.id;
  assert.match(name, /^[a-z0-9-]+$/);
  assert.ok(!charts.has(name), name);
  charts.set(name, props.data);
  const raw = props.data.vegaLiteSpec.title;
  const title = [raw.text ?? raw].flat().join(' · ');
  const original = name + '-original.svg';
  return '<div' + idAttr + '><img data-chart="' + name + '" src="' + route + name + '.svg"' +
    ' data-original="' + original + '" alt="' + escape(title) + '"></div>';
}

async function writeChart(name, { dotcomConfig, vegaLiteSpec }) {
  const hue = {
    red: ['#fbe5e5', '#fac7c7', '#e65353', '#b83333', '#7a2020'],
    yellow: ['#fcf3d5', '#f6e3a5', '#d8ae48', '#a87e24', '#705515'],
    blue: ['#e8f3fe', '#a4cdfb', '#539af8', '#2c67c5', '#173e76'],
    pink: ['#fbe6f1', '#f8b7d5', '#f077af', '#cf6194', '#91365e'],
    purple: ['#ede5fc', '#c9b1f6', '#a67df2', '#7849d1', '#4e2f88'],
    green: ['#e4f5e5', '#bfe6c1', '#53b559', '#348b41', '#1c5926'],
    gray: ['#f3f3f3', '#d8d8d8', '#8f8f8f', '#5d5d5d', '#303030'],
  };
  const ink = '#303030';
  const fills = dotcomConfig.theme?.light?.fill ?? ['#539af8', '#8f8f8f', '#a67df2', '#53b559', '#f077af'];
  const tokens = Object.entries(hue).flatMap(([name, shades]) =>
    shades.map((color, index) => ['theme' + (index + 1) + '_' + name, color]));
  const paints = new Map(tokens);
  for (const [index, color] of fills.entries()) paints.set('theme' + (index + 1), color);
  paints.set('currentColor', ink);

  const styled = mapStrings(vegaLiteSpec, value => paints.get(value) ?? value.replace(/^\$\$/, '$'));
  const width = typeof styled.width === 'number' ? styled.width : 648;
  styled.width = width;
  styled.height ??= Math.max(dotcomConfig.minHeight ?? 0, Math.round(width / (dotcomConfig.aspectRatio ?? 1.8)));
  const config = {
    background: '#ffffff',
    view: { stroke: null },
    axis: {
      labelColor: ink, titleColor: ink, gridColor: '#e7e7e7', domainColor: '#8f8f8f',
      labelFontSize: 12, titleFontSize: 12,
    },
    title: { color: ink, anchor: 'start', fontSize: 17, offset: 14 },
    legend: { labelColor: ink, titleColor: ink, labelFontSize: 12, orient: 'top', columns: 3 },
    range: { category: fills },
  };
  const { spec } = compile(styled, { config });
  const serialized = JSON.stringify(spec);
  if (serialized.includes('explicitFillScale')) {
    spec.scales.push({ name: 'explicitFillScale', type: 'ordinal', domain: tokens.map(([key]) => key), range: tokens.map(([, paint]) => paint) });
  }
  if (serialized.includes('explicitKeylineScale')) {
    spec.scales.push({ name: 'explicitKeylineScale', type: 'ordinal', domain: tokens.map(([key]) => key), range: tokens.map(([, paint]) => paint) });
  }
  for (const name of ['dotcomContainerWidth', 'dotcomChartWidth']) {
    if (serialized.includes(name) && !spec.signals?.some(signal => signal.name === name)) {
      (spec.signals ??= []).push({ name, value: width });
    }
  }
  assert.ok(!spec.data?.some(data => data.url), 'Chart sources must be in the archived snapshot');
  const view = new View(parse(spec), {
    renderer: 'none',
    loader: { load: () => { throw new Error('External resources are disabled for archived figures'); } },
    logger: chartLogger(name),
  });
  if (dotcomConfig.filters?.some(filter => filter.parameterName === 'shownTasks')) view.signal('shownTasks', 'all');
  const original = await view.toSVG();
  view.finalize();
  assert.ok(!/<(?:script|style|foreignObject|image|a)\b|\son\w+\s*=|\b(?:href|src)="(?!#)|url\((?!#)/i.test(original), 'Unexpected SVG content');
  const bounds = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(original);
  assert.ok(bounds, 'Missing chart dimensions: ' + name);
  assert.ok(original.includes('role-mark'), 'Missing chart marks: ' + name);

  const paper = new Map([
    ['#ffffff', '#faf7ef'], ['white', '#faf7ef'], ['#303030', '#302a25'], ['#e7e7e7', '#e9e2d6'],
    ['#539af8', '#4e7d9c'], ['#2c67c5', '#3d6094'], ['#173e76', '#304a68'],
    ['#53b559', '#668358'], ['#348b41', '#4c714a'], ['#a67df2', '#8770b3'],
    ['#7849d1', '#6d569a'], ['#f077af', '#bc758d'], ['#cf6194', '#a15d79'],
    ['#ee7c37', '#b0754c'], ['#8f8f8f', '#877c6e'],
  ]);
  const restyled = original.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g,
    (whole, attr, paint) => paper.has(paint.toLowerCase()) ? attr + '="' + paper.get(paint.toLowerCase()) + '"' : whole);
  const withoutPaint = xml => xml.replace(/\b(fill|stroke|stop-color)="[^"]+"/g, '');
  assert.equal(withoutPaint(restyled), withoutPaint(original), 'Paint treatment altered chart geometry');
  await Promise.all([
    writeFile(join(media, name + '-original.svg'), original),
    writeFile(join(media, name + '.svg'), restyled),
  ]);
  return bounds.slice(1).map(value => Math.ceil(Number(value)));
}

function mapStrings(value, convert) {
  if (typeof value === 'string') return convert(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, convert));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, convert)]));
  }
  return value;
}

function chartLogger(name) {
  return {
    level() { return this; },
    error(...args) { throw new Error(name + ': ' + args.join(' ')); },
    warn(...args) { console.warn(name + ':', ...args); },
    info() {},
    debug() {},
  };
}
