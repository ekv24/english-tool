import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { localReaderEnv, missingLocalData, opusModel } from './local-data.mjs';

const skip = await missingLocalData([
  'materials/effective-harnesses/metadata.json', 'materials/harness-design/metadata.json',
  'originals/effective-harnesses.html', 'books/causal-inference/manifest.json', opusModel,
]);

let browser;
let server;
let page;
let context;
const errors = [];
const captures = process.env.READER_SCREENSHOTS;
let base;
const first = '/read/effective-harnesses';

async function startReader(stateDb) {
  const processHandle = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, ...localReaderEnv, PORT: '0', ENGLISH_TOOL_STATE_DB: stateDb },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const output = createInterface({ input: processHandle.stdout });
  const [url] = await Promise.race([
    once(output, 'line'),
    once(processHandle, 'exit').then(([code]) => { throw new Error('Reader exited with ' + code); }),
  ]);
  return { processHandle, url };
}

before(async () => {
  if (skip) return;
  ({ processHandle: server, url: base } = await startReader(''));
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  context.on('page', tab => tab.on('pageerror', error => errors.push(error)));
  page = await context.newPage();
});

after(async () => {
  if (skip) return;
  await browser?.close();
  server?.kill();
  assert.deepEqual(errors, []);
});

test('opens the Anthropic article and translates a word beside the text', { skip }, async () => {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /\p{Script=Cyrillic}/u);
  await page.goto(base + first);
  const heading = page.getByRole('heading', { name: 'Effective harnesses for long-running agents', level: 1 });
  await heading.waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.doesNotMatch(await page.locator('.article-header').innerText(), /select a phrase|click a word|\p{Script=Cyrillic}/iu);
  assert.ok((await page.locator('#article').boundingBox()).width > 900);
  await capture('01-reader.png');
  const firstLookup = await lookup(heading, 'harnesses', 'обвязки агентов');
  await capture('02-translation.png');
  await page.keyboard.press('Escape');
  const repeatLookup = await lookup(heading, 'harnesses', 'обвязки агентов');
  console.log('Glossary first/repeat: ' + firstLookup + '/' + repeatLookup + ' ms');
  const hint = await page.locator('#lookup').boundingBox();
  const target = await heading.boundingBox();
  assert.ok(hint.y >= target.y - hint.height && hint.y <= target.y + target.height + 25);
});

test('keeps the original sections, selectable text and locally stored figure', { skip }, async () => {
  await page.goto(base + first);
  const original = await readFile('.local/originals/effective-harnesses.html', 'utf8');
  const expected = await page.evaluate(raw => {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const source = doc.querySelector('main article');
    return [...source.querySelectorAll('[class$="_body"], [class$="_Footnotes"], :scope > section')].map(
      section => {
        for (const chrome of section.querySelectorAll('button, svg')) chrome.remove();
        return section.textContent.replace(/\s+/g, ' ').trim();
      }
    );
  }, original);
  const actual = await page.locator('#article > section').evaluateAll(sections =>
    sections.map(section => section.textContent.replace(/\s+/g, ' ').trim())
  );
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) assert.equal(value === expected[index], true, 'Source text differs in section ' + index);
  const image = page.locator('article figure img');
  await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('article figure img').naturalWidth === 1920, null, { timeout: 4500 });
  assert.deepEqual(await page.locator('article figcaption').allTextContents().then(values => values.map(value => value.trim())), await page.evaluate(raw => {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return [...doc.querySelectorAll('article [class$="_body"] figcaption')].map(caption => caption.textContent.trim());
  }, original));
  await capture('07-figure.png');
});

test('translates a phrase outside the glossary with the locally installed model', { skip }, async () => {
  await page.goto(base + first);
  const paragraph = page.locator('article p').filter({ hasText: 'The core challenge' }).first();
  await paragraph.scrollIntoViewIfNeeded();
  const firstLookup = await lookup(paragraph, 'The core challenge', /основная задача/i, true);
  await page.keyboard.press('Escape');
  const repeatLookup = await lookup(paragraph, 'The core challenge', /основная задача/i, true);
  assert.equal(await page.locator('#translation-source').innerText(), 'OPUS-MT');
  console.log('Machine translation first/repeat: ' + firstLookup + '/' + repeatLookup + ' ms');
});

