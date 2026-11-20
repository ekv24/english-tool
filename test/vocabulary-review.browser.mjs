import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { expressionKey } from '../public/reader-records.js';
import { chromium, devices, webkit } from 'playwright-core';
import { startReader, testData } from './start-reader.mjs';

const book = '/books/causal-inference/01-introduction-to-causality#bias';
const article = '/read/harness-design#paragraph-2';
const day = 86_400_000;

function record(text, translation, sentence, href = book, savedAt = 1) {
  const value = { text, translation, sentence, href, title: 'Reading material', savedAt };
  return [expressionKey(value), savedAt, value];
}

const treatment = record('treatment', 'воздействие', 'The treatment was assigned randomly.');
const ruled = record('ruled out', 'исключить', 'They ruled out a competing explanation.', article);
const plural = record('potential outcomes', 'потенциальные исходы', 'The potential outcomes differ.');
const bias = record('omitted variable bias', 'смещение из-за пропущенной переменной', 'This is omitted variable bias.');
const rare = record('herculean', 'геркулесов', 'That was a Herculean task.');
const other = record('parallel trends', 'параллельные тренды', 'The parallel trends assumption matters.');

test('continues Vocabulary review in another browser and syncs an offline answer', async t => {
  // A one-chapter book whose glossary marks the saved terms as worth reviewing.
  const data = await testData(t);
  const chapter = join(data, 'books', 'causal-inference');
  await mkdir(chapter, { recursive: true });
  await writeFile(join(chapter, 'manifest.json'), JSON.stringify({
    id: 'causal-inference', title: 'Causal inference', author: 'Test author', toc: [],
    items: [{ slug: '01-introduction-to-causality', title: 'Introduction', original: '', type: 'chapter' }],
  }));
  await writeFile(join(chapter, '01-introduction-to-causality.html'), '<h2 id="bias">Bias</h2><p>The treatment was assigned randomly.</p>');
  await writeFile(join(chapter, 'glossary.json'), JSON.stringify({
    treatment: ['воздействие', ''], 'potential outcomes': ['потенциальные исходы', ''],
    'omitted variable bias': ['смещение из-за пропущенной переменной', ''], 'parallel trends': ['параллельные тренды', ''],
  }));
  const url = await startReader(t, { ENGLISH_TOOL_DATA_DIR: data });
  const response = await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since: 0, records: [treatment, ruled, plural, bias, rare, other] }),
  });
  assert.equal(response.status, 200);
  const [desktopBrowser, mobileBrowser] = await Promise.all([chromium.launch(), webkit.launch()]);
  t.after(() => Promise.all([desktopBrowser.close(), mobileBrowser.close()]));
  const mobile = await mobileBrowser.newContext(devices['iPhone 13']);
  const phone = await mobile.newPage();
  const mac = await desktopBrowser.newPage({ viewport: { width: 1440, height: 950 } });
  phone.setDefaultTimeout(8000);
  mac.setDefaultTimeout(8000);
  const vocabulary = url + '/vocabulary';
  await phone.goto(vocabulary);
  await phone.getByRole('button', { name: 'Start review' }).tap();
  await phone.getByText('1 / 5', { exact: true }).waitFor();
  const first = await phone.locator('#review-heading').innerText();
  assert.ok(!await phone.locator('[data-review-translation]').isVisible());
  await phone.getByRole('button', { name: 'Show answer' }).tap();
  const saved = phone.waitForResponse(response => response.url().endsWith('/api/reader-state') &&
    response.request().postDataJSON()?.vocabulary?.type === 'answer');
  await phone.getByRole('button', { name: 'Remembered' }).tap();
  await saved;
  await phone.close();
  await mac.goto(vocabulary);
  await mac.getByRole('button', { name: 'Continue review' }).click();
  await mac.getByText('2 / 5', { exact: true }).waitFor();
  assert.notEqual(await mac.locator('#review-heading').innerText(), first);
  await mac.getByRole('button', { name: 'Show answer' }).click();
  const again = mac.waitForResponse(response => response.url().endsWith('/api/reader-state') &&
    response.request().postDataJSON()?.vocabulary?.type === 'answer');
  await mac.getByRole('button', { name: 'Again' }).click();
  await again;
  const phoneAgain = await mobile.newPage();
  await phoneAgain.goto(vocabulary);
  await phoneAgain.getByRole('button', { name: 'Continue review' }).tap();
  await phoneAgain.getByText('3 / 5', { exact: true }).waitFor();
  if (process.env.READER_REVIEW_SCREENSHOTS) {
    await phoneAgain.screenshot({ path: process.env.READER_REVIEW_SCREENSHOTS + '/review-iphone.png', scale: 'css' });
    await mac.screenshot({ path: process.env.READER_REVIEW_SCREENSHOTS + '/review-desktop.png' });
  }
  await mobile.setOffline(true);
  await phoneAgain.getByRole('button', { name: 'Show answer' }).tap();
  await phoneAgain.getByRole('button', { name: 'Remembered' }).tap();
  await phoneAgain.locator('.review-session').getByText('Waiting to sync.', { exact: false }).waitFor();
  await phoneAgain.getByText('4 / 5', { exact: true }).waitFor();
  await mac.getByText('3 / 5', { exact: true }).waitFor();
  await mobile.setOffline(false);
  await mac.getByText('4 / 5', { exact: true }).waitFor();
  await mac.getByRole('button', { name: 'Show answer' }).click();
  await mac.getByRole('button', { name: 'Remembered' }).click();
  await mac.getByText('5 / 5', { exact: true }).waitFor();
  await mac.getByRole('button', { name: 'Show answer' }).click();
  await mac.getByRole('button', { name: 'Remembered' }).click();
  await mac.getByRole('heading', { name: 'Review complete' }).waitFor();
  await mac.getByText('5 expressions reviewed').waitFor();
  await mac.getByRole('button', { name: '← Vocabulary' }).click();
  await mac.getByText(/^Next review /).waitFor();
  assert.equal(await phoneAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const savedExpression = mac.locator('.vocabulary-list details').filter({ hasText: 'herculean' });
  await savedExpression.locator('summary').click();
  await savedExpression.getByRole('button', { name: 'Add to review' }).click();
  await mac.getByRole('button', { name: 'Review more' }).click();
  const review = mac.locator('.review-session');
  const expression = review.getByRole('heading', { name: 'herculean', exact: false });
  await expression.waitFor();
  assert.equal(await expression.evaluate(el => document.activeElement === el), true);
  assert.equal(await review.getByRole('progressbar').getAttribute('aria-valuetext'), 'Card 1 of 1');
  const example = review.locator('blockquote');
  const translation = review.locator('[data-review-translation]');
  assert.equal(await example.isVisible(), false);
  assert.equal(await translation.isVisible(), false);
  await review.getByRole('button', { name: 'Show context' }).click();
  assert.equal(await example.innerText(), 'That was a Herculean task.');
  assert.equal(await example.evaluate(el => document.activeElement === el), true);
  assert.equal(await translation.isVisible(), false);
  await review.getByRole('button', { name: 'Show answer' }).click();
  assert.equal(await translation.innerText(), 'геркулесов');
  assert.equal(await translation.evaluate(el => document.activeElement === el), true);
  assert.equal(await review.getByRole('link', { name: /Source passage/ }).getAttribute('href'), book);
  await review.getByRole('button', { name: 'Exclude from review' }).click();
  await review.getByRole('heading', { name: 'Review complete' }).waitFor();
  assert.equal(await review.getByText(/expressions? reviewed/).isVisible(), false);
  await review.getByRole('button', { name: '← Vocabulary' }).click();
  await savedExpression.getByRole('button', { name: 'Add to review' }).waitFor();
});
