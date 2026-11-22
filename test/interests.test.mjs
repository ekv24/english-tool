import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { bookContents } from '../book.mjs';
import { expressionKey, isReaderRecord } from '../public/reader-records.js';
import { startReader } from './start-reader.mjs';

/** Runs the agents' command line against a reader. */
async function interests(url, args, input) {
  const child = spawn(process.execPath, ['scripts/interests.mjs', ...args, '--server', url], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.end(input ?? '');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, errors);
  return output;
}

async function exchange(url, body, headers = {}) {
  const response = await fetch(url + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, encoding: response.headers.get('content-encoding'), data: response.ok ? await response.json() : null };
}

test('accepts the records of feedback, reading time, notes and suggestions, and nothing malformed', () => {
  const now = Date.now();
  const saved = { text: 'stale', translation: 'out of date', sentence: 'It went stale.', href: '/read/cache-freshness#p1', title: 'Cache' };
  const suggestion = { title: 'A Book', url: 'https://example.com/book', kind: 'book', why: 'Close to what you finished.', score: 0.7, addedAt: now };
  const valid = [
    [expressionKey(saved), now, { ...saved, savedAt: now }],
    ['activity:reading-a-latency-report/introduction:2026-11-22', now, { seconds: 120, lookups: 3 }],
    ['feedback:cache-freshness', now, { interest: 'more', level: 'hard', note: 'Clear examples.' }],
    ['feedback:cache-freshness', now, {}],
    ['note:mwr2-ab12', now, { text: 'Liked the examples.', kind: 'feedback', source: 'chat', at: now, material: 'cache-freshness' }],
    ['note:mwr2-ab12', now, null],
    ['suggestion:a-book', now, suggestion],
    ['suggestion:a-book', now, { ...suggestion, level: 'right', minutes: 300, author: 'Someone', material: 'a-book' }],
    ['choice:a-book', now, 'want'],
    ['choice:a-book', now, null],
    ['profile:interests', now, { text: '# Interests' }],
  ];
  const invalid = [
    ['activity:cache-freshness:2026-11-22', now, { seconds: 1.5, lookups: 0 }],
    ['activity:cache-freshness', now, { seconds: 10, lookups: 0 }],
    ['feedback:cache-freshness', now, { interest: 'meh' }],
    ['feedback:cache-freshness', now, { interest: 'more', rating: 5 }],
    ['feedback:cache-freshness', now, null],
    ['note:mwr2-ab12', now, { text: '  ', kind: 'feedback', source: 'chat', at: now }],
    ['note:mwr2-ab12', now, { text: 'x', kind: 'rant', source: 'chat', at: now }],
    ['suggestion:a-book', now, { ...suggestion, url: 'javascript:alert(1)' }],
    ['suggestion:a-book', now, { ...suggestion, score: 1.5 }],
    ['suggestion:A Book', now, suggestion],
    ['choice:a-book', now, 'maybe'],
    ['profile:other', now, { text: '' }],
    ['unknown:key', now, true],
  ];
  for (const record of valid) assert.equal(isReaderRecord(record), true, JSON.stringify(record));
  for (const record of invalid) assert.equal(isReaderRecord(record), false, JSON.stringify(record));
});