test('looks up a selected phrase and shows context without moving the page', { skip }, async () => {
  await page.goto(base + first);
  await page.evaluate(() => document.fonts.ready);
  const paragraph = page.locator('article p').filter({ hasText: 'multiple context windows' }).first();
  await paragraph.scrollIntoViewIfNeeded();
  await lookup(paragraph, 'context windows', 'окна контекста', true);
  const before = await page.evaluate(() => scrollY);
  assert.equal(await page.locator('#context').isVisible(), false);
  await page.getByRole('button', { name: 'In context' }).click();
  await page.locator('#context').getByText(/часть состояния приходится хранить/).waitFor();
  await page.locator('#context').getByText(/цель|прогресс|продвижение/i).waitFor();
  await capture('03-context.png');
  await page.getByRole('button', { name: 'Close translation' }).click();
  assert.equal(await page.locator('#lookup').isVisible(), false);
  assert.equal(await page.evaluate(() => scrollY), before);
});

test('restores two positions from newly opened tabs and tracks documents independently', { skip }, async () => {
  for (const [path, anchor] of [
    [first, 'environment-management-'],
    [first, 'getting-up-to-speed'],
    ['/read/harness-design', 'scaling-to-full-stack-coding'],
  ]) {
    await page.goto(base + path);
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator('#' + anchor);
    await section.evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 144));
    await page.locator('#contents a[href="#' + anchor + '"][aria-current="location"]').waitFor({ timeout: 3000 });
    const before = (await section.boundingBox()).y;
    assert.ok(Math.abs(before - 144) <= 1);
    await page.close();
    page = await context.newPage();
    await page.goto(base + path);
    await page.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top - 144) < 4, anchor, { timeout: 4000 }).catch(async error => {
      console.log('Restore', anchor, await page.locator('#' + anchor).boundingBox());
      throw error;
    });
  }
  await page.goto(base);
  const firstCard = page.locator('[data-material="effective-harnesses"]');
  const secondCard = page.locator('[data-material="harness-design"]');
  const firstProgress = firstCard.locator('progress');
  const secondProgress = secondCard.locator('progress');
  const firstBefore = await firstProgress.evaluate(node => node.value);
  const secondBefore = await secondProgress.evaluate(node => node.value);
  assert.ok([firstBefore, secondBefore].every(value => value > 0 && value < 100));
  await firstCard.click();
  await page.waitForFunction(() => Math.abs(document.getElementById('getting-up-to-speed').getBoundingClientRect().top - 144) < 4);
  await page.locator('.end').scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.getByRole('link', { name: '← Back to library', exact: true }).click();
  await firstCard.getByText('At 99%', { exact: true }).waitFor();
  assert.equal(await firstProgress.evaluate(node => node.value), 99);
  assert.equal(await secondProgress.evaluate(node => node.value), secondBefore);
  await capture('04-library.png');
  await page.locator('.article-grid').getByRole('link', { name: /Harness design for long-running/ }).click();
  await page.waitForFunction(() => Math.abs(document.getElementById('scaling-to-full-stack-coding').getBoundingClientRect().top - 144) < 4);
});

test('closing another tab cannot undo the latest reading position or progress', { skip }, async () => {
  await page.goto(base + first);
  const older = await context.newPage();
  const library = await context.newPage();
  await library.goto(base);
  await older.goto(base + first);
  await older.evaluate(() => document.fonts.ready);
  await older.locator('#environment-management-').evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 120));
  await older.locator('#contents a[href="#environment-management-"][aria-current="location"]').waitFor({ timeout: 3000 });
  await page.bringToFront();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  const card = library.locator('.card').filter({ hasText: 'Effective harnesses' });
  await card.getByText('Finished ✓').waitFor({ timeout: 4000 });
  await page.locator('#future-work').evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 130));
  await page.locator('#contents a[href="#future-work"][aria-current="location"]').waitFor({ timeout: 3000 });
  await older.close();
  await page.close();
  page = library;
  assert.equal(await card.getByText('Finished ✓').isVisible(), true);
  await card.click();
  await page.waitForFunction(() => Math.abs(document.getElementById('future-work').getBoundingClientRect().top - 130) < 4, null, { timeout: 4000 });
});

