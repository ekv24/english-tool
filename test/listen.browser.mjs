import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { expressionKey } from '../public/reader-records.js';
import { startReader, testData } from './start-reader.mjs';

const now = Date.now();
const word = (text, translation) => {
  const value = { text, translation, sentence: 'It was ' + text + '.', href: '/read/cache-freshness#p1', title: 'Cache', savedAt: now };
  return [expressionKey(value), now, value];
};
const stale = word('stale', 'устаревший');
const hectic = word('hectic', 'суматошный');

/** Six seconds of silence. Chromium recognises the WAV whatever its name. */
function recording(seconds = 6) {
  const rate = 8000;
  const wav = Buffer.alloc(44 + rate * seconds, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write('data', 36); wav.writeUInt32LE(rate * seconds, 40);
  return wav;
}

async function exchange(url, vocabulary, records = []) {
  const response = await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, records, vocabulary }),
  });
  return (await response.json()).vocabulary;
}

test('the recording plays in a loop, shows each word and counts what was heard, also without a connection', async t => {
  const data = await testData(t);
  const url = await startReader(t, { ENGLISH_TOOL_DATA_DIR: data });
  await exchange(url, true, [stale, hectic]);
  await exchange(url, { type: 'check', checks: [stale, hectic].map(([key, , value]) => ({ key, translation: value.translation })) });
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url + '/vocabulary');
  await page.getByText('2 saved expressions').waitFor();
  const section = page.getByRole('region', { name: 'Listen' });
  assert.equal(await section.isVisible(), false);

  await mkdir(join(data, 'speech'));
  await writeFile(join(data, 'speech', '0123456789abcdef.mp3'), recording());
  await writeFile(join(data, 'speech', 'mix.json'), JSON.stringify({
    version: '0123456789abcdef', seconds: 6, segments: [[0, 1.5, 3, 0], [3, 4.5, 6, 1]],
    cards: [stale, hectic].map(([key, , { text, translation }]) => ({ key, lemma: text, translation })),
  }));
  await page.reload();
  await section.getByText('2 words · repeats until you pause').waitFor();
  await section.getByRole('button', { name: 'Play' }).click();
  await section.getByText('stale', { exact: true }).waitFor();
  assert.equal(await section.locator('[data-listen-translation]').textContent(), '');
  // The recording is on the device now, so the connection may go away.
  await context.setOffline(true);
  await section.getByText('устаревший', { exact: true }).waitFor();
  await section.getByText('суматошный', { exact: true }).waitFor();
  await section.getByText('stale', { exact: true }).waitFor();
  await section.getByRole('button', { name: 'Next' }).click();
  await section.getByText('hectic', { exact: true }).waitFor();
  await section.getByRole('button', { name: 'Pause' }).click();
  await section.getByRole('button', { name: 'Play' }).waitFor();
  const pending = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('vocabulary-heard:pending') ?? '{}')).flat());
  assert.deepEqual((await pending()).sort(), [stale[0], hectic[0]].sort());

  await context.setOffline(false);
  await page.waitForFunction(() => localStorage.getItem('vocabulary-heard:pending') === '{}');
  assert.deepEqual(await pending(), []);
  assert.deepEqual(errors, []);
});
