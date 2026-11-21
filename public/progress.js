import { stateRecord, stateValue, storeState } from './sync.js';

/** @typedef {import('./reader-records.js').Position} Position */
/** @typedef {Position & {updatedAt?:number,read?:boolean}} ReadingState */

/** @param {string} id @returns {ReadingState | null} */
export function loadPosition(id) {
  const position = stateRecord('reading:v3:' + id);
  const read = stateValue('read:' + id);
  if (position && position[2] && typeof position[2] === 'object' && 'y' in position[2]) {
    return { ...position[2], updatedAt: position[1], read: read === true };
  }
  return read === true ? { anchor: '', offset: 0, y: 0, percent: 0, read } : null;
}

/** @param {string} id @param {Position} position @param {number} updatedAt */
export function savePosition(id, position, updatedAt) {
  const key = 'reading:v3:' + id;
  try {
    if ((stateRecord(key)?.[1] ?? 0) > updatedAt) return;
    storeState(key, position, updatedAt);
  } catch { /* Reading still works when browser storage is unavailable. */ }
}

/** @param {string} id @param {boolean} read */
export function setRead(id, read) {
  try {
    storeState('read:' + id, read);
    return true;
  } catch { return false; }
}

/** Reading progress to a tenth of a percent, e.g. "42.3%". @param {number} percent */
export const percentLabel = percent => (Math.floor(percent * 10) / 10).toFixed(1) + '%';