test('shares saved expressions and the reading position between independent browser profiles', { skip }, async t => {
  const { processHandle, url } = await startReader(':memory:');
  t.after(() => processHandle.kill());
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  const mac = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(async () => { await Promise.all([phoneContext.close(), mac.close()]); });
  phone.setDefaultTimeout(12000);
  mac.setDefaultTimeout(12000);

  await mac.goto(url + '/vocabulary');
  const legacy = await phoneContext.newPage();
  await legacy.route(url + '/legacy', route => route.fulfill({ contentType: 'text/html', body: '<title>Old reader tab</title>' }));
  await legacy.goto(url + '/legacy');
  const phoneVocabulary = await phoneContext.newPage();
  await phoneVocabulary.goto(url + '/vocabulary');
  await legacy.evaluate(() => {
    localStorage.setItem('vocabulary:' + JSON.stringify(['an older expression', 'старое выражение']), JSON.stringify({
      text: 'an older expression', translation: 'старое выражение', sentence: 'I saved an older expression.',
      href: '/read/effective-harnesses#paragraph-2', title: 'Effective harnesses', savedAt: 1,
    }));
  });
  await mac.getByText('an older expression', { exact: true }).waitFor({ timeout: 6000 });
  await legacy.close();
  await phoneVocabulary.close();
  await phone.goto(url + first);
  const title = phone.locator('#article h1');
  await phone.evaluate(() => document.fonts.ready);
  await pointAtText(title, 'harnesses', false, phone);
  await phone.getByRole('button', { name: 'Save expression' }).click();
  const card = mac.locator('details').filter({ has: mac.getByText('harnesses', { exact: true }) });
  await card.getByText('Show answer').click();
  await card.getByText('обвязки агентов', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Remove “harnesses”', exact: true }).click();
  await phone.getByRole('button', { name: 'Save expression' }).waitFor();
  await phone.getByRole('button', { name: 'Close translation' }).click();

  const anchor = 'getting-up-to-speed';
  await phone.locator('#' + anchor).evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 110));
  await mac.goto(url);
  const source = mac.locator('[data-material="effective-harnesses"]');
  await source.getByText(/^At [1-9]\d*%$/).waitFor();
  await source.click();
  await mac.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top - 110) < 6, anchor, { timeout: 8000 });
});

test('reopens an article at the top after a preview and only finishes it by request', { skip }, async () => {
  const fresh = await browser.newContext();
  try {
    const library = await fresh.newPage();
    await library.goto(base);
    const card = library.locator('[data-material="effective-harnesses"]');
    const tab = await fresh.newPage();
    await tab.goto(base + first);
    await tab.evaluate(() => document.fonts.ready);
    await tab.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await card.getByText('At 99%', { exact: true }).waitFor();
    await tab.evaluate(() => scrollTo(0, 0));
    await card.getByText('To read', { exact: true }).waitFor();
    await tab.close();

    await card.click();
    await library.evaluate(() => document.fonts.ready);
    assert.equal(await library.evaluate(() => scrollY), 0);
    await library.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await library.getByRole('button', { name: 'Mark as unread', exact: true }).waitFor();
    await library.evaluate(() => scrollTo(0, 0));
    await library.goto(base);
    await card.getByText('Finished ✓', { exact: true }).waitFor();
    await card.click();
    await library.evaluate(() => document.fonts.ready);
    assert.equal(await library.evaluate(() => scrollY), 0);
    await library.getByRole('button', { name: 'Mark as unread', exact: true }).click();
    await library.getByRole('button', { name: 'Mark as read', exact: true }).waitFor();
    await library.evaluate(() => scrollTo(0, 0));
    await library.goto(base);
    await card.getByText('To read', { exact: true }).waitFor();
  } finally {
    await fresh.close();
  }
});

