import { loadPosition, percentLabel } from './progress.js';
import { stateRecords, storeState } from './sync.js';
import './book.js';

/** @typedef {import('./reader-records.js').Suggestion} Suggestion */

const continueSection = /** @type {HTMLElement|null} */ (document.querySelector('[data-continue]'));
const continueList = document.querySelector('[data-continue-list]');
const words = /** @type {HTMLAnchorElement|null} */ (document.querySelector('[data-library-words]'));

function updateArticles() {
  for (const card of document.querySelectorAll('[data-material]')) {
    if (!(card instanceof HTMLElement)) continue;
    const position = loadPosition(card.dataset.material ?? '');
    const percent = position?.percent ?? 0;
    const label = card.querySelector('.card-status');
    const progress = card.querySelector('progress');
    if (progress) progress.value = position?.read ? 100 : percent;
    if (label) label.textContent = position?.read ? 'Finished ✓'
      : percent ? 'At ' + percentLabel(percent) : position?.y ? 'In progress' : 'To read';
    card.dataset.state = position?.read ? 'done' : position?.y ? 'reading' : 'new';
    card.dataset.percent = String(position?.read ? 100 : percent);
    card.dataset.time = String(position?.y ? position.updatedAt ?? 0 : 0);
  }
}

/** @typedef {{time:number, href:string, kind:string, title:string, detail:string, percent:number, cover:string, shape:'book'|'wide'}} Recent */

/** @returns {Recent[]} */
function recentItems() {
  /** @type {Recent[]} */
  const items = [];
  for (const book of document.querySelectorAll('[data-book]')) {
    if (!(book instanceof HTMLElement) || book.dataset.state !== 'reading') continue;
    const resume = book.querySelector('a[data-book-resume]');
    if (!(resume instanceof HTMLAnchorElement) || resume.hidden) continue;
    items.push({
      time: Number(book.dataset.time) || 0, href: resume.href, kind: 'Book',
      title: book.querySelector('.shelf-title')?.textContent ?? '', detail: book.dataset.chapter ?? '',
      percent: Number(book.dataset.percent) || 0,
      cover: book.querySelector('.cover-image')?.getAttribute('src') ?? '', shape: 'book',
    });
  }
  for (const card of document.querySelectorAll('[data-material]')) {
    if (!(card instanceof HTMLAnchorElement) || card.dataset.state !== 'reading') continue;
    items.push({
      time: Number(card.dataset.time) || 0, href: card.href, kind: 'Article',
      title: card.querySelector('h3')?.textContent ?? '', detail: card.querySelector('.meta')?.textContent ?? '',
      percent: Number(card.dataset.percent) || 0,
      cover: card.querySelector('img')?.getAttribute('src') ?? '', shape: 'wide',
    });
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 3);
}

/** @param {string} tag @param {string} className @param {string} [text] */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let shown = '';
function updateContinue() {
  if (!continueSection || !continueList) return;
  const items = recentItems();
  const key = JSON.stringify(items);
  if (key === shown) return;
  shown = key;
  continueList.replaceChildren(...items.map((item, index) => {
    const link = /** @type {HTMLAnchorElement} */ (element('a', 'continue-item' + (index === 0 ? ' is-latest' : '')));
    link.href = item.href;
    link.dataset.shape = item.shape;
    const cover = element('span', 'continue-cover');
    if (item.cover) {
      const image = /** @type {HTMLImageElement} */ (element('img', ''));
      image.src = item.cover;
      image.alt = '';
      image.decoding = 'async';
      cover.append(image);
    } else cover.append(element('span', 'cover-type', item.title));
    const copy = element('span', 'continue-copy');
    const progress = /** @type {HTMLProgressElement} */ (element('progress', ''));
    progress.max = 100;
    progress.value = item.percent;
    progress.setAttribute('aria-label', 'Progress in ' + item.title);
    const meter = element('span', 'continue-meter');
    meter.append(progress, element('span', 'continue-percent', item.percent ? percentLabel(item.percent) : 'Started'));
    copy.append(element('span', 'continue-kind', item.kind), element('span', 'continue-title', item.title));
    if (item.detail) copy.append(element('span', 'continue-detail', item.detail));
    copy.append(meter);
    const go = element('span', 'continue-go', 'Continue');
    go.setAttribute('aria-hidden', 'true');
    link.append(cover, copy, go);
    return link;
  }));
  continueSection.hidden = items.length === 0;
}

function updateWords() {
  if (!words) return;
  let saved = 0;
  try {
    saved = stateRecords('vocabulary:').filter(([, , entry]) => entry && typeof entry === 'object' && 'savedAt' in entry).length;
  } catch { /* The link is optional. */ }
  /** @type {{waiting?:{due:number,fresh:number}, available?:number} | null} */
  let review = null;
  try { review = JSON.parse(localStorage.getItem('vocabulary-review:snapshot') ?? 'null'); }
  catch { /* No cached review on this device yet. */ }
  const due = review?.waiting?.due ?? 0;
  words.hidden = saved === 0;
  const count = saved + (saved === 1 ? ' saved word' : ' saved words');
  words.replaceChildren(element('span', 'library-words-count', count),
    element('span', 'library-words-action', due ? due + ' to repeat →' : 'Review →'));
  words.dataset.due = String(due);
}

