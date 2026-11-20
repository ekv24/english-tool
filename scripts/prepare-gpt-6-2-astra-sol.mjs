import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { escape } from '../html.mjs';

const id = 'introducing-gpt-6-2-astra-sol';
const root = fileURLToPath(new URL('../', import.meta.url));
const material = JSON.parse(await readFile(join(root, 'materials', id + '.json'), 'utf8'));
const originals = join(root, '.local', 'originals', id);
const output = join(root, '.local', 'materials', id);
const media = join(output, 'media');
const assets = join(originals, 'assets');
const route = '/read/' + id + '/media/';
const source = await readFile(join(dirname(originals), id + '.html'));
if (createHash('sha256').update(source).digest('hex') !== material.sha256) {
  throw new Error('The archived HTML does not match the pinned edition');
}

const records = readPageRecords(source.toString('utf8'));
const page = records.get('47')[3].children[3];
const [hero, body, citations] = page.children[0][3].children;
if (page.pageTitle !== material.title || page.publicationDateText !== material.date ||
    hero[3].id !== 'introducing-gpt-62-astra-and-sol' || !body[3].contentHeadingsDict) {
  throw new Error('Unexpected article structure or metadata');
}

await Promise.all([mkdir(assets, { recursive: true }), mkdir(media, { recursive: true })]);
const portableFiles = new Map();
const pdfPreviews = new Map();
const chartIds = new Set();
const allowed = new Set('a b blockquote br caption code dd div dl dt em figcaption figure h2 h3 h4 h5 hr i li ol p pre section span strong sub sup table tbody td th thead tr ul'.split(' '));

const officialArtwork = localize(material.previewSource);
const heroText = render(hero[3].children);
const bodyHtml = render(body);
const citationsHtml = render(citations);
if (chartIds.size !== 16) throw new Error('Expected 16 distinct benchmark plots');
await Promise.all(portableFiles.values());
const cover = 'preview.webp';
const heroImage = 'hero.webp';
const { width, height } = await sharp(join(media, officialArtwork)).resize({ width: 1200, withoutEnlargement: true })
  .webp({ quality: 88 }).toFile(join(media, heroImage));
await sharp(join(media, heroImage)).resize(480, 360, { fit: 'contain', background: '#080d1b' })
  .webp({ quality: 90 }).toFile(join(media, cover));
await Promise.all([...pdfPreviews].map(async ([name, preview]) => {
  await promisify(execFile)('sips', ['-s', 'format', 'png', '-Z', '1400', join(media, name), '--out', join(media, preview)]);
}));
const introduction = '<section id="introducing-gpt-62-astra-and-sol">' +
  '<figure><img src="' + route + heroImage + '" width="' + width + '" height="' + height +
  '" alt="Astra GPT-6.2 Sol in white lettering between gold and blue-white star trails."></figure>' +
  heroText + '</section>';
const content = bodyHtml + citationsHtml;
const imageTags = [...content.matchAll(/<img src="([^"]+)"/g)];
const imageSizes = new Map(await Promise.all(imageTags.map(async ([, src]) => {
  const { width, height } = await sharp(join(media, basename(src))).metadata();
  return [src, ' width="' + width + '" height="' + height + '"'];
})));
await writeFile(join(output, 'article.html'), introduction +
  content.replace(/<img src="([^"]+)"/g, (tag, src) => tag + imageSizes.get(src)));
await writeFile(join(output, 'metadata.json'), JSON.stringify({ ...material, previewMedia: cover }, null, 2) + '\n');
console.log('Prepared ' + material.title + ' with ' + chartIds.size + ' charts and ' + portableFiles.size + ' source assets.');

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