test('resumes after reopening an address reached through the table of contents', { skip }, async () => {
  await page.goto(base + first);
  const link = page.locator('#contents a[href="#environment-management-"]');
  await link.click();
  const address = page.url();
  const paragraph = page.locator('#feature-list + p');
  await paragraph.evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 163));
  await page.waitForFunction(() => Math.abs(document.querySelector('#feature-list + p').getBoundingClientRect().top - 163) < 2);
  await page.close();
  page = await context.newPage();
  await page.goto(address);
  await page.waitForFunction(() => Math.abs(document.querySelector('#feature-list + p').getBoundingClientRect().top - 163) < 4, null, { timeout: 4000 });
});

test('offers a self-check after reading with anchored answers available after an attempt', { skip }, async () => {
  await page.goto(base + first);
  const quiz = page.locator('#quiz');
  const summaries = await quiz.locator('h3').allTextContents();
  assert.ok(summaries.length >= 3);
  assert.equal(await quiz.locator('.expected:visible').count(), 0);
  await quiz.getByText('Article quiz', { exact: true }).click();
  assert.doesNotMatch(await quiz.innerText(), /\p{Script=Cyrillic}/u);
  const questions = await quiz.locator('.question').all();
  for (const question of questions) {
    const button = question.getByRole('button', { name: 'Check answer' });
    assert.equal(await button.isDisabled(), true);
    await question.getByRole('textbox').fill('My answer with a reason and an example');
    await button.click();
    const reference = question.getByRole('link', { name: /Go to the passage/ });
    assert.equal(await reference.isVisible(), true);
    assert.doesNotMatch(await question.locator('.expected').innerText(), /\p{Script=Cyrillic}/u);
    const target = await reference.getAttribute('href');
    await reference.click();
    assert.equal(new URL(page.url()).hash, target);
    const heading = page.locator(target);
    assert.ok((await heading.boundingBox()).y >= 60);
  }
  await questions[0].scrollIntoViewIfNeeded();
  await capture('05-quiz.png');
});

test('keeps the article and popover within a narrow viewport', { skip }, async () => {
  const desktop = page;
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(base + first);
    const heading = page.getByRole('heading', { level: 1 });
    await page.evaluate(() => document.fonts.ready);
    await lookup(heading, 'harnesses', 'обвязки агентов');
    const { x, width } = await page.locator('#lookup').boundingBox();
    assert.ok(x >= 0 && x + width <= 391);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await capture('06-narrow.png');
  } finally {
    await page.close();
    page = desktop;
  }
});

async function capture(name) {
  if (captures) await page.screenshot({ path: join(captures, name), animations: 'disabled' });
}

async function lookup(locator, term, expected, select = false) {
  const started = await pointAtText(locator, term, select);
  await page.getByRole('status').getByText(expected).waitFor({ timeout: 4000 }).catch(async error => {
    console.log('Lookup', term, await page.locator('#expression').textContent(), await page.locator('#translation').textContent());
    throw error;
  });
  return Math.round(performance.now() - started);
}

async function pointAtText(locator, term, select = false, target = page) {
  const points = await locator.evaluate((block, needle) => {
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let text;
    while (text = walk.nextNode()) {
      const offset = text.textContent.indexOf(needle);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + needle.length);
      return Array.from(range.getClientRects(), r => ({ left: r.left, right: r.right, y: r.top + r.height / 2 }));
    }
    throw new Error('Text not found: ' + needle);
  }, term);
  const start = points[0];
  const end = points.at(-1);
  let started;
  if (select) {
    await target.mouse.move(start.left + 0.2, start.y);
    await target.mouse.down();
    await target.mouse.move(end.right - 0.2, end.y, { steps: 12 });
    started = performance.now();
    await target.mouse.up();
  } else {
    started = performance.now();
    await target.mouse.click((start.left + start.right) / 2, start.y);
  }
  return started;
}

