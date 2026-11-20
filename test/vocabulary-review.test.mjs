import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openReaderState } from '../reader-state.mjs';
import { expressionKey } from '../public/reader-records.js';

const book = '/books/causal-inference/01-introduction-to-causality#bias';
const article = '/read/harness-design#paragraph-2';
const day = 86_400_000;

function record(text, translation, sentence, href = book, savedAt = 1) {
  const value = { text, translation, sentence, href, title: 'Reading material', savedAt };
  return [expressionKey(value), savedAt, value];
}

const treatment = record('treatment', 'воздействие', 'The treatment was assigned randomly.');
const medical = record('treatment', 'лечение', 'Patients started treatment on Monday.', article);
const ruled = record('ruled out', 'исключить', 'They ruled out a competing explanation.', article);
const plural = record('potential outcomes', 'потенциальные исходы', 'The potential outcomes differ.');
const singular = record('potential outcome', 'потенциальный исход', 'A potential outcome can be observed.');
const bias = record('omitted variable bias', 'смещение из-за пропущенной переменной', 'This is omitted variable bias.');
const rare = record('herculean', 'геркулесов', 'That was a Herculean task.');

test('reviews base forms with distinct senses and lets the reader opt into a rare expression', () => {
  const exchange = openReaderState(':memory:');
  // A fixed index keeps the expected suggestions independent from the materials in the local library.
  const index = { pages: [], glossaries: new Map([['causal-inference', new Map([
    ['treatment', 'воздействие'], ['potential outcome', 'потенциальный исход'], ['potential outcomes', 'потенциальные исходы'],
    ['omitted variable bias', 'смещение из-за пропущенной переменной'],
  ])]]) };
  const now = Date.now() - day;
  const initial = exchange(0, [treatment, medical, ruled, plural, singular, bias, rare], index, undefined).vocabulary;
  assert.equal(initial.entries[ruled[0]].lemma, 'rule out');
  assert.equal(initial.entries[bias[0]].lemma, 'omitted variable bias');
  assert.equal(initial.entries[rare[0]].suggested, false);
  assert.equal(initial.entries[plural[0]].lemma, 'potential outcome');
  assert.equal(initial.available, 4);
  const excluded = { type: 'preference', key: singular[0], preference: 'exclude' };
  assert.equal(exchange(0, [], index, excluded).vocabulary.entries[plural[0]].preference, 'exclude');
  const include = { type: 'preference', key: rare[0], preference: 'include' };
  assert.equal(exchange(0, [], index, include).vocabulary.available, 4);
  const session = exchange(0, [], index, { type: 'start', after: null }).vocabulary.session;
  assert.equal(session.queue[0].lemma.toLowerCase(), 'herculean');
  assert.equal(session.queue.filter(card => card.lemma === 'treatment').length, 1);
  assert.ok(session.queue.find(card => card.lemma === 'treatment').showContext);
  assert.deepEqual(exchange(0, [], index, { type: 'start', after: null }).vocabulary.session, session);
  const answer = { type: 'answer', id: session.id, step: 0, grade: 'remembered', answeredAt: now };
  const reviewed = exchange(0, [], index, answer).vocabulary;
  assert.equal(reviewed.session.step, 1);
  assert.equal(reviewed.entries[rare[0]].dueAt, now + day);
  const replay = exchange(0, [], index, { ...answer, grade: 'again', answeredAt: now + 1000 }).vocabulary;
  assert.equal(replay.entries[rare[0]].dueAt, now + day);
  assert.equal(replay.session.step, 1);
});

test('offers five cards after an absence, including when one thousand are due', () => {
  const exchange = openReaderState(':memory:');
  const list = Array.from({ length: 1000 }, (_, i) => record('word ' + i, 'термин ' + i, '', book, i + 1));
  const index = { pages: [], glossaries: new Map() };
  // Make all of the expressions eligible, then review them using a deterministic clock.
  const start = Date.UTC(2026, 8, 1);
  let now = start;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    exchange(0, list);
    for (const [key] of list) exchange(0, [], index, { type: 'preference', key, preference: 'include' });
    let after = null;
    for (let i = 0; i < 200; i++) {
      const session = exchange(0, [], index, { type: 'start', after }).vocabulary.session;
      assert.equal(session.total, 5);
      for (let step = 0; step < 5; step++) {
        exchange(0, [], index, { type: 'answer', id: session.id, step, grade: 'remembered', answeredAt: now });
      }
      after = session.id;
    }
    assert.equal(exchange(0, [], index).vocabulary.available, 0);
    now += 30 * day;
    const resumed = exchange(0, [], index, { type: 'start', after }).vocabulary;
    assert.equal(resumed.session.total, 5);
    assert.equal(resumed.available, 5);
    assert.equal(Object.values(resumed.entries).filter(entry => entry.dueAt < now).length, 1000);
    const earned = exchange(0, [], index, {
      type: 'answer', id: resumed.session.id, step: 0, grade: 'remembered', answeredAt: now,
    }).vocabulary;
    assert.equal(earned.entries[resumed.session.queue[0].sourceKey].dueAt, now + 3 * day);
    const forgotten = exchange(0, [], index, {
      type: 'answer', id: resumed.session.id, step: 1, grade: 'again', answeredAt: now,
    }).vocabulary;
    assert.equal(forgotten.entries[resumed.session.queue[1].sourceKey].dueAt, now + day);
  } finally { Date.now = originalNow; }
});

test('keeps the glossary form when a saved adjectival translation matches it', () => {
  const exchange = openReaderState(':memory:');
  const index = { pages: [], glossaries: new Map([['harness-design', new Map([
    ['addicting', 'затягивающий'], ['well established', 'давно устоявшийся'],
  ])]]) };
  const addicting = record('addicting', 'затягивающий', "It's addicting to watch people succeed.", article);
  const established = record('well established', 'давно устоявшийся', 'Well established and accessible to beginners.', article);
  const { entries } = exchange(0, [addicting, established], index).vocabulary;
  assert.equal(entries[addicting[0]].lemma, 'addicting');
  assert.equal(entries[established[0]].lemma, 'well established');
});
