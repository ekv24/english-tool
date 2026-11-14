import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { startReader } from './start-reader.mjs';

test('read, look up, save and review an expression across devices', async t => {
  const url = await startReader(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  for (const page of [phone, desktop]) {
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
  }
  await desktop.goto(url);
  await desktop.getByRole('link', { name: /When a cached answer goes stale/ }).click();
  const paragraph = desktop.locator('#article p').filter({ hasText: 'while it sits there' });
  const point = await paragraph.evaluate(p => {
    const text = p.firstChild;
    const offset = text.textContent.indexOf('stale');
    const word = document.createRange();
    word.setStart(text, offset);
    word.setEnd(text, offset + 'stale'.length);
    const position = word.getBoundingClientRect();
    return { x: position.x + position.width / 2, y: position.y + position.height / 2 };
  });
  await desktop.mouse.click(point.x, point.y);
  await desktop.waitForFunction(() => document.getElementById('translation').textContent === 'out of date');
  const pushed = desktop.waitForResponse(response => response.url().endsWith('/api/reader-state') &&
    response.request().postDataJSON()?.records?.some(([key]) => key.startsWith('vocabulary:')));
  await desktop.getByRole('button', { name: 'Save expression' }).click();
  await pushed;
  await phone.goto(url + '/vocabulary');
  await phone.getByText('stale', { exact: true }).tap();
  const add = phone.getByRole('button', { name: 'Add to review' });
  if (await add.isVisible()) await add.tap();
  await phone.getByRole('button', { name: 'Start review' }).tap();
  await phone.getByRole('heading', { name: 'stale', exact: true }).waitFor();
  await desktop.goto(url + '/vocabulary');
  await desktop.getByRole('button', { name: 'Continue review' }).click();
  await desktop.getByRole('button', { name: 'Show answer' }).click();
  const answer = desktop.locator('[data-review-translation]');
  await answer.waitFor();
  assert.equal(await answer.innerText(), 'out of date');
  await desktop.getByRole('button', { name: 'Remembered' }).click();
  await desktop.getByRole('heading', { name: 'Review complete' }).waitFor();
  assert.deepEqual(errors, []);
});

test('chapter quiz and both versions of a figure are usable on a narrow screen', async t => {
  const url = await startReader(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(url + '/books/reading-a-latency-report/02-compare-like-with-like');
  await page.getByRole('button', { name: /Enlarge figure/ }).tap();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  assert.equal(await dialog.locator('img').count(), 2);
  await dialog.getByRole('button', { name: 'Close figure' }).tap();
  await page.locator('#quiz > summary').tap();
  await page.getByLabel('Your answer').first().fill('The traffic mix changed.');
  await page.getByRole('button', { name: 'Check answer' }).first().tap();
  await page.getByRole('link', { name: /Go to the passage/ }).first().tap();
  assert.match(page.url(), /#[a-z-]+$/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('a second browser resumes at the saved passage', async t => {
  const url = await startReader(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const viewport = { width: 390, height: 844 };
  const first = await browser.newPage({ viewport });
  const second = await browser.newPage({ viewport });
  for (const page of [first, second]) page.setDefaultTimeout(8000);
  const articleUrl = url + '/read/cache-freshness';
  await first.goto(articleUrl);
  await first.evaluate(() => document.fonts.ready.then(() => undefined));
  const section = '#the-cost-of-being-wrong';
  const pushed = first.waitForResponse(response => response.url().endsWith('/api/reader-state') &&
    response.request().postDataJSON()?.records?.some(([key]) => key === 'reading:v3:cache-freshness'));
  await first.locator(section).evaluate(element => scrollTo(0, scrollY + element.getBoundingClientRect().top - 130));
  await pushed;
  await second.goto(articleUrl);
  await second.waitForFunction(selector =>
    Math.abs(document.querySelector(selector).getBoundingClientRect().top - 130) < 5, section);
});