test('opens the complete book, uses the chapter outline, and resumes a chapter from the library', { skip }, async () => {
  const overviewPath = '/books/causal-inference';
  await page.goto(base);
  const book = page.locator('[data-book="causal-inference"] [data-book-summary]');
  await book.getByRole('heading', { name: /Causal Inference for The Brave and True/ }).waitFor();
  await capture('08-book-library.png');
  await book.click();
  assert.equal(new URL(page.url()).pathname, overviewPath);
  assert.deepEqual(await page.locator('.book-part h3').allTextContents(), ['Part I - The Yang', 'Part II - The Yin', 'Appendix', 'Contribute']);
  assert.equal(await page.locator('nav.book-toc a').count(), 32);
  await capture('09-book-overview.png');
  const overviewSearch = page.getByRole('searchbox', { name: 'Find a chapter' });
  await overviewSearch.fill('synthetic differences');
  assert.equal(await page.locator('.book-toc a:visible').count(), 1);
  await page.getByRole('link', { name: '25 - Synthetic Difference-in-Differences', exact: true }).waitFor();
  await overviewSearch.press('Escape');
  assert.equal(await page.locator('.book-toc a:visible').count(), 32);
  await page.getByRole('link', { name: 'Start chapter 1' }).click();
  const chapter = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Book contents' }).click();
  const contents = page.getByRole('dialog', { name: 'Book contents' });
  await contents.waitFor();
  assert.equal(await contents.locator('a[aria-current="page"]').getAttribute('href'), chapter);
  await capture('10-book-contents.png');
  await contents.getByRole('searchbox').fill('chapter 03');
  assert.equal(await contents.locator('.book-toc a:visible').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await contents.locator('.book-toc a:visible').count(), 32);
  await page.keyboard.press('Escape');
  assert.ok(!await contents.isVisible());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('#article mjx-container'));
  const bias = page.locator('#bias > h2');
  await bias.evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 144));
  await page.locator('#contents a[href="#bias"][aria-current="location"]').waitFor();
  assert.ok(Math.abs((await bias.boundingBox()).y - 144) <= 1);
  await page.goto(base);
  const resume = page.locator('[data-book="causal-inference"]').getByRole('link', { name: 'Continue reading →' });
  await resume.waitFor();
  assert.equal(await resume.getAttribute('href'), chapter);
  await resume.click();
  await page.waitForFunction(() => Math.abs(document.querySelector('#bias > h2').getBoundingClientRect().top - 144) < 4);
});

test('starts articles and books fresh while keeping quizzes and vocabulary from previous versions', { skip }, async () => {
  const tab = await browser.newPage();
  try {
    const slug = '01-introduction-to-causality';
    const bookId = 'causal-inference/' + slug;
    const draft = 'An example quiz answer';
    await tab.addInitScript(({ bookId, slug, draft }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const position = JSON.stringify({ anchor: 'bias', offset: -140, y: 700, percent: 100, updatedAt: 1 });
      localStorage.setItem('reading:' + bookId, position);
      localStorage.setItem('reading:v2:' + bookId, position);
      localStorage.setItem('book:causal-inference:recent', slug);
      localStorage.setItem('reading:effective-harnesses', position);
      localStorage.setItem('quiz:' + bookId + ':0', draft);
      localStorage.setItem('vocabulary:' + JSON.stringify(['treatment', 'воздействие']), JSON.stringify({
        text: 'treatment', translation: 'воздействие', sentence: 'The treatment affects the outcome.',
        href: '/books/' + bookId + '#bias', title: 'Introduction to Causality', savedAt: 1,
      }));
    }, { bookId, slug, draft });
    await tab.goto(base);
    const book = tab.locator('[data-book="causal-inference"]');
    await book.locator('[data-book-summary]').getByText('To read', { exact: true }).waitFor();
    const article = tab.locator('[data-material="effective-harnesses"]');
    await article.getByText('To read', { exact: true }).waitFor();
    assert.equal(await book.getByRole('link', { name: 'Continue reading →' }).count(), 0);
    await article.click();
    await tab.evaluate(() => document.fonts.ready);
    assert.equal(await tab.evaluate(() => scrollY), 0);
    await tab.goto(base);
    await book.locator('[data-book-summary]').click();
    await tab.getByRole('link', { name: 'Start chapter 1' }).click();
    await tab.evaluate(async () => await window.MathJax?.startup?.promise);
    assert.equal(await tab.evaluate(() => scrollY), 0);
    await tab.locator('#quiz > summary').click();
    assert.equal(await tab.locator('#quiz textarea').first().inputValue(), draft);
    await tab.getByRole('link', { name: 'Vocabulary', exact: true }).click();
    const saved = tab.locator('details').filter({ hasText: 'treatment' });
    await saved.getByText('Show answer').click();
    await saved.getByText('воздействие', { exact: true }).waitFor();
  } finally {
    await tab.close();
  }
});