const suggestionSection = /** @type {HTMLElement|null} */ (document.querySelector('[data-suggestions]'));
const suggestionList = document.querySelector('[data-suggestion-list]');
/** Suggestions hidden on this page stay as an "Undo" row until the page is reloaded. */
const justDismissed = new Set();
const levelNames = { easy: 'Easy English', right: 'Your level', hard: 'Hard English' };

/** @param {string} id @param {import('./reader-records.js').Choice | null} choice */
function choose(id, choice) {
  if (choice === 'dismissed') justDismissed.add(id);
  try { storeState('choice:' + id, choice); }
  catch { /* The choice is shown again after a reload. */ }
  updateSuggestions();
}

/** @param {string} id @param {Suggestion} suggestion @param {string|null|undefined} choice */
function suggestionCard(id, suggestion, choice) {
  const card = element('article', 'suggestion');
  card.dataset.suggestion = id;
  if (choice === 'dismissed') {
    card.classList.add('is-dismissed');
    const undo = /** @type {HTMLButtonElement} */ (element('button', 'suggestion-undo', 'Undo'));
    undo.type = 'button';
    undo.addEventListener('click', () => { justDismissed.delete(id); choose(id, null); });
    card.append(element('span', 'suggestion-hidden', 'Hidden: ' + suggestion.title), undo);
    return card;
  }
  const kind = suggestion.kind === 'book' ? 'Book' : 'Article';
  const meta = [suggestion.author ?? suggestion.publisher, suggestion.minutes ? suggestion.minutes + ' min' : '',
    suggestion.level ? levelNames[suggestion.level] : ''].filter(Boolean).join(' · ');
  const head = element('p', 'suggestion-meta');
  head.append(element('span', 'suggestion-kind', kind));
  if (meta) head.append(' · ' + meta);
  const title = element('h3', 'suggestion-title');
  const link = /** @type {HTMLAnchorElement} */ (element('a', '', suggestion.title));
  link.href = suggestion.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.lang = 'en';
  title.append(link);
  const want = /** @type {HTMLButtonElement} */ (element('button', 'suggestion-want', choice === 'want' ? '✓ Want to read' : 'Want to read'));
  want.type = 'button';
  want.setAttribute('aria-pressed', String(choice === 'want'));
  want.addEventListener('click', () => choose(id, choice === 'want' ? null : 'want'));
  const dismiss = /** @type {HTMLButtonElement} */ (element('button', 'suggestion-dismiss', 'Not interested'));
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => choose(id, 'dismissed'));
  const actions = element('div', 'suggestion-actions');
  actions.append(want, dismiss);
  card.append(head, title, element('p', 'suggestion-why', suggestion.why), actions);
  if (choice === 'want') card.append(element('p', 'suggestion-next', 'Ask Claude or Codex to add it to your library.'));
  return card;
}

let shownSuggestions = '';
/** Agents write suggestions into the reader state; the reader keeps or hides them here. */
function updateSuggestions() {
  if (!suggestionSection || !suggestionList) return;
  const shelf = new Set([...document.querySelectorAll('[data-material], [data-book]')]
    .map(item => item.getAttribute('data-material') ?? item.getAttribute('data-book')));
  /** @type {Map<string, unknown>} */
  const choices = new Map(stateRecords('choice:').map(([key, , value]) => [key.slice('choice:'.length), value]));
  const items = stateRecords('suggestion:').flatMap(([key, , value]) => {
    if (!value || typeof value !== 'object' || !('url' in value)) return [];
    const id = key.slice('suggestion:'.length);
    const choice = /** @type {string|undefined} */ (choices.get(id) ?? undefined);
    const hidden = (value.material && shelf.has(value.material)) || (choice === 'dismissed' && !justDismissed.has(id));
    return hidden ? [] : [{ id, suggestion: /** @type {Suggestion} */ (value), choice }];
  }).sort((a, b) => Number(b.choice === 'want') - Number(a.choice === 'want') || b.suggestion.score - a.suggestion.score)
    .slice(0, 6);
  const key = JSON.stringify(items);
  if (key === shownSuggestions) return;
  shownSuggestions = key;
  suggestionList.replaceChildren(...items.map(({ id, suggestion, choice }) => suggestionCard(id, suggestion, choice)));
  suggestionSection.hidden = items.length === 0;
}

function update() {
  updateArticles();
  updateContinue();
  updateSuggestions();
  updateWords();
}

update();
window.addEventListener('pageshow', update);
// book.js updates the shelf on the same events; let it finish first.
window.addEventListener('readerstatechange', () => queueMicrotask(update));
