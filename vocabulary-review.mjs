import { randomUUID } from 'node:crypto';
import { describeExpression } from './vocabulary-terms.mjs';
import { isReaderRecord } from './public/reader-records.js';

/** @typedef {import('./public/reader-records.js').SavedExpression} SavedExpression */
/** @typedef {import('./public/reader-records.js').ReaderRecord} ReaderRecord */
/** @typedef {Awaited<ReturnType<typeof import('./vocabulary-terms.mjs').vocabularyIndex>>} VocabularyIndex */
/** @typedef {'remembered'|'again'} Grade */
/** @typedef {'include'|'exclude'|'auto'} Preference */
/** @typedef {{id:string,lemma:string,expression:SavedExpression,showContext:boolean,priority:number,spread:number,sourceKey:string}} Card */
/** @typedef {{id:string,queue:Card[],step:number}} Session */
/** @typedef {{type:'start', after:string|null} | {type:'answer', id:string, step:number, grade:Grade, answeredAt:number} | {type:'preference', key:string, preference:Preference}} ReviewAction */

const sessionSize = 5;
const day = 86_400_000;
const intervals = [1, 3, 7, 14, 30, 60, 120];
const generalPhrases = new Set([
  'account for', 'as a result', 'as long as', 'at odds with', 'boil down to', 'break down',
  'bring about', 'carry out', 'come up with', 'cope with', 'cut down on', 'deal with',
  'draw on', 'end up', 'fall back on', 'figure out', 'follow up', 'hold up', 'in effect',
  'in practice', 'in turn', 'lay out', 'lead to', 'leave out', 'look into', 'make up',
  'narrow down', 'on the other hand', 'pan out', 'pick up', 'point out', 'put together',
  'rely on', 'rule out', 'run into', 'set out', 'set up', 'sort out', 'spell out', 'start out',
  'stem from', 'take into account', 'take on', 'think through', 'turn out', 'work out',
]);

/**
 * Moves a card along the interval ladder. Reviews happen whenever the reader has time, so a
 * card recalled after a long gap jumps to the interval it has already survived, and a card
 * forgotten after a month or more comes back in a day and then moves on to three days
 * without the extra one-day repeat that new cards get.
 * @param {number} stage @param {number} lastReviewedAt @param {number} at @param {Grade} grade
 */
export function nextStage(stage, lastReviewedAt, at, grade) {
  if (grade === 'again') return stage >= 4 ? 0 : -1;
  const next = Math.min(stage + 1, intervals.length - 1);
  if (!lastReviewedAt) return next;
  const elapsed = (at - lastReviewedAt) / day;
  const survived = intervals.findLastIndex(days => days <= elapsed);
  return Math.max(next, Math.min(survived, intervals.length - 1));
}