test('adds a chapter to the book’s finished count only when explicitly marked', { skip }, async () => {
  const tab = await browser.newPage();
  try {
    const chapter = '/books/causal-inference/01-introduction-to-causality';
    await tab.goto(base + chapter);
    await tab.evaluate(async () => {
      await document.fonts.ready;
      await window.MathJax?.startup?.promise;
    });
    await tab.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await tab.goto(base);
    const book = tab.locator('[data-book="causal-inference"]');
    const status = book.locator('[data-book-status]');
    const resume = book.getByRole('link', { name: 'Continue reading →' });
    await resume.waitFor();
    assert.doesNotMatch(await status.innerText(), /chapters finished/);
    await resume.click();
    await tab.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await tab.goto(base);
    await book.getByText(/^1 of \d+ chapters finished$/).waitFor();
    await resume.click();
    await tab.getByRole('button', { name: 'Mark as unread', exact: true }).click();
    await tab.evaluate(() => scrollTo(0, 0));
    await tab.goto(base);
    await book.getByText('To read', { exact: true }).waitFor();
    assert.equal(await resume.count(), 0);
  } finally {
    await tab.close();
  }
});

test('marks chapters without quizzes independently from their reading status shortcut', { skip }, async t => {
  const prepared = await stat('.local/books/the-nvidia-way/manifest.json').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!prepared) return t.skip('The locally supplied Nvidia book has not been prepared');

  const book = '/books/the-nvidia-way';
  const first = book + '/01-pain-and-suffering';
  const second = book + '/02-the-graphics-revolution';
  const tab = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    await tab.goto(base + first);
    assert.equal(await tab.locator('#quiz').count(), 0);
    await tab.getByText('On this page', { exact: true }).click();
    await tab.getByRole('link', { name: 'Reading status', exact: true }).click();
    await tab.waitForURL(base + first + '#reading-status');
    await tab.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await tab.locator('#reading-status').getByText('Finished', { exact: true }).waitFor();
    await tab.reload();
    await tab.getByRole('button', { name: 'Mark as unread', exact: true }).waitFor();

    await tab.goto(base + second);
    await tab.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await tab.getByRole('button', { name: 'Mark as unread', exact: true }).waitFor();
    await tab.goto(base + first);
    await tab.getByRole('button', { name: 'Mark as unread', exact: true }).click();

    await tab.goto(base);
    await tab.locator('[data-book="the-nvidia-way"]').getByText('1 of 14 chapters finished', { exact: true }).waitFor();
    await tab.goto(base + book);
    assert.notEqual(await tab.locator('a[href="' + first + '"] [data-page-progress]').textContent(), 'Finished');
    assert.equal(await tab.locator('a[href="' + second + '"] [data-page-progress]').textContent(), 'Finished');
  } finally {
    await tab.close();
  }
});

