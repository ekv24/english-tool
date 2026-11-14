/** @typedef {{anchor:string,offset:number,y:number,percent:number,hash?:string,anchorHeight?:number}} Position */
/** @typedef {{text:string,translation:string,sentence:string,href:string,title:string}} Expression */
/** @typedef {Expression & {savedAt:number}} SavedExpression */
/** @typedef {[key:string, updatedAt:number, value:Position | boolean | SavedExpression | null]} ReaderRecord */

/** @param {Expression} entry */
export function expressionKey(entry) {
  return 'vocabulary:' + JSON.stringify([entry.text, entry.translation].map(
    text => text.normalize().trim().replace(/\s+/g, ' ').toLowerCase()
  ));
}

/** @param {string} href */
export function isPassage(href) {
  return /^\/(?:read\/[a-z0-9-]+|books\/[a-z0-9-]+\/[\w-]+)#[^\s]+$/u.test(href);
}

/** @param {unknown} number */
function isTimestamp(number) {
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0;
}

/** @param {unknown} raw @returns {raw is ReaderRecord} */
export function isReaderRecord(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return false;
  const [key, updatedAt, value] = raw;
  if (typeof key !== 'string' || !isTimestamp(updatedAt)) return false;
  if (/^read:[a-z0-9-]+(?:\/[\w-]+)?$/.test(key)) return typeof value === 'boolean';
  if (!value || typeof value !== 'object') {
    // Deletions are retained so stale and newly migrated clients cannot restore a removed word.
    return value === null && key.startsWith('vocabulary:');
  }
  if (/^reading:v3:[a-z0-9-]+(?:\/[\w-]+)?$/.test(key)) {
    const { anchor, offset, y, percent, hash, anchorHeight } = value;
    return typeof anchor === 'string' && Number.isFinite(offset) && Number.isFinite(y) && y >= 0 &&
      Number.isInteger(percent) && percent >= 0 && percent <= 99 &&
      (hash === undefined || typeof hash === 'string') &&
      (anchorHeight === undefined || (Number.isFinite(anchorHeight) && anchorHeight >= 0));
  }
  const { text, translation, sentence, href, title, savedAt } = value;
  return typeof text === 'string' && !!text.trim() && typeof translation === 'string' && !!translation.trim() &&
    typeof sentence === 'string' && typeof href === 'string' && isPassage(href) && typeof title === 'string' &&
    isTimestamp(savedAt) && key === expressionKey(value);
}
