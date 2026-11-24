import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openReaderState } from '../reader-state.mjs';
import { isReviewAction, listeningChance, nextStage } from '../vocabulary-review.mjs';
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
    // Recalled after a 30-day gap, the card keeps the 30-day interval it has just survived.
    assert.equal(earned.entries[resumed.session.queue[0].sourceKey].dueAt, now + 30 * day);
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

test('schedules reviews from the time that actually passed', () => {
  assert.equal(nextStage(-1, 0, day, 'remembered'), 0, 'a new card starts at one day');
  assert.equal(nextStage(0, day, 2 * day, 'remembered'), 1, 'an on-time review moves one step');
  assert.equal(nextStage(0, day, 41 * day, 'remembered'), 4, 'a card recalled after 40 days keeps a 30-day interval');
  assert.equal(nextStage(6, day, 2 * day, 'again'), 0, 'a forgotten long-term card skips the extra one-day repeat');
  assert.equal(nextStage(1, day, 2 * day, 'again'), -1, 'a forgotten young card starts over');
});

test('a checked translation replaces the record and keeps its review history and preference', () => {
  const exchange = openReaderState(':memory:');
  const index = { pages: [], glossaries: new Map() };
  const jagged = record('jagged', 'зажатый', 'Overall, uplift is jagged.', article);
  const removed = record('rose', 'роза', 'The rate rose quickly.', article);
  const state = exchange(0, [jagged, removed], index, { type: 'preference', key: jagged[0], preference: 'include' }).vocabulary;
  assert.equal(state.entries[jagged[0]].checked, false);
  const session = exchange(0, [], index, { type: 'start', after: null }).vocabulary.session;
  const answeredAt = Date.now() - day;
  exchange(0, [], index, { type: 'answer', id: session.id, step: 0, grade: 'remembered', answeredAt });
  exchange(0, [[removed[0], 2, null]], index, undefined);

  const since = exchange(0, []).revision;
  const checks = [
    { key: jagged[0], translation: 'неравномерный', lemma: 'jagged' },
    { key: removed[0], translation: 'расти', lemma: 'rise' },
  ];
  const result = exchange(since, [], index, { type: 'check', checks });
  const corrected = record('jagged', 'неравномерный', '', article)[0];
  assert.deepEqual(result.records.map(([key, , value]) => [key, value?.translation ?? null]), [[jagged[0], null], [corrected, 'неравномерный']]);
  assert.equal(exchange(result.revision, []).records.length, 0);
  assert.deepEqual(Object.keys(result.vocabulary.entries), [corrected]);
  assert.deepEqual(result.vocabulary.entries[corrected], {
    lemma: 'jagged', preference: 'include', suggested: false, dueAt: answeredAt + day, checked: true,
  });
  // A change of case alone keeps the key.
  exchange(0, [], index, { type: 'check', checks: [{ key: corrected, translation: 'Неравномерный', lemma: 'jagged' }] });
  const recased = exchange(result.revision, []);
  assert.deepEqual(recased.records.map(([key, , value]) => [key, value.translation]), [[corrected, 'Неравномерный']]);
  // A repeated check of the old key changes nothing.
  exchange(0, [], index, { type: 'check', checks: [checks[0]] });
  assert.equal(exchange(recased.revision, []).records.length, 0);
});

test('rejects malformed checks', () => {
  assert.equal(isReviewAction({ type: 'check', checks: [{ key: 'vocabulary:x', translation: 'слово' }] }), true);
  for (const check of [{ key: 'note:x', translation: 'слово' }, { key: 'vocabulary:x', translation: ' ' }, { key: 'vocabulary:x', translation: 'слово', lemma: '' }, null]) {
    assert.equal(isReviewAction({ type: 'check', checks: [check] }), false, JSON.stringify(check));
  }
});

test('an expression is heard every day for a week, then less often, never below one day in ten', () => {
  assert.deepEqual([0, 6, 7, 13, 14, 20, 21, 300].map(days => listeningChance(days)), [1, 1, 0.5, 0.5, 0.25, 0.25, 0.1, 0.1]);
  // A long review interval lowers the chance at once; an expression reviewed again tomorrow keeps it.
  assert.deepEqual([-1, 0, 1, 2, 3, 6].map(stage => listeningChance(0, stage)), [1, 1, 1 / 3, 1 / 7, 0.1, 0.1]);
  assert.equal(listeningChance(14, 1), 0.25);
});

test('the listening set holds checked expressions, keeps unheard ones and grows by ten new ones a day', () => {
  const exchange = openReaderState(':memory:');
  const index = { pages: [], glossaries: new Map() };
  const words = Array.from({ length: 60 }, (_, i) => record('word' + i, 'слово ' + i, '', book, 100 - i));
  exchange(0, words, index, undefined);
  const playlist = day => exchange(0, [], index, { type: 'playlist', day }).vocabulary.playlist.map(card => card.key);
  const heard = (day, keys) => exchange(0, [], index, { type: 'heard', day, keys });
  assert.deepEqual(playlist('2026-11-01'), []);

  exchange(0, [], index, { type: 'check', checks: words.map(([key, , value]) => ({ key, translation: value.translation })) });
  exchange(0, [], index, { type: 'preference', key: words[0][0], preference: 'exclude' });
  const first = playlist('2026-11-02');
  assert.deepEqual(first, words.slice(1, 21).map(([key]) => key));
  assert.deepEqual(playlist('2026-11-02'), first);
  // Nothing was heard, so the next day starts with the same expressions.
  assert.deepEqual(playlist('2026-11-03').slice(0, 20), first);
  heard('2026-11-03', first);
  heard('2026-11-03', first);
  const second = playlist('2026-11-04');
  assert.equal(second.length, 30);
  assert.deepEqual(second.slice(0, 20).sort(), [...first].sort());
  for (const day of ['04', '05', '06', '07', '08']) heard('2026-11-' + day, first);
  assert.equal(playlist('2026-11-09').filter(key => first.includes(key)).length, 20);
  heard('2026-11-09', first);
  // After seven days the first expressions are drawn by chance, and the set never exceeds forty.
  const later = Array.from({ length: 8 }, (_, i) => playlist('2026-12-0' + (i + 1)));
  assert.ok(later.every(set => set.length <= 40));
  assert.ok(later.some(set => first.some(key => !set.includes(key))));
});

test('a forgotten expression is heard every day again, and a corrected one keeps its listening days', () => {
  const exchange = openReaderState(':memory:');
  const index = { pages: [], glossaries: new Map() };
  const word = record('jagged', 'зажатый', 'Overall, uplift is jagged.', article);
  exchange(0, [word], index, { type: 'preference', key: word[0], preference: 'include' });
  const check = (key, translation) => exchange(0, [], index, { type: 'check', checks: [{ key, translation, lemma: 'jagged' }] });
  check(word[0], 'зажатый');
  for (let i = 1; i <= 25; i++) exchange(0, [], index, { type: 'heard', day: '2026-11-' + String(i).padStart(2, '0'), keys: [word[0]] });
  check(word[0], 'неравномерный');
  const days = () => Array.from({ length: 40 }, (_, i) => exchange(0, [], index, {
    type: 'playlist', day: new Date(Date.UTC(2027, 0, 1) + i * day).toISOString().slice(0, 10),
  }).vocabulary.playlist.length).reduce((sum, length) => sum + length, 0);
  assert.ok(days() < 30);
  const session = exchange(0, [], index, { type: 'start', after: null }).vocabulary.session;
  exchange(0, [], index, { type: 'answer', id: session.id, step: 0, grade: 'again', answeredAt: Date.now() });
  assert.equal(days() >= 39, true);
});
