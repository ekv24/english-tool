import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { startReader } from './start-reader.mjs';

async function readerState(url) {
  const response = await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, records: [] }),
  });
  return new Map((await response.json()).records.map(([key, , value]) => [key, value]));
}

/** @param {() => Promise<boolean>} condition */
async function eventually(condition, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const pad = number => String(number).padStart(2, '0');
const today = () => { const now = new Date(); return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()); };

/** Clicks a word of the sample article, which opens its lookup. */
async function lookUp(page, word) {
  const point = await page.locator('#article p').filter({ hasText: 'while it sits there' }).evaluate((p, word) => {
    const text = p.firstChild;
    const range = document.createRange();
    range.setStart(text, text.textContent.indexOf(word));
    range.setEnd(text, text.textContent.indexOf(word) + word.length);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, word);
  await page.mouse.click(point.x, point.y);
}

test('the reader’s take and lookups reach the server, and another browser shows the take', async t => {
  const url = await startReader(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto(url + '/read/cache-freshness');
  await lookUp(page, 'stale');
  await page.waitForFunction(() => document.getElementById('translation').textContent === 'out of date');
  await page.keyboard.press('Escape');

  const card = page.getByRole('region', { name: 'Your take' });
  await card.getByRole('button', { name: 'More like this' }).click();
  await card.getByRole('button', { name: 'Hard' }).click();
  await card.getByRole('button', { name: 'Easy' }).click();
  await card.getByText('Add a note').click();
  await card.getByLabel('What stood out').fill('The booking example made it clear.');
  await card.getByLabel('What stood out').blur();
  assert.equal(await card.getByRole('button', { name: 'More like this' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await card.getByRole('button', { name: 'Hard' }).getAttribute('aria-pressed'), 'false');
  // Choosing the selected answer again clears it.
  await card.getByRole('button', { name: 'Easy' }).click();
  assert.equal(await card.getByRole('button', { name: 'Easy' }).getAttribute('aria-pressed'), 'false');

  // Leaving the page sends the lookup count along with what is still pending.
  await page.goto(url + '/');
  await eventually(async () => (await readerState(url)).get('activity:cache-freshness:' + today())?.lookups === 1);
  const state = await readerState(url);
  assert.deepEqual(state.get('feedback:cache-freshness'), { interest: 'more', note: 'The booking example made it clear.' });

  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await other.goto(url + '/read/cache-freshness');
  const shown = other.getByRole('region', { name: 'Your take' });
  await other.waitForFunction(() => document.querySelector('[data-interest="more"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await shown.getByLabel('What stood out').inputValue(), 'The booking example made it clear.');
  assert.deepEqual(errors, []);
});

test('reading time counts only while the reader is active', async t => {
  const url = await startReader(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.clock.install();
  await page.goto(url + '/read/cache-freshness');
  // An instant scroll, finished before the clock jumps, so it counts as activity at the start.
  await page.evaluate(() => scrollTo(0, 300));
  await page.waitForTimeout(300);
  const seconds = () => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('reader-state:v1:activity:cache-freshness:'))
    .reduce((sum, [, raw]) => sum + JSON.parse(raw).record[2].seconds, 0));
  await page.clock.runFor(61_000);
  assert.equal(await seconds(), 60);
  // Without scrolling, tapping or typing, counting stops after a minute and a half.
  await page.clock.runFor(240_000);
  const idle = await seconds();
  assert.ok(idle >= 75 && idle <= 90, String(idle));
  await page.clock.runFor(120_000);
  assert.equal(await seconds(), idle);
});

test('suggestions from agents appear in the library, where the reader keeps or hides them', async t => {
  const url = await startReader(t);
  const now = Date.now();
  const suggestion = (title, score) => ({ title, url: 'https://example.com/' + score, kind: 'article', why: 'Because of ' + title, score, addedAt: now });
  await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since: 0, records: [
      ['suggestion:cache-design', now, { ...suggestion('Cache design in practice', 0.9), publisher: 'Example', minutes: 12, level: 'right' }],
      ['suggestion:queueing', now, suggestion('Queueing for beginners', 0.6)],
    ] }),
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  const syncs = [];
  page.on('request', request => { if (request.url().endsWith('/api/reader-state')) syncs.push(request.postDataJSON()); });
  await page.goto(url);
  const section = page.getByRole('region', { name: 'For you' });
  await section.getByRole('heading', { name: 'Cache design in practice' }).waitFor();
  assert.deepEqual(await section.locator('.suggestion-title').allTextContents(), ['Cache design in practice', 'Queueing for beginners']);
  assert.match(await section.locator('.suggestion-meta').first().textContent(), /Article · Example · 12 min · Your level/);

  await section.getByRole('button', { name: 'Want to read' }).first().click();
  await section.getByText('Ask Claude or Codex to add it to your library.').waitFor();
  await section.getByRole('button', { name: 'Not interested' }).last().click();
  await section.getByRole('button', { name: 'Undo' }).waitFor();
  await eventually(async () => (await readerState(url)).get('choice:queueing') === 'dismissed');
  assert.equal((await readerState(url)).get('choice:cache-design'), 'want');

  // A new page asks only for what changed since this browser last synced.
  syncs.length = 0;
  await page.reload();
  await section.getByRole('heading', { name: 'Cache design in practice' }).waitFor();
  assert.equal(await section.locator('.suggestion').count(), 1);
  assert.ok(syncs[0].since > 0 && typeof syncs[0].epoch === 'string', JSON.stringify(syncs[0]));
});
