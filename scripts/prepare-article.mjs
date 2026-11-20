import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const id = process.argv[2];
if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error('Use: node scripts/prepare-article.mjs <material-id>');
const meta = JSON.parse(await readFile(new URL('../materials/' + id + '.json', import.meta.url), 'utf8'));
const root = new URL('../.local/', import.meta.url);
const originalDir = new URL('originals/', root);
const original = new URL(id + '.html', originalDir);
const materialDir = new URL('materials/' + id + '/', root);
await Promise.all([mkdir(originalDir, { recursive: true }), mkdir(materialDir, { recursive: true })]);

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Download failed (' + response.status + '): ' + url);
  return Buffer.from(await response.arrayBuffer());
}

const raw = await readFile(original, 'utf8').catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  const html = await download(meta.source);
  await writeAtomically(original, html);
  return html.toString();
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.route('**/*', route => route.abort());
  // DOMParser creates an inert document. Only the allowlisted article nodes are copied.
  const result = await page.evaluate(({ html, source, id, format }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ghost = format === 'ghost';
    const article = doc.querySelector('main article');
    const body = article?.querySelector(ghost ? '.gh-content' : '[class$="_body"]');
    const title = article?.querySelector('header h1')?.textContent?.trim();
    const date = article?.querySelector('time')?.textContent?.trim();
    if (!body || !title || !date) throw new Error('Article structure could not be found: ' + source);
    const fragment = document.createElement('div');
    const allowed = new Set('A B BLOCKQUOTE BR CAPTION CODE DD DIV DL DT EM FIGCAPTION FIGURE H2 H3 H4 HR I IMG LI OL P PRE SPAN STRONG SUB SUP TABLE TBODY TD TH THEAD TR UL VIDEO'.split(' '));
    const media = [];
    const parts = ghost ? [body] : [body, article.querySelector('[class$="_Footnotes"]'), article.querySelector(':scope > section')];
    for (const part of parts) {
      if (!part) continue;
      const copy = document.createElement('section');
      for (const child of part.childNodes) append(child, copy);
      fragment.append(copy);
    }
    return { title, date, body: fragment.innerHTML, media };

    function append(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      // Ghost can use another h1 for each section. The reader already renders the title as h1.
      const tag = ghost && node.tagName === 'H1' ? 'H2' : node.tagName;
      if (!allowed.has(tag)) return;
      const element = document.createElement(tag);
      if (node.id && !node.id.startsWith('base-ui-')) element.id = node.id;
      for (const key of ['alt', 'aria-label', 'role', 'width', 'height', 'colspan', 'rowspan', 'scope', 'start']) {
        if (node.hasAttribute(key)) element.setAttribute(key, node.getAttribute(key));
      }
      const link = node.getAttribute('href');
      if (link) {
        const url = new URL(link, source);
        if (link.startsWith('#') || ['https:', 'http:', 'mailto:'].includes(url.protocol)) {
          element.setAttribute('href', link.startsWith('#') ? link : url.href);
          if (!link.startsWith('#')) {
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noopener noreferrer');
          }
        }
      }
      const src = node.getAttribute('src');
      if (['IMG', 'VIDEO'].includes(node.tagName) && src) {
        const url = new URL(src, source);
        if (url.protocol !== 'https:') throw new Error('Unexpected media URL: ' + url.href);
        // Anthropic’s CDN serves the original file without image transformation parameters.
        if (url.hostname === 'assets.claude.com') url.search = '';
        const name = (media.length + 1) + (url.pathname.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.bin');
        media.push({ name, url: url.href });
        element.setAttribute('src', '/read/' + id + '/media/' + name);
        if (node.tagName === 'VIDEO') {
          element.setAttribute('controls', '');
          element.setAttribute('preload', 'metadata');
        }
      }
      for (const child of node.childNodes) append(child, element);
      parent.append(element);
    }
  }, { html: raw, source: meta.source, id, format: meta.format });

  const mediaDir = new URL('media/', materialDir);
  await mkdir(mediaDir, { recursive: true });
  const originalMediaDir = new URL(id + '/', originalDir);
  if (meta.format === 'ghost' && result.media.length) await mkdir(originalMediaDir, { recursive: true });
  await Promise.all(result.media.map(async ({ name, url }) => {
    const file = new URL(name, mediaDir);
    if (meta.format === 'ghost') {
      const originalMedia = new URL(name, originalMediaDir);
      const bytes = await readFile(originalMedia).catch(async error => {
        if (error.code !== 'ENOENT') throw error;
        const image = await download(url);
        await writeAtomically(originalMedia, image);
        return image;
      });
      await writeAtomically(file, bytes);
      return;
    }
    await access(file).catch(async error => {
      if (error.code !== 'ENOENT') throw error;
      await writeAtomically(file, await download(url));
    });
  }));
  if (meta.previewSource) {
    const preview = new URL(meta.previewSource);
    if (preview.protocol !== 'https:') throw new Error('Expected an HTTPS article preview');
    await writeAtomically(new URL('preview.jpg', mediaDir), await download(preview));
  }
  await writeAtomically(new URL('article.html', materialDir), result.body);
  await writeAtomically(new URL('metadata.json', materialDir), JSON.stringify({
    ...meta, title: result.title, date: result.date,
    previewMedia: meta.previewSource ? 'preview.jpg' : meta.previewMedia,
  }, null, 2) + '\n');
  console.log('Prepared ' + result.title + ' (' + result.media.length + ' media files)');
} finally {
  await browser.close();
}

async function writeAtomically(file, contents) {
  const temporary = new URL('.' + randomUUID() + '.tmp', file);
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
