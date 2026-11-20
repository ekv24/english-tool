import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { bookOverview, bookTrail } from '../book.mjs';
import { restyleRaster } from '../scripts/restyle-book-figures.mjs';
import { missingLocalData } from './local-data.mjs';

const originals = new URL('../.local/originals/causal-inference/', import.meta.url);
const prepared = new URL('../.local/books/causal-inference/', import.meta.url);
const quizzesFile = new URL('../materials/causal-inference.quizzes.json', import.meta.url);
const sourceUrl = 'https://matheusfacure.github.io/python-causality-handbook/';
const bookPath = '/books/causal-inference/';
const intro = 'landing-page.html';
const utf8 = file => readFile(file, 'utf8');
const skip = await missingLocalData(['originals/causal-inference/' + intro, 'books/causal-inference/manifest.json']);

test('preserves the official book contents and all 31 pages', { skip }, async t => {
  const [landing, manifest, quizzes] = await Promise.all([
    utf8(new URL(intro, originals)),
    utf8(new URL('manifest.json', prepared)).then(JSON.parse),
    utf8(quizzesFile).then(JSON.parse),
  ]);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ offline: true, javaScriptEnabled: false });

  const official = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const nav = document.querySelector('nav[aria-label="Main"].bd-docs-nav .bd-toc-item');
    const readLinks = list => Array.from(list.querySelectorAll(':scope > li > a'), link => ({
      title: link.textContent.trim(),
      href: link.getAttribute('href'),
    }));
    const [home, ...lists] = nav.querySelectorAll(':scope > ul');
    const headings = Array.from(nav.querySelectorAll(':scope > [role="heading"]'), heading => heading.textContent.trim());
    return {
      home: readLinks(home),
      groups: lists.map((list, index) => ({ title: headings[index], entries: readLinks(list) })),
    };
  }, landing);

  const routeBySource = new Map(manifest.items.map(item => [item.original, bookPath + item.slug]));
  const idsByRoute = new Map();
  const localLinks = [];
  const images = new Set();
  const labels = JSON.parse(await utf8(new URL('../materials/causal-inference.figure-labels.json', import.meta.url)));
  const stats = { plots: 0, math: 0, tables: 0, code: 0 };
  const bySlug = new Map(manifest.items.map(item => [item.slug, item]));
  const linkedSources = official.groups.flatMap(group => group.entries.map(entry => entry.href));
  const orderedSources = [intro, ...linkedSources.filter(href => href.endsWith('.html'))];

  await t.test('matches the title, parts, chapter order and Patreon link', () => {
    assert.equal(manifest.source, sourceUrl);
    assert.equal(official.home.length, 1);
    assert.equal(official.home[0].title, 'Causal Inference for The Brave and True');
    assert.equal(manifest.title, official.home[0].title);
    assert.deepEqual(manifest.items[0], {
      title: official.home[0].title, slug: 'introduction', original: intro, type: 'intro',
    });
    assert.deepEqual(official.groups.map(group => group.title), ['Part I - The Yang', 'Part II - The Yin', 'Appendix', 'Contribute']);
    assert.deepEqual(official.groups.map(group => group.entries.length), [16, 9, 5, 1]);
    assert.deepEqual(official.groups.at(-1).entries, [{ title: 'Patreon', href: 'https://www.patreon.com/causal_inference_for_the_brave_and_true' }]);

    const contents = manifest.toc.map(group => ({
      title: group.title,
      entries: group.entries.map(entry => {
        if (entry.href) return { title: entry.title, href: entry.href };
        const item = bySlug.get(entry.slug);
        assert.ok(item, 'Missing contents page ' + entry.slug);
        return { title: item.title, href: item.original };
      }),
    }));
    assert.deepEqual(contents, official.groups);

    assert.equal(orderedSources.length, 31);
    assert.equal(bySlug.size, orderedSources.length);
    assert.deepEqual(manifest.items.map(item => item.original), orderedSources);
  });

  await t.test('shows the official contents on the overview and in the chapter dialog', async () => {
    const expected = {
      label: 'Book contents',
      home: { title: official.home[0].title, href: routeBySource.get(intro) },
      groups: official.groups.map(({ title, entries }) => ({
        title,
        entries: entries.map(entry => ({ title: entry.title, href: routeBySource.get(entry.href) ?? entry.href })),
      })),
    };
    for (const html of [bookOverview(manifest), bookTrail(manifest, manifest.items[1])]) {
      const actual = await page.evaluate(html => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const nav = document.querySelector('nav.book-toc');
        const [home, ...parts] = nav.querySelectorAll(':scope > ul > li');
        const readLink = link => {
          const href = link.getAttribute('href');
          const exactTitle = link.getAttribute('aria-label') ?? link.dataset.pageTitle;
          const title = href.startsWith('/') ? exactTitle : exactTitle ?? link.textContent.trim().replace(/ ↗$/, '');
          return { title, href };
        };
        return {
          label: nav.getAttribute('aria-label'),
          home: readLink(home.querySelector('a')),
          groups: parts.map(part => ({
            title: part.querySelector('h3').textContent,
            entries: Array.from(part.querySelectorAll(':scope > ul > li > a'), readLink),
          })),
        };
      }, html);
      assert.deepEqual(actual, expected);
    }
  });

  await t.test('keeps English text, figures, formulas, code and tables in order', async () => {
    const manifestBySource = new Map(manifest.items.map(item => [item.original, item]));
    for (const original of orderedSources) {
      const { slug, title } = manifestBySource.get(original);
      const route = bookPath + slug;
      const [source, result] = await Promise.all([
        utf8(new URL(original, originals)),
        utf8(new URL(slug + '.html', prepared)),
      ]);
      const { expected, actual, stripped } = await page.evaluate(({ source, result }) => {
        const parser = new DOMParser();
        const official = parser.parseFromString(source, 'text/html').querySelector('article.bd-article');
        const reader = parser.parseFromString('<article>' + result + '</article>', 'text/html').querySelector('article');
        const sourceControls = 'script, style, .headerlink, .toctree-wrapper';
        official.querySelectorAll(sourceControls).forEach(node => node.remove());
        reader.querySelectorAll('.book-table').forEach(wrapper => wrapper.replaceWith(...wrapper.childNodes));

        return { expected: inspect(official), actual: inspect(reader), stripped: reader.querySelectorAll(sourceControls).length };

        function inspect(article) {
          const all = selector => Array.from(article.querySelectorAll(selector));
          const tables = all('table');
          return {
            heading: article.querySelector('h1').textContent,
            text: article.textContent,
            structure: all('*').map(node => [node.tagName, node.childElementCount, node.id]),
            links: all('a[href]').map(link => link.getAttribute('href')),
            images: all('img').map(img => ({
              src: img.getAttribute('src'), alt: img.getAttribute('alt'),
              width: img.getAttribute('width'), height: img.getAttribute('height'),
            })),
            math: all('.math').map(node => [node.classList.contains('display'), node.textContent]),
            code: all('pre').map(node => node.textContent),
            tables: tables.map(table => Array.from(table.rows, row => Array.from(row.cells, cell => [
              cell.colSpan, cell.rowSpan, cell.getAttribute('scope'), cell.textContent,
            ]))),
          };
        }
      }, { source, result });

      assert.equal(stripped, 0, original + ' contains source controls');
      assert.equal(actual.heading, title, original + ' heading');
      assert.equal(actual.text === expected.text, true, original + ' text differs from the source');
      assert.deepEqual(actual.structure, expected.structure, original + ' element order, nesting or IDs');
      assert.deepEqual(actual.math, expected.math, original + ' TeX formulas');
      assert.deepEqual(actual.code, expected.code, original + ' code and output text');
      assert.deepEqual(actual.tables, expected.tables, original + ' data tables');
      const ids = new Set(actual.structure.map(([, , id]) => id).filter(Boolean));
      idsByRoute.set(route, ids);

      assert.deepEqual(actual.links, expected.links.map(href => {
        if (href.startsWith('#')) return href;
        const absolute = new URL(href, sourceUrl + original);
        const bookRoute = absolute.href.startsWith(sourceUrl) && routeBySource.get(absolute.pathname.split('/').at(-1));
        return bookRoute ? bookRoute + absolute.hash : absolute.href;
      }), original + ' article links');
      localLinks.push(...actual.links.filter(href => href.startsWith('#') || href.startsWith(bookPath)).map(href => ({ route, href })));

      assert.equal(actual.images.length, expected.images.length, original + ' image count');
      for (const [index, sourceImage] of expected.images.entries()) {
        const asset = sourceImage.src.replace(/^_images\//, '');
        const resultImage = actual.images[index];
        const preview = manifest.figures?.[asset];
        const imagePath = preview ? 'figures/' + preview : 'images/' + asset;
        assert.equal(resultImage.src, bookPath + imagePath, original + ' image URL and order');
        assert.equal(resultImage.alt, preview ? labels[asset] : sourceImage.alt, original + ' image description');
        if (sourceImage.width) assert.equal(resultImage.width, sourceImage.width, original + ' image width');
        if (sourceImage.height) assert.equal(resultImage.height, sourceImage.height, original + ' image height');
        images.add(asset);
      }

      if (original !== intro) {
        const questions = quizzes[original.slice(0, -5)];
        assert.ok(questions?.length, original + ' review questions');
        for (const { question, answer, anchor } of questions) {
          assert.ok(question.trim() && answer.trim(), original + ' empty question or answer');
          assert.ok(ids.has(anchor), original + ' missing quiz anchor #' + anchor);
        }
      }

      stats.plots += expected.images.length;
      stats.math += expected.math.length;
      stats.tables += expected.tables.length;
      stats.code += expected.code.length;
    }

    assert.deepEqual(manifest.stats, stats);
    for (const { route, href } of localLinks) {
      const [target, anchor] = href.split('#', 2);
      const ids = idsByRoute.get(target || route);
      assert.ok(ids && (!anchor || ids.has(decodeURIComponent(anchor))), route + ' unresolved link ' + href);
    }
  });

  await t.test('copies every referenced image byte for byte', async () => {
    assert.equal(manifest.images, images.size);
    assert.deepEqual((await readdir(new URL('images/', prepared))).sort(), [...images].sort());
    assert.ok(images.has(manifest.cover));
    const previews = Object.entries(manifest.figures ?? {});
    if (previews.length) {
      for (const [asset] of previews) assert.ok(images.has(asset), 'Missing source for figure ' + asset);
      const renderedFiles = await readdir(new URL('figures/', prepared));
      assert.deepEqual(renderedFiles.sort(), previews.map(([, filename]) => filename).sort());
    }
    for (const asset of images) {
      const [original, copy] = await Promise.all([
        readFile(new URL('_images/' + asset, originals)),
        readFile(new URL('images/' + asset, prepared)),
      ]);
      assert.ok(original.equals(copy), asset + ' differs from the source');
    }
  });

  await t.test('renders every technical figure as SVG and verifies traces at source resolution', async () => {
    const named = JSON.parse(await utf8(new URL('../materials/causal-inference.figures.json', import.meta.url)));
    const expected = [...new Set([...named.charts, ...named.diagrams,
      ...[...images].filter(file => /^[a-f0-9]{64}\.(?:png|svg)$/.test(file)),
    ])].sort();
    assert.equal(expected.length, 227);
    assert.deepEqual(Object.keys(manifest.figures).sort(), expected);
    assert.deepEqual(Object.keys(manifest.figureMethods).sort(), expected);
    for (const asset of expected) {
      const method = manifest.figureMethods[asset];
      const file = manifest.figures[asset];
      const original = new URL('images/' + asset, prepared);
      const rendered = new URL('figures/' + file, prepared);
      assert.ok(['notebook', 'reconstructed', 'vector-style', 'published-trace'].includes(method), asset);
      assert.match(file, /\.svg$/);
      const svg = await readFile(rendered);
      assert.doesNotMatch(svg.toString(), /<(?:image|foreignObject|script)\b/i, asset);
      if (method !== 'published-trace') continue;
      const reference = await restyleRaster(await readFile(original));
      const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, reference.width, asset);
      assert.equal(info.height, reference.height, asset);
      for (let i = 0; i < data.length; i += 4) {
        // The SVG renderer rounds premultiplied colors, especially at low alpha.
        const a = data[i + 3];
        const b = reference.data[i + 3];
        if (Math.abs(a - b) > 1) assert.fail(asset + ' altered opacity at pixel ' + (i / 4));
        for (let channel = 0; channel < 3; channel++) {
          const painted = Math.round(data[i + channel] * a / 255);
          const expected = Math.round(reference.data[i + channel] * b / 255);
          if (Math.abs(painted - expected) > 2) assert.fail(asset + ' altered marks at pixel ' + (i / 4));
        }
      }
    }
  });
});