function render(value) {
  if (value == null || typeof value === 'boolean' || value === '$undefined') return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const ref = /^\$L?([a-f0-9]+)$/.exec(value);
    if (ref && records.has(ref[1])) return render(records.get(ref[1]));
    return escape(value.replace(/^\$\$/, '$'));
  }
  if (value[0] !== '$') return value.map(render).join('');
  const [, tag, , props] = value;
  const { children, id: anchor } = props;
  const anchorAttr = anchor && anchor !== '$undefined' ? ' id="' + escape(anchor) + '"' : '';

  if (tag === 'h1' || tag === '$L15a' || tag === '$L15e' || tag === '$L1ef') return '';
  if (tag === '$Sreact.fragment') return render(children);
  if (props.vegaLiteSpec || props.data?.vegaLiteSpec) return chart(props);
  if (props.tabs) {
    return '<div' + anchorAttr + '>' + props.tabs.map(tab => {
      const content = render(tab.content);
      const heading = content.includes('data-benchmark-plot') ? '' : '<h4>' + escape(tab.label) + '</h4>';
      return '<section id="' + escape(tab.id.replace(/:tab$/, ':tab-panel')) + '">' + heading + content + '</section>';
    }).join('') + '</div>';
  }
  if (props.testimonials) {
    return props.testimonials.map(item =>
      '<figure><blockquote>' + render(item.testimonial) + '</blockquote><figcaption>' +
      escape(item.attribution) + '</figcaption></figure>'
    ).join('');
  }
  if (props.messages) return props.messages.map(message => render(message.body)).join('');
  if (props.videoEmbedUrl) {
    return '<div>' + image(localize(props.posterImageUrl), props.altText) + '<p>' +
      link(props.videoEmbedUrl, 'Watch video ↗') + '</p></div>';
  }
  if (props.data?.sourceUrl) {
    const name = localize(props.data.sourceUrl);
    const preview = props.initialPageImage ? localize(props.initialPageImage.url) : name + '.png';
    if (!props.initialPageImage) pdfPreviews.set(name, preview);
    return '<div>' + image(preview, props.media?.[0]?.altText ?? '') +
      '<p><a href="' + route + name + '" target="_blank" rel="noopener">Open full PDF ↗</a></p></div>';
  }
  if (props.data?.accessibilityTitle) {
    return '<p>' + link(props.data.source, escape(props.data.accessibilityTitle) + ' ↗') + '</p>';
  }
  if (props.image?.src) return '<figure>' + image(localize(props.image.src), props.alt) + '</figure>';
  if (props.href) {
    const label = props.ariaLabel ? ' aria-label="' + escape(props.ariaLabel) + '"' : '';
    return link(props.href, render(children) || '↩', anchorAttr + label);
  }
  const element = props.as ?? tag;
  if (allowed.has(element)) {
    const attributes = ['colSpan', 'rowSpan', 'scope', 'start'].map(key => props[key] == null
      ? '' : ' ' + key.toLowerCase() + '="' + escape(String(props[key])) + '"').join('');
    if (element === 'br' || element === 'hr') return '<' + element + anchorAttr + '>';
    const content = render(children);
    return content.trim() || anchor ? '<' + element + anchorAttr + attributes + '>' + content + '</' + element + '>' : '';
  }
  if (children !== undefined) return render(children);
  throw new Error('Unexpected source component ' + tag);
}

function link(target, label, attributes = '') {
  const url = new URL(target, material.source);
  if (url.protocol !== 'https:') throw new Error('Unexpected link: ' + target);
  const local = target.startsWith('#');
  return '<a' + attributes + ' href="' + escape(local ? target : url.href) + '"' +
    (local ? '' : ' target="_blank" rel="noopener noreferrer"') + '>' + label + '</a>';
}

function image(name, alt) {
  return '<img src="' + route + name + '" alt="' + escape(alt ?? '') + '" loading="lazy" decoding="async">';
}

function localize(target) {
  const url = new URL(target);
  const name = basename(url.pathname);
  if (url.origin !== 'https://cdn.openai.com' || !/^[\w.-]+\.(webp|png|jpg|pdf)$/.test(name)) {
    throw new Error('Unexpected publisher asset ' + target);
  }
  if (!portableFiles.has(name)) portableFiles.set(name, copyPublisherAsset(url, name));
  return name;
}

