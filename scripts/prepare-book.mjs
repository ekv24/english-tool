import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { restyleBookFigures } from './restyle-book-figures.mjs';

const id = 'causal-inference';
const revision = 'a796c23f551868e171f1e11a985c23c01a4e8857';
const source = 'https://matheusfacure.github.io/python-causality-handbook/';
const author = 'Matheus Facure Alves';
const root = new URL('../.local/', import.meta.url);
const cache = new URL('cache/', root);
const originals = new URL('originals/' + id + '/', root);
const books = new URL('books/', root);
const output = new URL(id + '/', books);
const staging = new URL('.' + id + '-' + randomUUID() + '/', books);
const license = new URL('LICENSE', originals);
const figureLabels = JSON.parse(await readFile(new URL('../materials/causal-inference.figure-labels.json', import.meta.url), 'utf8'));

await Promise.all([cache, originals, books].map(dir => mkdir(dir, { recursive: true })));
const [archive, math] = await Promise.all([
  download('causal-inference-' + revision.slice(0, 7) + '.tar.gz',
    'https://codeload.github.com/matheusfacure/python-causality-handbook/tar.gz/' + revision,
    '78cbbf8f72cb4e75da30cf492a033dcc8bf77337a4f5b2a69f1f1c5c4e9430c0'),
  download('mathjax-3.2.2.tgz', 'https://registry.npmjs.org/mathjax/-/mathjax-3.2.2.tgz',
    '1b9c0a1c44df864e915690558e72adb9cc5203360daefd385084ced3b6c64c09'),
  installLicense(),
]);

