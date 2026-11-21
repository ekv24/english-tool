import { loadPosition } from './progress.js';
import { stateRecords } from './sync.js';
import './book.js';

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
      : percent ? 'At ' + percent + '%' : position?.y ? 'In progress' : 'To read';
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
    meter.append(progress, element('span', 'continue-percent', item.percent ? item.percent + '%' : 'Started'));
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

// Wide pictures get a typeset cover instead of a letterbox; the shape is known once the image loads.
for (const image of document.querySelectorAll('.cover-image')) {
  if (!(image instanceof HTMLImageElement)) continue;
  const mark = () => {
    if (image.naturalWidth && image.naturalWidth / image.naturalHeight > .85) image.parentElement?.classList.add('is-wide');
  };
  if (image.complete) mark();
  else image.addEventListener('load', mark, { once: true });
}

function update() {
  updateArticles();
  updateContinue();
  updateWords();
}

update();
window.addEventListener('pageshow', update);
// book.js updates the shelf on the same events; let it finish first.
window.addEventListener('readerstatechange', () => queueMicrotask(update));