test('agents read a digest, log notes and offer suggestions through the reader', async t => {
  const url = await startReader(t);
  const library = await (await fetch(url + '/api/library')).json();
  const article = library.articles.find(item => item.id === 'cache-freshness');
  assert.ok(article.words > 100);
  const book = library.books.find(item => item.id === 'reading-a-latency-report');
  assert.deepEqual(book.pages.map(page => page.slug), ['introduction', '01-read-a-percentile', '02-compare-like-with-like']);
  assert.ok(book.pages.every(page => page.words > 0));

  // What the site records while the reader reads and answers "Your take".
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  assert.equal((await exchange(url, { since: 0, records: [
    ['reading:v3:cache-freshness', now, { anchor: '', offset: 0, y: 600, percent: 50 }],
    ['activity:cache-freshness:' + day, now, { seconds: 300, lookups: 6 }],
    ['feedback:cache-freshness', now, { interest: 'more', level: 'right' }],
  ] })).status, 200);

  assert.match(await interests(url, ['note', 'The examples about bookings were useful.', '--material', 'cache-freshness', '--kind', 'feedback']), /^Logged note:/);
  await interests(url, ['note', 'More about databases, please.', '--kind', 'interest']);
  await interests(url, ['suggest', '--title', 'Designing Data-Intensive Applications', '--url', 'https://example.com/ddia', '--kind', 'book',
    '--why', 'Caches and consistency, at your level.', '--score', '0.8', '--author', 'Martin Kleppmann', '--level', 'right']);
  await interests(url, ['profile', '--set', '-'], '# Interests\n\n- Systems that keep data fresh\n');
  assert.equal(await interests(url, ['profile']), '# Interests\n\n- Systems that keep data fresh\n\n');

  let digest = JSON.parse(await interests(url, ['digest', '--json']));
  const read = digest.materials.find(material => material.id === 'cache-freshness');
  assert.equal(read.percent, 50);
  assert.equal(read.readingSeconds, 300);
  assert.equal(read.lookups, 6);
  assert.deepEqual(read.feedback, { interest: 'more', level: 'right' });
  assert.deepEqual(read.notes.map(note => [note.kind, note.source, note.text]), [['feedback', 'chat', 'The examples about bookings were useful.']]);
  assert.deepEqual(digest.journal.map(note => note.text), ['More about databases, please.']);
  assert.deepEqual(digest.suggestions.map(item => [item.id, item.choice, item.score]), [['designing-data-intensive-applications', 'open', 0.8]]);
  assert.match(digest.profile, /keep data fresh/);
  assert.match(await interests(url, ['digest']), /### When a cached answer goes stale[\s\S]*interest: More like this · English: Just right/);

  // The reader keeps the suggestion in the library; the agent then imports it and forgets the note.
  await exchange(url, { since: 0, records: [['choice:designing-data-intensive-applications', Date.now(), 'want']] });
  await interests(url, ['imported', 'designing-data-intensive-applications', 'ddia']);
  await interests(url, ['forget', digest.journal[0].key]);
  digest = JSON.parse(await interests(url, ['digest', '--json']));
  assert.deepEqual(digest.suggestions.map(item => [item.choice, item.material]), [['want', 'ddia']]);
  assert.deepEqual(digest.journal, []);
});

test('a browser that remembers its revision receives only newer records, compressed when large', async t => {
  const url = await startReader(t);
  const first = await exchange(url, { since: 0, records: [] });
  assert.equal(typeof first.data.epoch, 'string');
  const now = Date.now();
  const notes = Array.from({ length: 12 }, (_, i) =>
    ['note:n' + i, now, { text: 'A note long enough to make the answer worth compressing, number ' + i + '.', kind: 'note', source: 'agent', at: now }]);
  const second = await exchange(url, { since: first.data.revision, epoch: first.data.epoch, records: notes }, { 'Accept-Encoding': 'br' });
  assert.equal(second.encoding, 'br');
  const later = await exchange(url, { since: second.data.revision, epoch: first.data.epoch, records: [['note:last', now, { text: 'Last.', kind: 'note', source: 'agent', at: now }]] });
  assert.deepEqual(later.data.records.map(([key]) => key), ['note:last']);
  // A revision from another database's history does not count: the browser gets everything.
  const other = await exchange(url, { since: later.data.revision, epoch: 'another-database', records: [] });
  assert.equal(other.data.records.length, 13);
  assert.equal((await exchange(url, { since: 0, epoch: 7, records: [] })).status, 400);
  assert.equal((await exchange(url, { since: 0, records: [['suggestion:x', now, { title: 'X', url: 'ftp://x', kind: 'book', why: 'x', score: 1, addedAt: now }]] })).status, 400);
});

test('a part that opens with its own title page links it from the heading instead of listing it twice', () => {
  const page = (slug, title, type = 'chapter') => ({ slug, title, type, original: slug + '.html', words: 100 });
  const book = {
    id: 'sample', title: 'Sample', author: 'Author',
    items: [page('introduction', 'Introduction', 'intro'), page('part-1', 'PART 1: The Idea'), page('01-one', 'Chapter 1: One')],
    toc: [{ title: 'Part 1: The Idea', entries: [{ slug: 'part-1' }, { slug: '01-one' }] }],
  };
  const html = bookContents(book);
  assert.match(html, /<h3 class="book-part-title"><a href="\/books\/sample\/part-1"[^>]*data-book-page="part-1"/);
  assert.equal(html.match(/data-book-page="part-1"/g).length, 1);
  assert.match(html, /<li class="book-entry"><a href="\/books\/sample\/01-one"/);
});
