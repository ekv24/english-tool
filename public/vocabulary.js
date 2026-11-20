import { expressionKey } from './reader-records.js';
import { readerSyncStatus, stateRecords, storeState } from './sync.js';
import { initReview } from './vocabulary-review.js';

/** @typedef {import('./reader-records.js').SavedExpression} SavedExpression */

/** @param {SavedExpression} entry @param {string} key @param {() => void} remove @param {(translation: string) => void} edit */
function expressionCard(entry, key, remove, edit) {
  const item = document.createElement('li');
  item.dataset.search = (entry.text + '\n' + entry.translation).toLowerCase();
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
  const editor = document.createElement('form');
  editor.className = 'vocabulary-edit';
  editor.hidden = true;
  const field = document.createElement('input');
  field.type = 'text';
  field.lang = 'ru';
  field.required = true;
  field.maxLength = 320;
  field.setAttribute('aria-label', 'Translation of “' + entry.text + '”');
  const keep = document.createElement('button');
  keep.type = 'submit';
  keep.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  editor.append(field, keep, cancel);
  answer.append(translation, editor);
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
  const change = document.createElement('button');
  change.type = 'button';
  change.textContent = 'Edit translation';
  change.addEventListener('click', () => {
    field.value = entry.translation;
    translation.hidden = true;
    editor.hidden = false;
    field.focus();
    field.select();
  });
  cancel.addEventListener('click', () => {
    editor.hidden = true;
    translation.hidden = false;
    change.focus();
  });
  editor.addEventListener('submit', event => {
    event.preventDefault();
    const value = field.value.trim().replace(/\s+/g, ' ');
    if (!value) return;
    if (value === entry.translation) return cancel.click();
    edit(value);
  });
  const controls = document.createElement('div');
  const practice = document.createElement('button');
  practice.type = 'button';
  practice.dataset.reviewPreference = key;
  practice.hidden = true;
  controls.append(practice, change, button);
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
  const search = document.createElement('div');
  search.className = 'vocabulary-search';
  const searchLabel = document.createElement('label');
  searchLabel.htmlFor = 'vocabulary-filter';
  searchLabel.textContent = 'Find a saved expression';
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.id = 'vocabulary-filter';
  filter.placeholder = 'English or Russian';
  filter.autocomplete = 'off';
  filter.spellcheck = false;
  search.append(searchLabel, filter);
  const undo = document.createElement('div');
  undo.className = 'vocabulary-undo';
  undo.setAttribute('role', 'status');
  undo.hidden = true;
  const undoText = document.createElement('span');
  const undoButton = document.createElement('button');
  undoButton.type = 'button';
  undoButton.textContent = 'Undo';
  undo.append(undoText, undoButton);
  /** @type {{key:string, entry:SavedExpression}[]} */
  let removed = [];
  let undoTimer = 0;
  undoButton.addEventListener('click', () => {
    try { for (const { key, entry } of removed) storeState(key, entry); }
    catch { undoText.textContent = 'Couldn’t restore the expression.'; return; }
    removed = [];
    undo.hidden = true;
    refresh();
  });
  /** @param {string} text @param {{key:string, entry:SavedExpression}[]} items */
  function offerUndo(text, items) {
    removed = items;
    undoText.textContent = text;
    undo.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = window.setTimeout(() => { undo.hidden = true; removed = []; }, 10_000);
  }
  container.replaceChildren(search, undo, empty, list);
  let total = 0;
  function applyFilter() {
    const query = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const item of list.children) {
      if (!(item instanceof HTMLElement)) continue;
      item.hidden = Boolean(query) && !item.dataset.search?.includes(query);
      if (!item.hidden) shown++;
    }
    const base = total ? total + (total === 1 ? ' saved expression' : ' saved expressions') : '';
    const text = query ? shown + ' of ' + base : base;
    const extra = readerSyncStatus === 'unavailable' ? (text ? text + ' · Sync unavailable' : 'Sync unavailable') : text;
    if (status.textContent !== extra) status.textContent = extra;
  }
  filter.addEventListener('input', applyFilter);
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
            offerUndo('Removed “' + entry.text + '”.', [{ key, entry }]);
            const neighbor = cards.get(key)?.card;
            const focus = (neighbor?.nextElementSibling ?? neighbor?.previousElementSibling)?.querySelector('summary');
            refresh();
            (focus ?? heading)?.focus();
          }, translation => {
            const next = { ...entry, translation };
            const nextKey = expressionKey(next);
            try {
              if (nextKey !== key) storeState(key, null);
              storeState(nextKey, next);
            } catch {
              status.textContent = 'Couldn’t save the translation. Try again.';
              return;
            }
            refresh();
            const edited = cards.get(nextKey)?.card;
            edited?.querySelector('details')?.setAttribute('open', '');
            edited?.querySelector('summary')?.focus();
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
      total = size;
      search.hidden = size < 8;
      applyFilter();
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