async function copyPublisherAsset(url, name) {
  const file = join(assets, name);
  try {
    await access(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Could not download ' + url.href + ' (' + response.status + ')');
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  await copyFile(file, join(media, name));
}

function chart(props) {
  const key = props.id;
  if (!/^[a-z0-9-]+$/.test(key) || chartIds.has(key)) throw new Error('Unexpected chart ID ' + key);
  chartIds.add(key);
  const spec = (props.data ?? props).vegaLiteSpec;
  const name = key + '.svg';
  const original = key + '-original.svg';
  portableFiles.set(name, writeChart(key, spec, name, original));
  return '<div id="' + key + '" data-benchmark-plot style="max-width:680px;margin-inline:auto">' +
    '<a href="' + route + name + '" target="_blank" rel="noopener" aria-label="' +
    escape('Open ' + spec.title.text + ' at full size') + '">' + image(name, spec.title.text) + '</a>' +
    '<p><a href="' + route + original + '" target="_blank" rel="noopener">Original chart ↗</a></p></div>';
}

async function writeChart(key, spec, name, original) {
  const chart = JSON.parse(await readFile(join(originals, 'charts', key + '.json'), 'utf8'));
  if (chart.title !== spec.title.text) throw new Error('Wrong source plot for ' + key);
  const dimensions = /viewBox="0 0 (\d+) (\d+)"/.exec(chart.svg);
  if (!dimensions) throw new Error('Missing plot dimensions for ' + key);
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  const fullWidth = width + 24;
  const rows = Math.ceil(chart.legend.length / 2);
  const fullHeight = height + 55 + 20 * rows;
  const swatches = chart.legend.map(({ label, symbol }, index) => {
    const x = 16 + index % 2 * (width / 2);
    const y = 42 + Math.floor(index / 2) * 20;
    return '<g transform="translate(' + x + ' ' + y + ')">' + (symbol ?? '') +
      '<text x="22" y="13" font-size="13">' + escape(label) + '</text></g>';
  }).join('');
  const published = chart.svg + swatches;
  if (/<(?:script|style|foreignObject|image|a)\b|\son\w+\s*=|\b(?:href|src)="(?!#)|url\((?!#)/i.test(published)) {
    throw new Error('Unexpected active SVG content for ' + key);
  }
  const palette = new Map([
    ['rgb(255, 255, 255)', '#302a25'], ['rgb(93, 93, 93)', '#756d64'],
    ['rgb(44, 103, 197)', '#3d6094'], ['rgb(99, 168, 248)', '#52788b'],
    ['rgb(184, 128, 43)', '#9e5e3e'], ['rgb(250, 229, 152)', '#a47c30'],
    ['rgb(0, 0, 0)', '#faf7ef'], ['rgb(249, 249, 249)', '#302a25'],
    ['rgb(83, 154, 248)', '#52788b'], ['rgb(232, 243, 254)', '#d8e5ea'],
    ['rgb(253, 246, 220)', '#eee0bb'],
  ]);
  const restyle = xml => xml.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g,
    (match, attr, paint) => palette.has(paint) ? attr + '="' + palette.get(paint) + '"' : match);
  function assemble(paper, ink, treatment) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + fullWidth + '" height="' + fullHeight +
      '" viewBox="0 0 ' + fullWidth + ' ' + fullHeight + '" color="' + ink + '" fill="' + ink +
      '" font-family="system-ui, sans-serif"><title>' + escape(chart.title) + '</title><rect width="100%" height="100%" fill="' +
      paper + '"/><text x="16" y="27" font-size="16" font-weight="700">' + escape(chart.title) + '</text>' +
      treatment(swatches) + '<g transform="translate(12 ' + (45 + 20 * rows) + ')">' +
      treatment(chart.svg) + '</g></svg>';
  }
  await Promise.all([
    writeFile(join(media, original), assemble('#000000', '#ffffff', xml => xml)),
    writeFile(join(media, name), assemble('#faf7ef', '#302a25', restyle)),
  ]);
}
