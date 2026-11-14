import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReaderRecord } from './public/reader-records.js';
import { createVocabularyReview, isReviewAction } from './vocabulary-review.mjs';
import { vocabularyIndex } from './vocabulary-terms.mjs';
import { dataRoot } from './library.mjs';

/** @typedef {import('./public/reader-records.js').ReaderRecord} ReaderRecord */
/** @typedef {import('./vocabulary-review.mjs').ReviewAction} ReviewAction */
/** @typedef {Awaited<ReturnType<typeof vocabularyIndex>>} VocabularyIndex */

const maxBytes = 512 * 1024;

/** @param {string} filename */
export function openReaderState(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reader_state (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      updated_at INTEGER NOT NULL,
      value TEXT NOT NULL
    ) STRICT
  `);
  const byKey = db.prepare('SELECT key, updated_at, value FROM reader_state WHERE key = ?');
  const version = db.prepare('SELECT coalesce(max(revision), 0) AS revision FROM reader_state');
  const changes = db.prepare('SELECT key, updated_at, value FROM reader_state WHERE revision > ?');
  const store = db.prepare(`
    INSERT OR REPLACE INTO reader_state (key, updated_at, value)
    SELECT ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM reader_state WHERE key = ? AND updated_at >= ?
    )
  `);
  const review = createVocabularyReview(db);

  /** @param {Record<string, unknown>} row @returns {ReaderRecord} */
  function entry(row) {
    return [String(row.key), Number(row.updated_at), JSON.parse(String(row.value))];
  }

  /** @param {number} since @param {ReaderRecord[]} incoming @param {VocabularyIndex} [index] @param {ReviewAction} [action] */
  return function exchange(since, incoming, index, action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, updatedAt, value] of incoming) {
        store.run(key, updatedAt, JSON.stringify(value), key, updatedAt);
      }
      const revision = Number(version.get()?.revision);
      const records = new Map(changes.all(since <= revision ? since : 0).map(row => [String(row.key), entry(row)]));
      for (const [key] of incoming) {
        const row = byKey.get(key);
        if (row) records.set(key, entry(row));
      }
      // A review grade and the session cursor commit in the same transaction.
      const vocabulary = index ? review(index, action, Date.now()) : undefined;
      db.exec('COMMIT');
      return { revision, records: [...records.values()], vocabulary };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
}

const statePath = process.env.ENGLISH_TOOL_STATE_DB ??
  fileURLToPath(new URL('reader-state/reader.sqlite', dataRoot));
/** @type {ReturnType<typeof openReaderState> | undefined} */
let exchange;

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
export async function syncReaderState(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.writeHead(403).end();
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return res.writeHead(415).end();
  if (Number(req.headers['content-length']) > maxBytes) return res.writeHead(413).end();
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      req.resume();
      return res.writeHead(413).end();
    }
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return res.writeHead(400).end(); }
  const { since, records, vocabulary } = data ?? {};
  if (!Number.isSafeInteger(since) || since < 0 || !Array.isArray(records) || !records.every(isReaderRecord) ||
      (vocabulary !== undefined && vocabulary !== true && !isReviewAction(vocabulary))) {
    return res.writeHead(400).end();
  }

  exchange ??= openReaderState(statePath);
  const index = vocabulary ? await vocabularyIndex() : undefined;
  const result = exchange(since, records, index, vocabulary === true ? undefined : vocabulary);
  return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
}