test('resumes the latest chapter of each book independently', { skip }, async t => {
  const prepared = await stat('.local/books/zero-to-one/manifest.json').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!prepared) return t.skip('The locally supplied Zero to One PDF has not been prepared');

  const tab = await browser.newPage();
  try {
    const firstChapter = '/books/zero-to-one/01-the-challenge-of-the-future';
    await tab.goto(base);
    const book = tab.locator('[data-book="zero-to-one"]');
    const other = tab.locator('[data-book="causal-inference"]');
    await book.getByRole('link', { name: /Zero to One/ }).click();
    await tab.getByRole('link', { name: /The Challenge of the Future/ }).click();
    assert.equal(new URL(tab.url()).pathname, firstChapter);
    const paragraph = tab.locator('#article p').nth(12);
    await tab.evaluate(() => document.fonts.ready);
    await paragraph.evaluate(element => scrollTo(0, scrollY + element.getBoundingClientRect().top - 115));
    const anchor = await paragraph.getAttribute('id');
    await tab.goto(base);
    const resume = book.getByRole('link', { name: 'Continue reading →' });
    await resume.waitFor();
    assert.equal(await resume.getAttribute('href'), firstChapter);
    await other.getByText('To read', { exact: true }).waitFor();
    assert.equal(await other.getByRole('link', { name: 'Continue reading →' }).count(), 0);
    await resume.click();
    await tab.waitForURL(base + firstChapter);
    await tab.waitForFunction(id => Math.abs((document.getElementById(id)?.getBoundingClientRect().top ?? 0) - 115) < 5, anchor);
  } finally {
    await tab.close();
  }
});

test('looks up, saves, and recalls a term in its original chapter', { skip }, async () => {
  await page.goto(base + '/books/causal-inference/01-introduction-to-causality');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('#article mjx-container'));
  const paragraph = page.locator('#article p').filter({ hasText: 'The treatment here doesn’t need to be a medicine' });
  await paragraph.scrollIntoViewIfNeeded();
  await lookup(paragraph, 'treatment', 'воздействие');
  assert.equal(await page.locator('#translation-source').innerText(), 'Book glossary');
  await page.getByRole('button', { name: 'In context' }).click();
  await page.locator('#context').getByText(/выдача планшетов/).waitFor();
  await capture('11-book-lookup.png');
  await page.getByRole('button', { name: 'Save expression' }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Vocabulary', exact: true }).click();
  await page.getByRole('heading', { name: 'Vocabulary', exact: true }).waitFor();
  const review = page.locator('details').filter({ hasText: 'treatment' });
  assert.ok(!await review.getByText('воздействие', { exact: true }).isVisible());
  await review.getByText('Show answer').click();
  await review.getByText('воздействие', { exact: true }).waitFor();
  await capture('12-vocabulary.png');
  const reference = review.getByRole('link', { name: /Go to the passage/ });
  const href = await reference.getAttribute('href');
  await reference.click();
  assert.ok(page.url().endsWith(href));
  const target = page.locator(new URL(page.url()).hash);
  await target.getByText(/The treatment here doesn’t need to be a medicine/).waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector(location.hash).getBoundingClientRect().top - 82) < 5);
  await page.evaluate(() => scrollBy(0, 1000));
  await page.waitForFunction(() => document.querySelector(location.hash).getBoundingClientRect().bottom < 0);
  await page.getByRole('link', { name: 'Vocabulary', exact: true }).click();
  await review.getByText('Show answer').click();
  await reference.click();
  await target.waitFor();
  await page.waitForFunction(id => Math.abs((document.getElementById(id)?.getBoundingClientRect().top ?? 0) - 82) < 5, new URL(base + href).hash.slice(1));
});

test('returns the selected book sentence alongside the glossary explanation', { skip }, async () => {
  const lookup = new URL('/books/causal-inference/lookup', base);
  lookup.search = new URLSearchParams({
    context: '1', text: 'treatment',
    sentence: 'The treatment in this study is sending email to customers.',
  });
  const response = await page.request.get(lookup.href);
  assert.equal(response.status(), 200);
  const explanation = await response.json();
  assert.match(explanation.text, /вмешательство/iu);
  const translatedSentence = explanation.text.split('\n\n').at(1);
  assert.match(translatedSentence, /(?:почт|письм|рассылк).*(?:клиент|покупател)/iu);
});

