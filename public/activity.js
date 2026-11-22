import { stateValue, storeState } from './sync.js';

/** @typedef {import('./reader-records.js').Activity} Activity */

// Reading counts while the page is visible and the reader has scrolled, tapped or typed recently.
const tick = 15_000;
const idleAfter = 90_000;
let documentId = '';
let lastActive = Date.now();
let seconds = 0;
let lookups = 0;
let ticks = 0;

/** @param {number} number */
const pad = number => String(number).padStart(2, '0');

function today() {
  const now = new Date();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

/** Adds the time and lookups counted so far to today's record for this document. */
function flush() {
  if (!documentId || (!seconds && !lookups)) return;
  const key = 'activity:' + documentId + ':' + today();
  const value = stateValue(key);
  const current = value && typeof value === 'object' && 'seconds' in value ? /** @type {Activity} */ (value) : { seconds: 0, lookups: 0 };
  try {
    storeState(key, { seconds: Math.min(86400, current.seconds + seconds), lookups: Math.min(100000, current.lookups + lookups) });
    seconds = 0;
    lookups = 0;
  } catch { /* The counts wait for the next flush. */ }
}

const active = () => { lastActive = Date.now(); };

/** Starts counting active reading time for a document. @param {string} id */
export function trackReading(id) {
  documentId = id;
  for (const type of ['scroll', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, active, { passive: true, capture: true });
  window.setInterval(() => {
    if (!document.hidden && Date.now() - lastActive < idleAfter) seconds += tick / 1000;
    if (++ticks % 4 === 0) flush();
  }, tick);
  // Capture listeners run before the sync module sends what is pending as the page goes away.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    else active();
  }, { capture: true });
  window.addEventListener('pagehide', flush, { capture: true });
}

/** Counts one lookup, a rough measure of how hard the text is. */
export function countLookup() {
  lookups++;
}
