/** @typedef {{anchor:string,offset:number,y:number,percent:number,hash?:string,anchorHeight?:number}} Position */
/** @typedef {{text:string,translation:string,sentence:string,href:string,title:string}} Expression */
/** @typedef {Expression & {savedAt:number}} SavedExpression */
/** Active reading time and lookups in one document on one day. @typedef {{seconds:number,lookups:number}} Activity */
/** @typedef {'more'|'fine'|'less'} Interest */
/** @typedef {'easy'|'right'|'hard'} Level */
/** The reader's own verdict on a material. @typedef {{interest?:Interest,level?:Level,note?:string}} Feedback */
/**
 * A journal entry: feedback, a question or an interest, written on the site or logged by an agent from a chat.
 * @typedef {{text:string,kind:'feedback'|'question'|'interest'|'note',source:'site'|'chat'|'agent',at:number,material?:string}} JournalNote
 */
/**
 * A material found outside the library that may interest the reader. `score` estimates the chance of "More like this".
 * @typedef {{title:string,url:string,kind:'article'|'book',why:string,score:number,addedAt:number,
 *   author?:string,publisher?:string,minutes?:number,level?:Level,material?:string}} Suggestion
 */
/** @typedef {'want'|'dismissed'} Choice */
/** The agent's summary of the reader's interests. @typedef {{text:string}} Profile */
/** @typedef {Position | boolean | SavedExpression | Activity | Feedback | JournalNote | Suggestion | Choice | Profile | null} RecordValue */
/** @typedef {[key:string, updatedAt:number, value:RecordValue]} ReaderRecord */

/** Raised whenever isReaderRecord accepts a new kind of record, so browsers fetch the records they skipped before. */
export const recordSchema = 2;

const documentId = '[a-z0-9-]+(?:\\/[\\w-]+)?';
const materialPattern = new RegExp('^' + documentId + '$');
const readKey = new RegExp('^read:' + documentId + '$');
const positionKey = new RegExp('^reading:v3:' + documentId + '$');
const activityKey = new RegExp('^activity:' + documentId + ':\\d{4}-\\d{2}-\\d{2}$');
export const interests = /** @type {const} */ (['more', 'fine', 'less']);
export const levels = /** @type {const} */ (['easy', 'right', 'hard']);
const noteKinds = ['feedback', 'question', 'interest', 'note'];
const noteSources = ['site', 'chat', 'agent'];

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

/** @param {unknown} number @param {number} max */
function isCount(number, max) {
  return Number.isSafeInteger(number) && /** @type {number} */ (number) >= 0 && /** @type {number} */ (number) <= max;
}

/** @param {unknown} text @param {number} max @param {boolean} [required] */
function isText(text, max, required = false) {
  return text === undefined ? !required : typeof text === 'string' && text.length <= max && (!required || Boolean(text.trim()));
}

/** @param {unknown} value @param {readonly unknown[]} options */
function isOptional(value, options) {
  return value === undefined || options.includes(value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** An object with no fields besides the listed ones. @param {unknown} value @param {string[]} fields @returns {value is Record<string, unknown>} */
function isShaped(value, fields) {
  return isObject(value) && Object.keys(value).every(field => fields.includes(field));
}

/** @param {unknown} url */
function isWebAddress(url) {
  if (typeof url !== 'string' || url.length > 2000) return false;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); }
  catch { return false; }
}

/** @param {Record<string, unknown>} value */
function isPosition(value) {
  const { anchor, offset, y, percent, hash, anchorHeight } = value;
  return typeof anchor === 'string' && Number.isFinite(offset) && Number.isFinite(y) && Number(y) >= 0 &&
    Number.isFinite(percent) && Number(percent) >= 0 && Number(percent) < 100 &&
    (hash === undefined || typeof hash === 'string') &&
    (anchorHeight === undefined || (Number.isFinite(anchorHeight) && Number(anchorHeight) >= 0));
}

/** @param {string} key @param {Record<string, unknown>} value */
function isSavedExpression(key, value) {
  const { text, translation, sentence, href, title, savedAt } = value;
  return typeof text === 'string' && !!text.trim() && typeof translation === 'string' && !!translation.trim() &&
    typeof sentence === 'string' && typeof href === 'string' && isPassage(href) && typeof title === 'string' &&
    isTimestamp(savedAt) && key === expressionKey(/** @type {Expression} */ (/** @type {unknown} */ (value)));
}

/** @param {unknown} value */
function isSuggestion(value) {
  if (!isShaped(value, ['title', 'url', 'kind', 'why', 'score', 'addedAt', 'author', 'publisher', 'minutes', 'level', 'material'])) return false;
  const { title, url, kind, why, score, addedAt, author, publisher, minutes, level, material } = value;
  return isText(title, 300, true) && isWebAddress(url) && (kind === 'article' || kind === 'book') && isText(why, 1000, true) &&
    typeof score === 'number' && score >= 0 && score <= 1 && isTimestamp(addedAt) && isText(author, 200) && isText(publisher, 200) &&
    (minutes === undefined || (isCount(minutes, 100000) && Number(minutes) > 0)) && isOptional(level, levels) &&
    (material === undefined || (typeof material === 'string' && materialPattern.test(material)));
}

/** @param {unknown} raw @returns {raw is ReaderRecord} */
export function isReaderRecord(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return false;
  const [key, updatedAt, value] = raw;
  if (typeof key !== 'string' || !isTimestamp(updatedAt)) return false;
  switch (key.slice(0, key.indexOf(':') + 1)) {
    case 'read:':
      return readKey.test(key) && typeof value === 'boolean';
    case 'reading:':
      return positionKey.test(key) && isObject(value) && isPosition(value);
    case 'vocabulary:':
      // Deletions are retained so stale and newly migrated clients cannot restore a removed word.
      return value === null || (isObject(value) && isSavedExpression(key, value));
    case 'activity:':
      return activityKey.test(key) && isShaped(value, ['seconds', 'lookups']) &&
        isCount(value.seconds, 86400) && isCount(value.lookups, 100000);
    case 'feedback:':
      return /^feedback:[a-z0-9-]+$/.test(key) && isShaped(value, ['interest', 'level', 'note']) &&
        isOptional(value.interest, interests) && isOptional(value.level, levels) && isText(value.note, 4000);
    case 'note:':
      return /^note:[a-z0-9-]{1,64}$/.test(key) && (value === null || (isShaped(value, ['text', 'kind', 'source', 'at', 'material']) &&
        isText(value.text, 4000, true) && noteKinds.includes(String(value.kind)) && noteSources.includes(String(value.source)) &&
        isTimestamp(value.at) && (value.material === undefined || (typeof value.material === 'string' && materialPattern.test(value.material)))));
    case 'suggestion:':
      return /^suggestion:[a-z0-9-]{1,80}$/.test(key) && (value === null || isSuggestion(value));
    case 'choice:':
      return /^choice:[a-z0-9-]{1,80}$/.test(key) && (value === null || value === 'want' || value === 'dismissed');
    case 'profile:':
      return key === 'profile:interests' && isShaped(value, ['text']) && isText(value.text, 32000);
  }
  return false;
}
