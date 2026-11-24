import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { expressionKey } from '../public/reader-records.js';
import { startReader, testData } from './start-reader.mjs';

const run = promisify(execFile);

async function exchange(url, records = []) {
  const response = await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, records, vocabulary: true }),
  });
  return await response.json();
}

test('Codex corrects wrong translations once and leaves the reader’s own edits alone', async t => {
  const url = await startReader(t);
  const directory = await testData(t);
  const codex = join(directory, 'codex');
  // Stands in for Codex: answers for the cards it was sent, with one answer that must not be stored.
  await writeFile(codex, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
const cards = JSON.parse(prompt.slice(prompt.lastIndexOf('\\n\\n') + 2));
fs.appendFileSync(${JSON.stringify(join(directory, 'calls'))}, JSON.stringify({ args, cards }) + '\\n');
const answers = { novel: ['novel', 'новый'], ruled: ['rule', 'не тот'], stale: ['stale', 'see https://example.com'] };
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({
  items: cards.map(({ id, text }) => ({ id, lemma: answers[text][0], translation: answers[text][1] })),
}));
`);
  await chmod(codex, 0o755);
  const now = Date.now();
  const word = (text, translation, updatedAt = now) => {
    const value = { text, translation, sentence: 'A ' + text + ' idea.', href: '/read/cache-freshness#p1', title: 'Cache', savedAt: now };
    return [expressionKey(value), updatedAt, value];
  };
  await exchange(url, [word('novel', 'роман'), word('ruled', 'постановил', now + 60_000), word('stale', 'несвежий')]);
  const check = () => run(process.execPath, ['scripts/check-vocabulary.mjs', '--server', url], { env: { ...process.env, ENGLISH_TOOL_CODEX: codex } });
  const { stdout } = await check();
  assert.match(stdout, /novel: роман → новый/);
  assert.match(stdout, /Skipped, no usable answer: stale/);

  const { records, vocabulary } = await exchange(url);
  const saved = records.filter(([, , value]) => value).map(([, , value]) => [value.text, value.translation]).sort();
  assert.deepEqual(saved, [['novel', 'новый'], ['ruled', 'постановил'], ['stale', 'несвежий']]);
  const checked = Object.fromEntries(Object.values(vocabulary.entries).map(entry => [entry.lemma, entry.checked]));
  assert.deepEqual(checked, { novel: true, rule: true, stale: false });

  // The next run asks only about the expression that is still unchecked.
  await check();
  const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.cards.map(card => card.text)), [['novel', 'ruled', 'stale'], ['stale']]);
  assert.deepEqual(calls[0].cards.map(card => card.locked), [false, true, false]);
  assert.ok(calls[0].args.includes('read-only') && !JSON.stringify(calls[0].cards).includes('vocabulary:'));
});
