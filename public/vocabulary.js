import { expressionKey } from './reader-records.js';
import { readerSyncStatus, stateRecords, stateValue, storeState } from './sync.js';
import { initReview } from './vocabulary-review.js';

/** @typedef {import('./reader-records.js').Expression} Expression */
/** @typedef {import('./reader-records.js').SavedExpression} SavedExpression */

const save = document.querySelector('button[data-save-expression]');
/** @type {Expression | null} */
let selection = null;

/** @param {string} href */
function passageHref(href) {
  try {
    const url = new URL(href, location.origin);
    const passage = /^\/(?:read\/[a-z0-9-]+|books\/[a-z0-9-]+\/[\w-]+)$/;
    return url.origin === location.origin && passage.test(url.pathname) && url.hash
      ? url.pathname + url.hash
      : null;
  } catch { return null; }
}

/** @param {boolean} saved */
function updateSave(saved) {
  if (!save) return;
  save.setAttribute('aria-disabled', String(saved));
  save.textContent = saved ? 'Saved' : 'Save expression';
}

export function resetSave() {
  selection = null;
  if (!(save instanceof HTMLButtonElement)) return;
  updateSave(false);
  save.hidden = true;
}

/** @param {Expression} entry */
export function offerSave(entry) {
  resetSave();
  const href = passageHref(entry.href);
  if (!(save instanceof HTMLButtonElement) || !href || !entry.text.trim() || !entry.translation.trim()) return;
  selection = { ...entry, href };
  save.hidden = false;
  refreshSave();
}

function refreshSave() {
  if (!selection) return;
  updateSave(Boolean(stateValue(expressionKey(selection))));
}

save?.addEventListener('click', () => {
  if (!selection || save.getAttribute('aria-disabled') === 'true') return;
  try {
    const key = expressionKey(selection);
    if (!stateValue(key)) {
      const now = Date.now();
      storeState(key, { ...selection, savedAt: now }, now);
    }
    updateSave(true);
  } catch {
    save.textContent = 'Try saving again';
  }
});

/** @param {SavedExpression} entry @param {string} key @param {() => void} remove */
function expressionCard(entry, key, remove) {
  const item = document.createElement('li');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const word = document.createElement('span');
  word.className = 'vocabulary-expression';
  word.lang = 'en';
  word.textContent = entry.text;
  const show = document.createElement('span');
  show.className = 'vocabulary-show';
  show.textContent = 'Show answer';
  const hide = document.createElement('span');
  hide.className = 'vocabulary-hide';
  hide.textContent = 'Hide answer';
  summary.append(word, show, hide);

  const answer = document.createElement('div');
  answer.className = 'vocabulary-answer';
  const translation = document.createElement('p');
  translation.className = 'vocabulary-translation';
  translation.lang = document.body.dataset.targetLanguage || 'en';
  translation.textContent = entry.translation;
  answer.append(translation);
  if (entry.sentence) {
    const sentence = document.createElement('blockquote');
    sentence.lang = 'en';
    sentence.textContent = entry.sentence;
    answer.append(sentence);
  }

  const actions = document.createElement('div');
  actions.className = 'vocabulary-actions';
  const source = document.createElement('a');
  source.href = entry.href;
  source.textContent = entry.title || 'Go to the passage';
  if (entry.title) source.setAttribute('aria-label', 'Go to the passage in ' + entry.title);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Remove';
  button.setAttribute('aria-label', 'Remove “' + entry.text + '”');
  button.addEventListener('click', remove);
  const controls = document.createElement('div');
  const practice = document.createElement('button');
  practice.type = 'button';
  practice.dataset.reviewPreference = key;
  practice.hidden = true;
  controls.append(practice, button);
  actions.append(source, controls);
  answer.append(actions);
  details.append(summary, answer);
  item.append(details);
  return item;
}

const vocabulary = document.querySelector('[data-vocabulary]');
const count = document.querySelector('[data-word-count]');

/** @param {Element} container @param {Element} status */
function initVocabulary(container, status) {
  const list = document.createElement('ul');
  list.className = 'vocabulary-list';
  list.setAttribute('role', 'list');
  const empty = document.createElement('p');
  empty.className = 'vocabulary-empty';
  const heading = container.closest('main')?.querySelector('h1');
  if (heading) heading.tabIndex = -1;
  status.setAttribute('role', 'status');
  container.replaceChildren(empty, list);
  /** @type {Map<string, {card: HTMLLIElement, updatedAt: number}>} */
  const cards = new Map();
  const renderReview = document.querySelector('.review-session') ? initReview(list) : () => {};

  function refresh() {
    try {
      const entries = stateRecords('vocabulary:')
        .flatMap(([key, updatedAt, entry]) => entry && typeof entry === 'object' && 'savedAt' in entry ? [{ key, updatedAt, entry }] : [])
        .sort((a, b) => b.entry.savedAt - a.entry.savedAt);
      const keys = new Set(entries.map(({ key }) => key));
      for (const [key, { card }] of cards) {
        if (keys.has(key)) continue;
        card.remove();
        cards.delete(key);
      }
      let next = list.firstElementChild;
      for (const { key, updatedAt, entry } of entries) {
        const previous = cards.get(key);
        let card = previous?.card;
        if (!card || previous?.updatedAt !== updatedAt) {
          card = expressionCard(entry, key, () => {
            try { storeState(key, null); }
            catch {
              status.textContent = 'Couldn’t remove the expression. Try again.';
              return;
            }
            const neighbor = cards.get(key)?.card;
            const focus = (neighbor?.nextElementSibling ?? neighbor?.previousElementSibling)?.querySelector('summary');
            refresh();
            (focus ?? heading)?.focus();
          });
          if (previous) {
            if (next === previous.card) next = card;
            previous.card.replaceWith(card);
          }
          cards.set(key, { card, updatedAt });
        }
        if (card !== next) list.insertBefore(card, next);
        next = card.nextElementSibling;
      }
      const size = entries.length;
      status.textContent = size ? size + (size === 1 ? ' saved expression' : ' saved expressions') : '';
      if (readerSyncStatus === 'unavailable') {
        status.textContent = size ? status.textContent + ' · Sync unavailable' : 'Sync unavailable';
      }
      empty.textContent = {
        loading: 'Checking for saved expressions…',
        synced: 'Save an expression from a translation to practise recalling it here.',
        unavailable: 'Open Vocabulary again when the reader server is reachable.',
      }[readerSyncStatus];
      empty.hidden = size > 0;
      list.hidden = size === 0;
      renderReview();
    } catch {
      status.textContent = 'Saved expressions are unavailable in this browser.';
      empty.hidden = true;
      list.hidden = true;
    }
  }
  refresh();
  window.addEventListener('readerstatechange', refresh);
  window.addEventListener('readersyncstatus', refresh);
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
}

if (vocabulary && count) initVocabulary(vocabulary, count);
if (save) window.addEventListener('readerstatechange', refreshSave);
