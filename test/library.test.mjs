import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { startReader, testData } from './start-reader.mjs';

test('bundled examples work without downloading models', async t => {
  const url = await startReader(t);
  const library = await (await fetch(url)).text();
  assert.match(library, /When a cached answer goes stale/);
  assert.match(library, /Reading a Latency Report/);
  const article = await (await fetch(url + '/read/cache-freshness')).text();
  assert.match(article, /Article quiz/);
  assert.match(article, /href="#the-cost-of-being-wrong"/);
  assert.doesNotMatch(article, /class="original"/);
  const gloss = await fetch(url + '/read/cache-freshness/lookup?text=stale');
  assert.deepEqual(await gloss.json(), { text: 'out of date', source: 'Article glossary' });
  const context = await fetch(url + '/read/cache-freshness/lookup?text=stale&context=1');
  assert.match((await context.json()).text, /booking changes/);
  assert.equal((await fetch(url + '/read/cache-freshness/lookup?text=unlisted')).status, 422);
  const book = '/books/reading-a-latency-report';
  assert.match(await (await fetch(url + book + '/02-compare-like-with-like')).text(), /Chapter quiz/);
  assert.equal((await fetch(url + book + '/figures/traffic-mix.png')).headers.get('content-type'), 'image/png');
});

test('custom library and target language are independent from bundled examples', async t => {
  const data = await testData(t);
  const article = join(data, 'materials', 'local-notes');
  await mkdir(article, { recursive: true });
  await writeFile(join(article, 'article.html'), '<p id="start">Here are some local notes.</p>');
  await writeFile(join(article, 'metadata.json'), JSON.stringify({
    id: 'local-notes', title: 'Local notes', glossaryLanguage: 'es',
  }));
  await writeFile(join(article, 'glossary.json'), JSON.stringify({ notes: ['notas', 'Observaciones de la reunión.'] }));
  const url = await startReader(t, {
    ENGLISH_TOOL_DATA_DIR: data,
    ENGLISH_TOOL_TARGET_LANGUAGE: 'es',
    ENGLISH_TOOL_EXAMPLES: '0',
  });
  const library = await (await fetch(url)).text();
  assert.match(library, /Local notes/);
  assert.doesNotMatch(library, /cached answer|Latency Report/);
  const page = await (await fetch(url + '/read/local-notes')).text();
  assert.match(page, /id="translation" role="status" lang="es"/);
  assert.equal((await (await fetch(url + '/read/local-notes/lookup?text=notes')).json()).text, 'notas');
  assert.equal((await fetch(url + '/read/cache-freshness')).status, 404);
});

test('an Ollama lookup uses the configured language and relevant glossary', async t => {
  const data = await testData(t);
  const article = join(data, 'materials', 'field-study');
  await mkdir(article, { recursive: true });
  await writeFile(join(article, 'metadata.json'), JSON.stringify({
    id: 'field-study', title: 'Field study', glossaryLanguage: 'es',
  }));
  await writeFile(join(article, 'glossary.json'), JSON.stringify({
    treatment: ['intervención', 'Un cambio introducido durante el estudio.'],
    sample: ['muestra', 'Los datos del estudio.'],
  }));
  const calls = [];
  const ollama = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, request: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ done_reason: 'stop', message: { content: 'La intervención empezó el lunes.' } }));
  });
  ollama.listen(0, '127.0.0.1');
  await once(ollama, 'listening');
  t.after(() => ollama.close());
  const url = await startReader(t, {
    ENGLISH_TOOL_DATA_DIR: data, ENGLISH_TOOL_TARGET_LANGUAGE: 'es',
    ENGLISH_TOOL_OLLAMA_URL: 'http://127.0.0.1:' + ollama.address().port,
    ENGLISH_TOOL_OLLAMA_MODEL: 'example:1',
  });
  const query = new URLSearchParams({ text: 'treatment', sentence: 'The treatment began on Monday.', context: '1' });
  const response = await fetch(url + '/read/field-study/lookup?' + query);
  assert.equal((await response.json()).text, 'Un cambio introducido durante el estudio.\n\nLa intervención empezó el lunes.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/chat');
  assert.equal(calls[0].request.model, 'example:1');
  assert.match(calls[0].request.messages[0].content, /Spanish \(es\).*\ntreatment → intervención/s);
  assert.doesNotMatch(calls[0].request.messages[0].content, /muestra/);
  const bundled = await fetch(url + '/read/cache-freshness/lookup?text=stale');
  assert.equal((await bundled.json()).source, 'Ollama');
});