/** @param {unknown} value @returns {value is ReviewAction} */
export function isReviewAction(value) {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  if (value.type === 'start') return 'after' in value && (value.after === null ||
    (typeof value.after === 'string' && /^[a-f0-9-]{36}$/.test(value.after)));
  if (value.type === 'answer' && 'id' in value && 'step' in value && 'grade' in value && 'answeredAt' in value) {
    const { id, step, grade, answeredAt } = value;
    return typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id) && typeof step === 'number' &&
      Number.isInteger(step) && step >= 0 && step < sessionSize && (grade === 'remembered' || grade === 'again') &&
      typeof answeredAt === 'number' && Number.isSafeInteger(answeredAt) && answeredAt > 0;
  }
  return value.type === 'preference' && 'key' in value && typeof value.key === 'string' &&
    value.key.startsWith('vocabulary:') && 'preference' in value &&
    (value.preference === 'include' || value.preference === 'exclude' || value.preference === 'auto');
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createVocabularyReview(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary_reviews (
      id TEXT PRIMARY KEY,
      stage INTEGER NOT NULL,
      last_reviewed_at INTEGER NOT NULL,
      due_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vocabulary_preferences (
      id TEXT PRIMARY KEY,
      preference TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vocabulary_session (
      slot INTEGER PRIMARY KEY CHECK(slot = 1),
      content TEXT NOT NULL
    ) STRICT;
  `);
  const saved = db.prepare("SELECT key, updated_at, value FROM reader_state WHERE key LIKE 'vocabulary:%' AND value <> 'null' ORDER BY updated_at DESC, key");
  const getSession = db.prepare('SELECT content FROM vocabulary_session WHERE slot = 1');
  const saveSession = db.prepare('INSERT OR REPLACE INTO vocabulary_session (slot, content) VALUES (1, ?)');
  const getReview = db.prepare('SELECT stage, due_at, last_reviewed_at FROM vocabulary_reviews WHERE id = ?');
  const saveReview = db.prepare('INSERT OR REPLACE INTO vocabulary_reviews (id, stage, last_reviewed_at, due_at) VALUES (?, ?, ?, ?)');
  const preferences = db.prepare('SELECT id, preference FROM vocabulary_preferences');
  const setPreference = db.prepare('INSERT OR REPLACE INTO vocabulary_preferences (id, preference) VALUES (?, ?)');
  const deletePreference = db.prepare('DELETE FROM vocabulary_preferences WHERE id = ?');
  /** @type {Map<string, {value:string, index:VocabularyIndex, term:ReturnType<typeof describeExpression>}>} */
  const terms = new Map();

  /** @param {VocabularyIndex} index @param {ReviewAction | undefined} action @param {number} now */
  return function review(index, action, now) {
    const manual = new Map(preferences.all().map(row => [String(row.id), /** @type {Preference} */ (row.preference)]));
    /** @type {Map<string, Card>} */
    const cards = new Map();
    const sourceTerms = new Map();
    const senses = new Map();
    for (const row of saved.all()) {
      const value = String(row.value);
      const key = String(row.key);
      const record = /** @type {ReaderRecord} */ ([key, Number(row.updated_at), JSON.parse(value)]);
      if (!isReaderRecord(record) || !record[2] || typeof record[2] !== 'object' || !('savedAt' in record[2])) continue;
      const expression = record[2];
      const cached = terms.get(key);
      const term = cached?.value === value && cached.index === index ? cached.term : describeExpression(expression, index);
      terms.set(key, { value, index, term });
      sourceTerms.set(key, term);
      const priority = Math.max(term.priority, generalPhrases.has(term.lemma.toLowerCase()) ? 2 : 0);
      const previous = cards.get(term.id);
      if (!previous || priority > previous.priority) {
        cards.set(term.id, { ...term, expression, showContext: false, priority, sourceKey: key });
      }
      const lemma = term.lemma.toLowerCase();
      const meanings = senses.get(lemma) ?? new Set();
      meanings.add(term.id);
      senses.set(lemma, meanings);
    }
    for (const key of terms.keys()) {
      if (!sourceTerms.has(key)) terms.delete(key);
    }
    for (const card of cards.values()) {
      card.showContext = (senses.get(card.lemma.toLowerCase())?.size ?? 0) > 1 ||
        (sourceTerms.get(card.sourceKey)?.isGlossaryTerm === true && !!card.expression.sentence);
    }

    if (action?.type === 'preference') {
      const id = sourceTerms.get(action.key)?.id;
      if (id) {
        if (action.preference === 'auto') deletePreference.run(id);
        else setPreference.run(id, action.preference);
        manual.set(id, action.preference);
      }
    }

    const stored = getSession.get()?.content;
    const session = /** @type {Session|null} */ (typeof stored === 'string' ? JSON.parse(stored) : null);
    let current = session;
    if (current) {
      const step = current.step;
      const stillAvailable = current.queue.filter((card, i) => i < step ||
        (cards.has(card.id) && manual.get(card.id) !== 'exclude'));
      if (stillAvailable.length !== current.queue.length) {
        current = { ...current, id: randomUUID(), queue: stillAvailable };
        saveSession.run(JSON.stringify(current));
      }
    }

    const info = new Map([...cards.keys()].map(id => [id, getReview.get(id)]));
    const ordered = [...cards.values()].filter(card => manual.get(card.id) !== 'exclude').map(card => ({
      card, preference: manual.get(card.id), dueAt: Number(info.get(card.id)?.due_at ?? 0),
    }));
    const comparePriority = /** @param {typeof ordered[number]} a @param {typeof ordered[number]} b */ (a, b) =>
      Number(b.preference === 'include') - Number(a.preference === 'include') ||
      b.card.priority - a.card.priority || b.card.spread - a.card.spread || b.card.expression.savedAt - a.card.expression.savedAt;

    if (action?.type === 'answer' && current && current.id === action.id && current.step === action.step) {
      const card = current.queue[current.step];
      if (card) {
        const old = info.get(card.id);
        const at = Math.min(now, Math.max(Number(old?.last_reviewed_at ?? 0), action.answeredAt));
        const stage = nextStage(Number(old?.stage ?? -1), Number(old?.last_reviewed_at ?? 0), at, action.grade);
        const due = at + intervals[Math.max(0, stage)] * day;
        saveReview.run(card.id, stage, at, due);
        info.set(card.id, { stage, last_reviewed_at: at, due_at: due });
        const row = ordered.find(item => item.card.id === card.id);
        if (row) row.dueAt = due;
        current = { ...current, step: current.step + 1 };
        saveSession.run(JSON.stringify(current));
      }
    }

    const due = ordered.filter(item => item.dueAt && item.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt || comparePriority(a, b));
    const fresh = ordered.filter(item => !item.dueAt && (item.preference === 'include' || item.card.priority > 0))
      .sort(comparePriority);
    if (action?.type === 'start' && (current?.id ?? null) === action.after &&
        (!current || current.step >= current.queue.length) && due.length + fresh.length) {
      current = {
        id: randomUUID(), queue: [...due, ...fresh].slice(0, sessionSize).map(item => item.card), step: 0,
      };
      saveSession.run(JSON.stringify(current));
    }

    const available = Math.min(sessionSize, due.length + fresh.length);
    const waiting = { due: due.length, fresh: fresh.length };
    const upcoming = ordered.reduce((date, row) => row.dueAt > now ? Math.min(date, row.dueAt) : date, Infinity);
    return {
      session: current && {
        id: current.id, step: current.step, total: current.queue.length,
        queue: current.queue.map(card => ({
          lemma: card.lemma, expression: card.expression, showContext: card.showContext, sourceKey: card.sourceKey,
        })),
      },
      available, waiting, nextDue: Number.isFinite(upcoming) ? upcoming : null,
      entries: Object.fromEntries([...sourceTerms].map(([key, term]) => [
        key, {
          lemma: term.lemma, preference: manual.get(term.id) ?? 'auto',
          suggested: (cards.get(term.id)?.priority ?? 0) > 0,
          dueAt: Number(info.get(term.id)?.due_at ?? 0),
        },
      ])),
    };
  };
}