try {
  extract(archive, originals, 1);
  await mkdir(staging, { recursive: true });
  await mkdir(new URL('images/', staging));
  const runtime = new URL('mathjax/', staging);
  await mkdir(runtime);
  extract(math, runtime, 1, 'package/LICENSE', 'package/es5/tex-mml-chtml.js',
    'package/es5/output/chtml/fonts/woff-v2');
  await copyFile(license, new URL('LICENSE.txt', staging));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', route => route.abort());
    const intro = 'landing-page';
    const landing = await readFile(new URL(intro + '.html', originals), 'utf8');
    const { title, groups } = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nav = doc.querySelector('.bd-docs-nav');
      if (!nav) throw new Error('Missing official table of contents');
      const title = nav.querySelector('.bd-sidenav__home-link a').textContent.trim();
      const groups = [...nav.querySelectorAll('.caption')].map(caption => ({
        title: caption.textContent.trim(),
        entries: [...caption.nextElementSibling.querySelectorAll(':scope > li > a')].map(link => ({
          title: link.textContent.trim(), href: link.getAttribute('href'),
        })),
      }));
      return { title, groups };
    }, landing);
    const items = [{
      title, slug: 'introduction', original: intro + '.html', type: 'intro',
    }];
    const toc = groups.map(({ title: part, entries }) => ({
      title: part,
      entries: entries.map(({ title, href }) => {
        if (href.startsWith('https://')) return { title, href };
        if (!/^[\w-]+\.html$/.test(href)) throw new Error('Unexpected contents link: ' + href);
        const number = title.match(/^(\d+) - /)?.[1] ?? '';
        const item = {
          title, number, slug: href.slice(0, -5).toLowerCase(), original: href,
          type: number ? 'chapter' : 'appendix',
        };
        items.push(item);
        return { slug: item.slug };
      }),
    }));
    const routes = Object.fromEntries(items.map(item => [item.original, item.slug]));
    if (new Set(Object.values(routes)).size !== items.length) throw new Error('Duplicate book page');
    const images = new Set();
    const stats = { math: 0, plots: 0, tables: 0, code: 0 };
    for (const item of items) {
      const html = await readFile(new URL(item.original, originals), 'utf8');
      const result = await page.evaluate(({ html, url, routes, base }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const original = doc.querySelector('article.bd-article');
        if (!original?.querySelector(':scope > section > h1')) throw new Error('Book article missing: ' + url);
        const fragment = document.createElement('div');
        const allowed = new Set('A B BLOCKQUOTE BR CAPTION CODE DD DETAILS DIV DL DT EM FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR I IMG LI OL P PRE SECTION SMALL SPAN STRONG SUB SUMMARY SUP TABLE TBODY TD TH THEAD TFOOT TR UL'.split(' '));
        const counts = {
          plots: original.querySelectorAll('img').length, math: original.querySelectorAll('.math').length,
          tables: original.querySelectorAll('table').length, code: original.querySelectorAll('pre').length,
        };
        const images = [];
        // Copy the article into an inert fragment using only text and document markup.
        for (const node of original.childNodes) append(node, fragment);
        for (const [name, selector] of Object.entries({ plots: 'img', math: '.math', tables: 'table', code: 'pre' })) {
          if (fragment.querySelectorAll(selector).length !== counts[name]) throw new Error(' Lost ' + name + ' in ' + url);
        }
        return { content: fragment.innerHTML, counts, images };

        function append(node, parent) {
          if (node.nodeType === Node.TEXT_NODE) {
            parent.append(document.createTextNode(node.textContent));
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE || node.matches('style, script, .headerlink, .toctree-wrapper')) return;
          if (!allowed.has(node.tagName)) throw new Error('Unexpected book markup: ' + node.tagName + ' at ' + url);
          const element = document.createElement(node.tagName);
          const classes = [...node.classList].filter(name => !['mathjax_ignore', 'tex2jax_ignore'].includes(name));
          if (classes.length) element.className = classes.join(' ');
          for (const attribute of ['id', 'title', 'alt', 'aria-label', 'width', 'height', 'colspan', 'rowspan', 'scope', 'start']) {
            if (node.hasAttribute(attribute)) element.setAttribute(attribute, node.getAttribute(attribute));
          }
          const href = node.getAttribute('href');
          if (href) {
            const target = new URL(href, url);
            const relative = target.href.startsWith(base) ? routes[target.pathname.split('/').at(-1)] : undefined;
            if (href.startsWith('#')) element.setAttribute('href', href);
            else if (relative) element.setAttribute('href', '/books/causal-inference/' + relative + target.hash);
            else if (['https:', 'http:', 'mailto:'].includes(target.protocol)) {
              element.setAttribute('href', target.href);
              element.setAttribute('target', '_blank');
              element.setAttribute('rel', 'noopener noreferrer');
            }
          }
          if (node.tagName === 'IMG') {
            const src = node.getAttribute('src');
            const asset = src?.match(/^_images\/([\w.-]+\.(?:png|jpe?g|svg))$/i)?.[1];
            if (!asset) throw new Error('Unexpected book image: ' + src);
            images.push(asset);
            element.setAttribute('src', '/books/causal-inference/images/' + asset);
            element.setAttribute('decoding', 'async');
          }
          if (node.tagName === 'TABLE') {
            const scroll = document.createElement('div');
            scroll.className = 'book-table';
            scroll.tabIndex = 0;
            scroll.setAttribute('role', 'region');
            scroll.setAttribute('aria-label', 'Data table');
            scroll.append(element);
            parent.append(scroll);
          } else parent.append(element);
          for (const child of node.childNodes) append(child, element);
        }
      }, { html, url: source + item.original, routes, base: source });
      for (const image of result.images) images.add(image);
      for (const [key, value] of Object.entries(result.counts)) stats[key] += value;
      await writeFile(new URL(item.slug + '.html', staging), result.content);
    }

    // Size every image before display so late loads do not shift the saved reading position.
    const sizes = await page.evaluate(async assets => Object.fromEntries(await Promise.all(assets.map(async ({ id, url }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return [id, [img.naturalWidth, img.naturalHeight]];
    }))), await Promise.all([...images].map(async name => {
      const mime = name.endsWith('.svg') ? 'svg+xml' : name.endsWith('.png') ? 'png' : 'jpeg';
      const file = new URL('_images/' + name, originals);
      await copyFile(file, new URL('images/' + name, staging));
      return { id: name, url: 'data:image/' + mime + ';base64,' + (await readFile(file)).toString('base64') };
    })));
    const { figures, methods } = await restyleBookFigures(images, new URL('_images/', originals), new URL('figures/', staging));
    for (const { slug } of items) {
      const file = new URL(slug + '.html', staging);
      const body = (await readFile(file, 'utf8')).replace(/<img[^>]*src="\/books\/causal-inference\/images\/([^"]+)"[^>]*>/g, (tag, asset) => {
        const shown = figures[asset];
        if (shown) {
          const label = figureLabels[asset];
          if (!label) throw new Error('Missing figure description: ' + asset);
          const escapedLabel = label.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
          tag = tag.replace('/images/' + asset, '/figures/' + shown)
            .replace(/\balt="[^"]*"/, 'alt="' + escapedLabel + '"')
            .slice(0, -1) + ' data-original="' + asset + '">';
        }
        if (/\bwidth=/.test(tag)) return tag; // Keep explicit sizing in the source.
        const [width, height] = sizes[asset];
        return tag.slice(0, -1) + ' width="' + width + '" height="' + height + '">';
      });
      await writeFile(file, body);
    }

    await writeFile(new URL('manifest.json', staging), JSON.stringify({
      id, title, author, source, revision, cover: 'brave-and-true.png',
      items, toc, stats, images: images.size, figures, figureMethods: methods,
    }, null, 2) + '\n');
    await publish();
    console.log('Prepared ' + items.length + ' book pages, ' + Object.keys(figures).length + ' restyled figures and ' + stats.math + ' math expressions');
  } finally {
    await browser.close();
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}

async function publish() {
  const backup = new URL('.' + id + '-previous-' + randomUUID() + '/', books);
  const existing = await rename(output, backup).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  try {
    await rename(staging, output);
  } catch (error) {
    if (existing) await rename(backup, output);
    throw error;
  }
  if (existing) await rm(backup, { recursive: true, force: true });
}

async function download(name, url, checksum) {
  const file = new URL(name, cache);
  try {
    await access(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temp = new URL('.' + randomUUID(), cache);
    try {
      execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '180', '-o', fileURLToPath(temp), url]);
      await verify(temp, checksum);
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
  }
  await verify(file, checksum);
  return file;
}

async function verify(file, checksum) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== checksum) throw new Error('Checksum mismatch: ' + fileURLToPath(file));
}

async function installLicense() {
  const file = await download('causal-inference-LICENSE', 'https://raw.githubusercontent.com/matheusfacure/python-causality-handbook/4df1445987d3b6f9824d508863a1a2f0a503e888/LICENSE',
    '469560e8b26b9deb839a6e6d7ba8c39cf19cd8938c18392ffb66ed9e541857be');
  await copyFile(file, license);
}

function extract(archive, target, strip, ...files) {
  execFileSync('tar', ['-xzf', fileURLToPath(archive), '-C', fileURLToPath(target), '--strip-components=' + strip, ...files]);
}
