import { isReaderRecord, recordSchema } from './reader-records.js';

/** @typedef {import('./reader-records.js').ReaderRecord} ReaderRecord */
/** @typedef {{record:ReaderRecord, pending?:boolean}} LocalRecord */
/** @typedef {'loading' | 'synced' | 'unavailable'} SyncStatus */

const prefix = 'reader-state:v1:';
const endpoint = '/api/reader-state';
// The last server revision this browser has stored, so a new page asks only for what changed since.
const revisionKey = 'reader-state:revision';
let revision = 0;
let epoch = '';
try {
  const saved = JSON.parse(localStorage.getItem(revisionKey) ?? 'null');
  if (saved?.schema === recordSchema && Number.isSafeInteger(saved.revision) && typeof saved.epoch === 'string') {
    ({ revision, epoch } = saved);
  }
} catch { /* Without storage every page fetches the whole state. */ }
let timer = 0;
/** @type {(() => boolean | object | undefined) | undefined} */
let reviewRequest;

/** @param {() => boolean | object | undefined} getRequest */
export function registerVocabularyReview(getRequest) {
  reviewRequest = getRequest;
}
/** @type {SyncStatus} */
export let readerSyncStatus = 'loading';
/** @type {Promise<void> | undefined} */
let syncing;

/** @param {SyncStatus} status */
function updateSyncStatus(status) {
  if (readerSyncStatus === status) return;
  readerSyncStatus = status;
  window.dispatchEvent(new Event('readersyncstatus'));
}

/** @param {string | null} raw @returns {LocalRecord | null} */
function parse(raw) {
  try {
    const data = JSON.parse(raw ?? 'null');
    return isReaderRecord(data?.record) ? data : null;
  } catch { return null; }
}

/** @param {string} key */
function load(key) {
  return parse(localStorage.getItem(prefix + key));
}

/** @param {LocalRecord} data */
function store(data) {
  localStorage.setItem(prefix + data.record[0], JSON.stringify(data));
}

/** @param {string} key */
export function stateValue(key) {
  return stateRecord(key)?.[2];
}

/** @param {string} key */
export function stateRecord(key) {
  try { return load(key)?.record; }
  catch { return undefined; }
}

/** @param {string} [category] */
function localRecords(category = '') {
  return Object.keys(localStorage)
    .filter(key => key.startsWith(prefix + category))
    .map(key => parse(localStorage.getItem(key)))
    .filter(data => data !== null);
}

/** @param {string} category */
export function stateRecords(category) {
  return localRecords(category).map(data => data.record);
}

/** @param {string} key @param {ReaderRecord[2]} value @param {number} [now] */
export function storeState(key, value, now = Date.now()) {
  const at = Math.max(now, (load(key)?.record[1] ?? -1) + 1);
  store({ record: [key, at, value], pending: true });
  scheduleSync();
}

/** @param {ReaderRecord} record */
function importRecord(record) {
  if (isReaderRecord(record) && (load(record[0])?.record[1] ?? -1) < record[1]) {
    store({ record, pending: true });
    return true;
  }
  return false;
}

/** @param {string} key @param {string | null} raw */
function importLegacy(key, raw) {
  let value;
  try { value = JSON.parse(raw ?? 'null'); }
  catch { return false; }
  if (!value) return false;
  if (key.startsWith('vocabulary:')) return importRecord([key, value.savedAt, value]);
  const { updatedAt, read, ...position } = value;
  const moved = Boolean(updatedAt || position.y) && importRecord([key, updatedAt ?? 0, position]);
  const readKey = 'read:' + key.slice('reading:v3:'.length);
  const marked = typeof read === 'boolean' && !load(readKey) && importRecord([readKey, updatedAt ?? (read ? 1 : 0), read]);
  return moved || marked;
}

function migrate() {
  let changed = false;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('reading:v3:') || key.startsWith('vocabulary:')) {
      changed = importLegacy(key, localStorage.getItem(key)) || changed;
    }
  }
  if (changed) window.dispatchEvent(new Event('readerstatechange'));
}

/** @param {boolean} [beacon] */
function requestBody(beacon = false) {
  /** @type {string[]} */
  const batch = [];
  let size = 0;
  for (const { record, pending } of localRecords()) {
    if (!pending) continue;
    const json = JSON.stringify(record);
    const bytes = new Blob([json]).size + 1;
    if (beacon && size + bytes > 48 * 1024) continue;
    if (batch.length && size + bytes > 480 * 1024) break;
    batch.push(json);
    size += bytes;
  }
  const request = reviewRequest?.();
  const vocabulary = beacon && request === true ? undefined : request;
  const extra = vocabulary ? ',"vocabulary":' + JSON.stringify(vocabulary) : '';
  const known = epoch ? ',"epoch":' + JSON.stringify(epoch) : '';
  return { body: '{"since":' + revision + known + ',"records":[' + batch.join(',') + ']' + extra + '}', size: size + extra.length, vocabulary };
}

/** @param {ReaderRecord[]} records */
function apply(records) {
  let changed = false;
  for (const record of records) {
    if (!isReaderRecord(record)) continue;
    const current = load(record[0]);
    if ((current?.record[1] ?? -1) > record[1]) continue;
    const different = JSON.stringify(current?.record) !== JSON.stringify(record);
    if (!current?.pending && !different) continue;
    store({ record });
    changed ||= different;
  }
  if (changed) window.dispatchEvent(new Event('readerstatechange'));
}

export function syncReaderState() {
  clearTimeout(timer);
  timer = 0;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      migrate();
      const { body, size, vocabulary } = requestBody();
      const res = await fetch(endpoint, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: size <= 48 * 1024,
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        updateSyncStatus('unavailable');
        return;
      }
      const data = await res.json();
      apply(data.records);
      revision = data.revision;
      epoch = typeof data.epoch === 'string' ? data.epoch : '';
      try { localStorage.setItem(revisionKey, JSON.stringify({ revision, epoch, schema: recordSchema })); }
      catch { /* The next page fetches the whole state again. */ }
      if (data.vocabulary) {
        window.dispatchEvent(new CustomEvent('vocabularyreviewchange', { detail: { snapshot: data.vocabulary, request: vocabulary } }));
      }
      if (localRecords().some(data => data.pending)) scheduleSync();
      updateSyncStatus('synced');
    } catch { updateSyncStatus('unavailable'); }
  })().finally(() => { syncing = undefined; });
  return syncing;
}

export function scheduleSync() {
  if (!timer) timer = window.setTimeout(syncReaderState, 350);
}

function flushReaderState() {
  try {
    const { body, size } = requestBody(true);
    if (size) navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
  } catch { /* Pending changes survive in browser storage. */ }
}

try { migrate(); }
catch { /* The reader still works when browser storage is unavailable. */ }
window.addEventListener('pageshow', syncReaderState);
window.addEventListener('online', syncReaderState);
window.addEventListener('pagehide', flushReaderState);
window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith(prefix)) window.dispatchEvent(new Event('readerstatechange'));
  // A tab opened before sync can still write the original local keys.
  if (event.key?.startsWith('reading:v3:') || event.key?.startsWith('vocabulary:')) scheduleSync();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushReaderState();
  else void syncReaderState();
});
window.setInterval(() => { if (!document.hidden) void syncReaderState(); }, 4000);