test('compares both versions of a figure on desktop and mobile and shows the chapter quiz', { skip }, async () => {
  const desktop = page;
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(base + '/books/causal-inference/03-stats-review-the-most-dangerous-equation');
    await page.waitForFunction(() => document.querySelector('#article mjx-container'));
    const figure = page.getByRole('button', { name: /Enlarge/ }).first();
    await figure.scrollIntoViewIfNeeded();
    await figure.click();
    const dialog = page.locator('#book-figure-dialog');
    await dialog.waitFor();
    const styled = dialog.getByRole('region', { name: 'Reader version image' });
    const original = dialog.getByRole('region', { name: 'Original image' });
    const images = dialog.locator('img');
    await images.evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    assert.match(await styled.locator('img').getAttribute('src'), /\/figures\//);
    assert.match(await original.locator('img').getAttribute('src'), /\/images\//);
    assert.ok((await original.boundingBox()).y > (await styled.boundingBox()).y);
    await capture('13-figure-mobile.png');
    await page.setViewportSize({ width: 1440, height: 950 });
    assert.ok((await original.boundingBox()).x > (await styled.boundingBox()).x);
    assert.equal((await original.boundingBox()).y, (await styled.boundingBox()).y);
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    assert.ok(await styled.evaluate(el => el.scrollWidth > el.clientWidth));
    assert.ok(await original.evaluate(el => el.scrollWidth > el.clientWidth));
    await styled.evaluate(el => { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; });
    await page.waitForFunction(() => {
      const original = document.querySelector('[aria-label="Original image"]');
      return Math.abs(original.scrollLeft / (original.scrollWidth - original.clientWidth) - 0.5) < 0.02;
    });
    await dialog.getByRole('button', { name: 'Fit both' }).click();
    assert.ok(await styled.evaluate(el => el.scrollWidth === el.clientWidth));
    assert.ok(await original.evaluate(el => el.scrollWidth === el.clientWidth));
    await page.keyboard.press('Escape');
    assert.ok(!await dialog.isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    const firstQuestion = page.locator('#quiz .question').first();
    await page.locator('#quiz > summary').click();
    await firstQuestion.getByRole('textbox').fill('Larger samples reduce the variation of the sample mean.');
    await firstQuestion.getByRole('button', { name: 'Check answer' }).click();
    const passage = firstQuestion.getByRole('link', { name: /Go to the passage/ });
    const anchor = await passage.getAttribute('href');
    await passage.click();
    assert.equal(new URL(page.url()).hash, anchor);
    await page.locator(anchor).waitFor();
    await page.goBack();
    assert.equal(new URL(page.url()).hash, '');
    await page.waitForFunction(() => {
      const link = document.activeElement;
      if (!link?.matches('#quiz .expected a')) return false;
      const { top, bottom } = link.getBoundingClientRect();
      return top > 0 && bottom < innerHeight;
    });
    await passage.click();
    const backToQuiz = page.getByRole('button', { name: '← Back to quiz' });
    await backToQuiz.click();
    assert.ok(await passage.evaluate(el => el === document.activeElement));
    await passage.click();
    await page.reload();
    await page.locator('#quiz > summary').click();
    assert.equal(await firstQuestion.getByRole('textbox').inputValue(), 'Larger samples reduce the variation of the sample mean.');
  } finally {
    await page.close();
    page = desktop;
  }
});

test('serves all book pages with readable equations and locally available figures', { skip }, async () => {
  const manifest = JSON.parse(await readFile('.local/books/causal-inference/manifest.json', 'utf8'));
  await page.setViewportSize({ width: 320, height: 800 });
  for (const item of manifest.items) {
    const reply = await page.goto(base + '/books/causal-inference/' + item.slug);
    assert.equal(reply.status(), 200, item.title);
    await page.evaluate(async () => { await window.MathJax?.startup?.promise; });
    assert.equal(await page.locator('#article h1').first().innerText(), item.title);
    const math = page.locator('article .math');
    assert.equal(await math.locator('mjx-container').count(), await math.count(), item.title + ' has unrendered math');
    assert.equal(await math.locator('mjx-merror').count(), 0, item.title + ' has an equation error');
    const unavailable = await page.locator('article img').evaluateAll(async images => {
      for (const img of images) img.loading = 'eager';
      const available = await Promise.all(images.map(img => img.decode().then(() => true, () => false)));
      return images.filter((_, i) => !available[i]).map(img => img.src);
    });
    assert.deepEqual(unavailable, [], item.title + ' has missing figures');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await page.setViewportSize({ width: 1440, height: 950 });
});
