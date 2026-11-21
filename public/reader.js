import { loadPosition, savePosition, setRead } from './progress.js';
import { expressionKey } from './reader-records.js';
import { stateRecords, stateValue, storeState, syncReaderState } from './sync.js';

const article = /** @type {HTMLElement} */ (document.getElementById('article'));
const lookup = /** @type {HTMLElement} */ (document.getElementById('lookup'));
const expression = /** @type {HTMLElement} */ (document.getElementById('expression'));
const result = /** @type {HTMLElement} */ (document.getElementById('translation'));
const source = /** @type {HTMLElement} */ (document.getElementById('translation-source'));
const explain = /** @type {HTMLButtonElement} */ (document.getElementById('explain'));
const context = /** @type {HTMLElement} */ (document.getElementById('context'));
const reader = document.querySelector('main');
const documentId = reader?.dataset.id ?? '';
const lookupUrl = reader?.dataset.lookup ?? '/read/' + documentId + '/lookup';
const documentTitle = article.querySelector('h1')?.textContent?.trim() ?? document.title;
const isBook = reader?.classList.contains('book-reader') ?? false;
const contents = document.querySelector('#contents');
const outline = /** @type {HTMLDetailsElement} */ (document.querySelector('#outline'));
if (matchMedia('(min-width: 861px)').matches) outline.open = true;
const words = new Intl.Segmenter('en', { granularity: 'word' });
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const maxSentenceLength = 1000;

const blocks = [...article.querySelectorAll('h1,h2,h3,h4,p,figcaption,pre,li,blockquote,figure,.book-table,div.math,.book-article img')].filter(
  block => !block.closest('summary') && (!block.closest('figcaption') || block.matches('figcaption'))
);
blocks.forEach((block, i) => {
  if (!block.id) block.id = 'paragraph-' + (i + 1);
});
/** @param {Element} heading */
function sectionAnchor(heading) {
  return heading.parentElement?.matches('section[id]') && heading === heading.parentElement.firstElementChild
    ? heading.parentElement.id : heading.id;
}
const titleHeading = article.querySelector('h1');
const sectionHeadings = [...article.querySelectorAll('h1,h2,section[id] > h3')]
  .filter(heading => heading !== titleHeading);
for (const heading of sectionHeadings) {
  const link = document.createElement('a');
  link.href = '#' + sectionAnchor(heading);
  link.textContent = heading.textContent;
  if (heading.tagName === 'H3') link.className = 'outline-subsection';
  contents?.append(link);
}
const quiz = document.querySelector('#quiz > summary');
const readingStatus = document.getElementById('reading-status');
if (readingStatus && contents) {
  const link = document.createElement('a');
  link.href = '#reading-status';
  link.textContent = 'Reading status';
  contents.append(link);
}
if (quiz && isBook) {
  const link = document.createElement('a');
  link.href = '#quiz';
  link.textContent = quiz.textContent;
  contents?.append(link);
}

if (!isBook) history.scrollRestoration = 'manual';
let lastScrollY = scrollY;
const marker = 112;
let restoring = Boolean(loadPosition(documentId)?.y || location.hash);
let lastInteraction = 0;
let lastSaved = 0;
const initialHash = location.hash;
// Opening a saved expression's passage from Vocabulary is a quick look, not a new reading position.
const peeking = Boolean(initialHash) && (() => {
  try { return new URL(document.referrer).origin === location.origin && new URL(document.referrer).pathname === '/vocabulary'; }
  catch { return false; }
})();
const initialSync = syncReaderState();
window.addEventListener('pageshow', async () => {
  await Promise.all([
    Promise.race([initialSync, new Promise(resolve => setTimeout(resolve, 1200))]),
    document.fonts.ready,
  ]);
  const math = /** @type {Window & {MathJax?: {startup?:{promise?:Promise<unknown>}}}} */ (window).MathJax;
  try { await math?.startup?.promise; } catch { /* TeX remains visible if typesetting fails. */ }
  restore();
  const shown = loadPosition(documentId)?.updatedAt;
  await initialSync;
  if (!initialHash && loadPosition(documentId)?.updatedAt !== shown) restore();
}, { once: true });

function restore() {
  if (lastInteraction || initialHash !== location.hash) return;
  restoring = true;
  const position = loadPosition(documentId);
  if (position && (!location.hash || (!isBook && position.hash === location.hash))) {
    const anchor = document.getElementById(position.anchor);
    const rect = anchor?.getBoundingClientRect();
    let target = position.y;
    if (rect?.height) {
      let offset = Math.min(position.offset, Math.max(0, rect.height - marker));
      const depth = position.offset + marker;
      if (position.anchorHeight && depth >= 0 && depth < position.anchorHeight) {
        offset = depth * rect.height / position.anchorHeight - marker;
      }
      target = window.scrollY + rect.top + offset;
    }
    window.scrollTo(0, target);
  } else if (location.hash) {
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Leave a malformed fragment unchanged. */ }
    document.getElementById(id)?.scrollIntoView();
  }
  lastScrollY = scrollY;
  restoring = false;
  updateOutline();
}

function updateOutline() {
  const current = sectionHeadings.findLast(heading => heading.getBoundingClientRect().top <= 150);
  for (const link of contents?.querySelectorAll('a') ?? []) {
    if (current && link.hash === '#' + sectionAnchor(current)) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

let scrollFrame = 0;
function recordScroll() {
  if (restoring || scrollY === lastScrollY) return;
  lastScrollY = scrollY;
  lastInteraction = Date.now();
}

function saveReadingPosition() {
  recordScroll();
  if (peeking || restoring || lastSaved === lastInteraction) return;
  const y = scrollY;
  const block = blocks.find(element => element.getBoundingClientRect().bottom > marker) ?? blocks.at(-1);
  if (!block) return;
  const rect = block.getBoundingClientRect();
  const end = article.getBoundingClientRect().bottom;
  const start = article.getBoundingClientRect().top + y;
  const distance = end + y - innerHeight;
  const percent = Math.min(99, Math.floor(Math.max(0, (y - start) / Math.max(1, distance - start)) * 100));
  savePosition(documentId, {
    anchor: y ? block.id : '',
    offset: y ? -rect.top : 0,
    anchorHeight: rect.height,
    y,
    hash: location.hash,
    percent: y ? percent : 0,
  }, lastInteraction);
  lastSaved = lastInteraction;
}

window.addEventListener('scroll', () => {
  recordScroll();
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    saveReadingPosition();
    updateOutline();
  });
}, { passive: true });
window.addEventListener('pagehide', saveReadingPosition, { capture: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveReadingPosition(); }, { capture: true });

const readingButton = readingStatus?.querySelector('button[data-mark-read]');
const readingButtonLabel = readingButton?.querySelector('[data-mark-read-label]');
const readingStatusLabel = readingStatus?.querySelector('.reading-status-label');
if (readingButton instanceof HTMLButtonElement && readingButtonLabel && readingStatusLabel) {
  const button = readingButton;
  const label = readingButtonLabel;
  const status = readingStatusLabel;
  const update = () => {
    const read = loadPosition(documentId)?.read === true;
    if (button.dataset.read === String(read)) return;
    button.dataset.read = String(read);
    label.textContent = read ? 'Mark as unread' : 'Mark as read';
    status.textContent = read ? 'Finished' : '';
  };
  button.addEventListener('click', () => {
    saveReadingPosition();
    const read = !loadPosition(documentId)?.read;
    if (!setRead(documentId, read)) {
      status.textContent = 'Couldn’t save. Try again.';
      return;
    }
    update();
    const check = button.querySelector('path');
    check?.getAnimations().forEach(animation => animation.cancel());
    if (read && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      check?.animate([{ strokeDashoffset: 12 }, { strokeDashoffset: 0 }], { duration: 220, easing: 'ease-out' });
    }
  });
  window.addEventListener('readerstatechange', update);
  window.addEventListener('pageshow', update);
  update();
  button.hidden = false;
}

/** @type {AbortController | undefined} */
let request;
/** @type {Range | undefined} */
let selectionRange;
/** @type {{text:string,sentence:string,anchor:string}|undefined} */
let selection;
/** @type {Map<string,{text:string,source:string}>} */
const translations = new Map();

const save = document.querySelector('button[data-save-expression]');
/** @type {import('./reader-records.js').Expression | null} */
let saveSelection = null;

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

const editTranslation = /** @type {HTMLButtonElement|null} */ (document.getElementById('edit-translation'));
const savedNote = /** @type {HTMLElement|null} */ (document.getElementById('saved-note'));

/** @param {string} text */
const normalized = text => text.normalize().trim().replace(/\s+/g, ' ').toLowerCase();

/** @param {boolean} saved */
function updateSave(saved) {
  if (!save) return;
  save.setAttribute('aria-disabled', String(saved));
  save.textContent = saved ? 'Saved' : 'Save expression';
  if (editTranslation) editTranslation.hidden = saved || !saveSelection;
  if (saved) stopEditing();
}

/** Shows translations already saved for the same expression, so the reader does not save a duplicate. */
function updateSavedNote() {
  if (!savedNote) return;
  const text = saveSelection ? normalized(saveSelection.text) : '';
  const current = saveSelection ? normalized(currentTranslation()) : '';
  /** @type {string[]} */
  let others = [];
  try {
    others = text ? stateRecords('vocabulary:').flatMap(([, , entry]) =>
      entry && typeof entry === 'object' && 'savedAt' in entry && normalized(entry.text) === text &&
      normalized(entry.translation) !== current ? [entry.translation] : []) : [];
  } catch { /* The note is optional. */ }
  savedNote.hidden = !others.length;
  savedNote.textContent = others.length ? 'In your vocabulary: ' + [...new Set(others)].join('; ') : '';
}

function currentTranslation() {
  return (result.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function stopEditing() {
  if (result.isContentEditable) {
    result.contentEditable = 'false';
    result.classList.remove('is-editing');
    if (editTranslation) editTranslation.textContent = 'Edit';
  }
}

editTranslation?.addEventListener('click', () => {
  if (result.isContentEditable) {
    stopEditing();
    refreshSave();
    return;
  }
  try { result.contentEditable = 'plaintext-only'; } catch { result.contentEditable = 'true'; }
  result.classList.add('is-editing');
  editTranslation.textContent = 'Done';
  result.focus();
  const range = document.createRange();
  range.selectNodeContents(result);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
});
result.addEventListener('keydown', event => {
  if (event.key === 'Enter' && result.isContentEditable) {
    event.preventDefault();
    stopEditing();
    refreshSave();
  }
});
result.addEventListener('input', () => {
  edited = true;
  if (saveSelection) { updateSave(false); updateSavedNote(); }
});

function resetSave() {
  saveSelection = null;
  stopEditing();
  if (savedNote) savedNote.hidden = true;
  if (!(save instanceof HTMLButtonElement)) return;
  updateSave(false);
  save.hidden = true;
}

/** @param {import('./reader-records.js').Expression} entry */
function offerSave(entry) {
  resetSave();
  const href = passageHref(entry.href);
  if (!(save instanceof HTMLButtonElement) || !href || !entry.text.trim() || !entry.translation.trim()) return;
  saveSelection = { ...entry, href };
  save.hidden = false;
  refreshSave();
}

function refreshSave() {
  if (!saveSelection) return;
  const translation = currentTranslation();
  if (translation) saveSelection = { ...saveSelection, translation };
  updateSave(Boolean(stateValue(expressionKey(saveSelection))));
  updateSavedNote();
}

save?.addEventListener('click', () => {
  if (!saveSelection || save.getAttribute('aria-disabled') === 'true') return;
  const translation = currentTranslation();
  if (!translation) return;
  saveSelection = { ...saveSelection, translation };
  savedHere = true;
  try {
    const key = expressionKey(saveSelection);
    if (!stateValue(key)) {
      const now = Date.now();
      storeState(key, { ...saveSelection, savedAt: now }, now);
    }
    updateSave(true);
    updateSavedNote();
  } catch {
    save.textContent = 'Try saving again';
  }
});

if (save) window.addEventListener('readerstatechange', refreshSave);

// Saved expressions are marked in the text with the CSS Custom Highlight API, which leaves the DOM unchanged.
let highlightTimer = 0;
function highlightSaved() {
  if (typeof Highlight !== 'function' || !CSS.highlights) return;
  /** @type {string[]} */
  let texts = [];
  try {
    texts = [...new Set(stateRecords('vocabulary:').flatMap(([, , entry]) =>
      entry && typeof entry === 'object' && 'savedAt' in entry ? [entry.text.trim().toLowerCase()] : []))]
      .filter(text => /\p{L}{2}/u.test(text));
  } catch { /* Highlighting is optional. */ }
  if (!texts.length) { CSS.highlights.delete('saved-expression'); return; }
  const alternatives = texts.sort((a, b) => b.length - a.length)
    .map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  const pattern = new RegExp('(?<![\\p{L}\\p{N}])(?:' + alternatives.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('pre, code, mjx-container, h1, figcaption')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  /** @type {Range[]} */
  const ranges = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = /** @type {Text} */ (node);
    for (const match of text.data.matchAll(pattern)) {
      const range = new Range();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      ranges.push(range);
    }
  }
  CSS.highlights.set('saved-expression', new Highlight(...ranges));
}
function scheduleHighlight() {
  clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(highlightSaved, 300);
}
window.addEventListener('readerstatechange', scheduleHighlight);
scheduleHighlight();

/** @type {AbortController | undefined} */
let refining;
let edited = false;
let savedHere = false;

/**
 * Replaces the quick translation with one that takes the sentence into account, unless
 * the reader has already edited or saved it. The quick answer stays when the model has none.
 * @param {string} text @param {string} quickSource
 */
async function refineLookup(text, quickSource) {
  refining?.abort();
  const sentence = selection?.sentence ?? '';
  if (!lookup.hasAttribute('data-context-model') || !sentence || sentence.length > maxSentenceLength ||
      normalized(sentence) === normalized(text) || text.split(' ').length > 6) return;
  refining = new AbortController();
  const { signal } = refining;
  const key = new URLSearchParams({ text, sentence, refine: '1' }).toString();
  source.textContent = quickSource + ' · checking the sentence…';
  try {
    let response = translations.get(key);
    if (!response) {
      const reply = await fetch(lookupUrl + '?' + key, { signal });
      if (!reply.ok) throw new Error('No refinement');
      response = /** @type {{text:string,source:string}} */ (await reply.json());
      translations.set(key, response);
    }
    if (signal.aborted || selection?.text !== text) return;
    // Keep what the reader typed or just saved; otherwise show the better translation.
    if (edited || savedHere) {
      if (normalized(response.text) !== normalized(currentTranslation())) source.textContent = quickSource + ' · in this sentence: ' + response.text;
      else source.textContent = 'In this sentence';
    } else {
      result.textContent = response.text;
      source.textContent = 'In this sentence';
      refreshSave();
    }
  } catch {
    if (!signal.aborted && selection?.text === text) source.textContent = quickSource;
  }
  placeLookup();
}

/** @param {string} text @param {boolean} [withContext] */
async function fetchLookup(text, withContext = false) {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const params = new URLSearchParams({ text });
  if (withContext) {
    params.set('context', '1');
    if (selection?.sentence && selection.sentence.length <= maxSentenceLength) {
      params.set('sentence', selection.sentence);
    }
  }
  const target = withContext ? context : result;
  try {
    const key = params.toString();
    let response = translations.get(key);
    if (!response) {
      const reply = await fetch(lookupUrl + '?' + key, { signal });
      if (reply.status === 422 && !withContext) {
        const message = await reply.text();
        if (!signal.aborted) target.textContent = message;
        return;
      }
      if (!reply.ok) throw new Error('Lookup failed');
      response = /** @type {{text:string,source:string}} */ (await reply.json());
      if (translations.size >= 160) translations.delete(translations.keys().next().value ?? '');
      translations.set(key, response);
    }
    if (signal.aborted) return;
    target.textContent = response.text;
    if (!withContext) {
      source.textContent = response.source;
      const hasGlossaryNote = response.source.endsWith(' glossary');
      const canTranslateSentence = lookup.hasAttribute('data-lookup-model') && Boolean(selection?.sentence && selection.sentence.length <= maxSentenceLength &&
        selection.sentence !== selection.text);
      explain.hidden = !hasGlossaryNote && !canTranslateSentence;
      explain.textContent = hasGlossaryNote ? 'In context' : 'Translate sentence';
      if (selection?.anchor) {
        offerSave({
          text: selection.text, translation: response.text, sentence: selection.sentence,
          href: location.pathname + '#' + encodeURIComponent(selection.anchor), title: documentTitle,
        });
      }
      if (!hasGlossaryNote) void refineLookup(text, response.source);
    }
  } catch {
    if (!signal.aborted) target.textContent = 'Translation unavailable. Try again.';
  }
  placeLookup();
}

function placeLookup() {
  if (!selectionRange || lookup.hidden) return;
  const rect = selectionRange.getBoundingClientRect();
  const gap = 9;
  const height = lookup.offsetHeight;
  const width = lookup.offsetWidth;
  lookup.style.left = Math.max(gap, Math.min(rect.left - 8, innerWidth - width - gap)) + 'px';
  const top = rect.bottom + height + gap < innerHeight ? rect.bottom + gap : rect.top - height - gap;
  lookup.style.top = Math.max(gap, Math.min(top, innerHeight - height - gap)) + 'px';
}

function closeLookup() {
  request?.abort();
  refining?.abort();
  const chosen = window.getSelection();
  if (chosen?.rangeCount && chosen.toString() === selectionRange?.toString()) chosen.removeAllRanges();
  lookup.hidden = true;
  resetSave();
  selectionRange = undefined;
  selection = undefined;
}

/** @param {Range} range */
function openLookup(range) {
  const text = range.toString().trim().replace(/\s+/g, ' ');
  if (!text || text.length > 320 || !/[a-z]/i.test(text)) return closeLookup();
  const block = range.startContainer.parentElement?.closest('p,h1,h2,h3,h4,li,figcaption,pre,td,th');
  let sentence = '';
  if (block) {
    const prefix = document.createRange();
    prefix.setStart(block, 0);
    prefix.setEnd(range.startContainer, range.startOffset);
    const offset = prefix.toString().length;
    const blockText = document.createRange();
    blockText.selectNodeContents(block);
    sentence = [...sentences.segment(blockText.toString())].find(part =>
      offset < part.index + part.segment.length
    )?.segment.trim() ?? '';
  }
  const anchor = block?.closest('[id]')?.id ?? '';
  selection = { text, sentence, anchor };
  refining?.abort();
  edited = false;
  savedHere = false;
  resetSave();
  selectionRange = range.cloneRange();
  expression.textContent = text;
  result.textContent = 'Translating…';
  source.textContent = '';
  context.hidden = true;
  explain.setAttribute('aria-expanded', 'false');
  explain.hidden = true;
  lookup.hidden = false;
  placeLookup();
  void fetchLookup(text);
}

/** @param {number} x @param {number} y */
function wordAtPoint(x, y) {
  const caret = document.caretPositionFromPoint?.(x, y);
  const fallback = caret ? null : document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? fallback?.startContainer;
  const offset = caret?.offset ?? fallback?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || !article.contains(node)) return;
  const text = node.textContent ?? '';
  for (const word of words.segment(text)) {
    if (!word.isWordLike) continue;
    if (word.index > offset || word.index + word.segment.length < offset) continue;
    const range = document.createRange();
    range.setStart(node, word.index);
    range.setEnd(node, word.index + word.segment.length);
    if ([...range.getClientRects()].some(rect => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top && y <= rect.bottom)) return range;
  }
}

/** @type {{x:number,y:number}|null} */
let pointerStart = null;
article.addEventListener('pointerdown', event => {
  pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
});
window.addEventListener('pointerup', event => {
  const start = pointerStart;
  pointerStart = null;
  if (!start) return;
  requestAnimationFrame(() => {
    const chosen = window.getSelection();
    if (chosen && !chosen.isCollapsed && chosen.rangeCount && article.contains(chosen.anchorNode) && article.contains(chosen.focusNode)) {
      openLookup(chosen.getRangeAt(0));
    } else if (
      event.target instanceof Element && article.contains(event.target) &&
      !event.target.closest('a,video,button,summary,mjx-container') && Math.hypot(start.x - event.clientX, start.y - event.clientY) < 5
    ) {
      const word = wordAtPoint(event.clientX, event.clientY);
      if (word) openLookup(word);
    }
  });
});
document.addEventListener('pointerdown', event => {
  if (event.target instanceof Node && !lookup.contains(event.target)) closeLookup();
});
// iOS adjusts a selection with handles and long presses without sending pointerup,
// so a settled selection that differs from the open lookup opens it again.
let pointerHeld = false;
article.addEventListener('pointerdown', () => { pointerHeld = true; });
window.addEventListener('pointerup', () => { pointerHeld = false; });
window.addEventListener('pointercancel', () => { pointerHeld = false; });
let selectionTimer = 0;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    if (pointerHeld || result.isContentEditable) return;
    const chosen = window.getSelection();
    if (!chosen || chosen.isCollapsed || !chosen.rangeCount || !article.contains(chosen.anchorNode) || !article.contains(chosen.focusNode)) return;
    const range = chosen.getRangeAt(0);
    const text = range.toString().trim().replace(/\s+/g, ' ');
    if (text && text !== selection?.text) openLookup(range);
  }, 400);
});
window.addEventListener('resize', placeLookup);
window.addEventListener('scroll', () => {
  if (!selectionRange) return;
  const rect = selectionRange.getBoundingClientRect();
  if (rect.bottom < 55 || rect.top > innerHeight) closeLookup();
  else placeLookup();
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !lookup.hidden) closeLookup();
  if (event.key === 'Enter' && event.altKey) {
    const chosen = window.getSelection();
    if (chosen && !chosen.isCollapsed && chosen.rangeCount && article.contains(chosen.anchorNode) && article.contains(chosen.focusNode)) {
      event.preventDefault();
      openLookup(chosen.getRangeAt(0));
    }
  }
});
document.querySelector('#dismiss')?.addEventListener('click', closeLookup);
explain.addEventListener('click', () => {
  if (!selection) return;
  context.hidden = !context.hidden;
  explain.setAttribute('aria-expanded', String(!context.hidden));
  const glossary = source.textContent?.endsWith(' glossary');
  explain.textContent = context.hidden ? (glossary ? 'In context' : 'Translate sentence') : (glossary ? 'Hide context' : 'Hide sentence');
  if (!context.hidden) {
    context.textContent = 'Loading…';
    void fetchLookup(selection.text, true);
  }
  placeLookup();
});

for (const [index, question] of [...document.querySelectorAll('.question')].entries()) {
  const input = question.querySelector('textarea');
  const reveal = /** @type {HTMLButtonElement|null} */ (question.querySelector('.reveal'));
  const expected = /** @type {HTMLElement|null} */ (question.querySelector('.expected'));
  if (!input || !reveal || !expected) continue;
  const answerId = 'quiz:' + documentId + ':' + index;
  try { input.value = localStorage.getItem(answerId) ?? ''; }
  catch { /* Taking a quiz works without storage. */ }
  reveal.disabled = !input.value.trim();
  input.addEventListener('input', () => {
    reveal.disabled = !input.value.trim();
    if (reveal.disabled) expected.hidden = true;
    try {
      if (input.value) localStorage.setItem(answerId, input.value);
      else localStorage.removeItem(answerId);
    } catch { /* Leave the current answer visible. */ }
  });
  reveal.addEventListener('click', () => { expected.hidden = false; });
}

if (isBook) {
  const returnLink = document.querySelector('[data-quiz-return]');
  /** @type {HTMLAnchorElement | null} */
  let anchorLink = null;
  for (const link of document.querySelectorAll('#quiz .expected a')) {
    if (!(link instanceof HTMLAnchorElement) || !(returnLink instanceof HTMLButtonElement)) continue;
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const section = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!section) return;
      anchorLink = link;
      returnLink.hidden = false;
      const heading = /** @type {HTMLElement} */ (section.querySelector(':scope > :is(h1,h2,h3,h4)') ?? section);
      heading.tabIndex = -1;
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    });
  }
  window.addEventListener('hashchange', () => {
    if (anchorLink && location.hash !== anchorLink.hash && returnLink instanceof HTMLButtonElement) {
      returnLink.hidden = true;
      const focus = anchorLink;
      requestAnimationFrame(() => focus.focus({ preventScroll: true }));
    }
  });
  returnLink?.addEventListener('click', () => {
    if (!(returnLink instanceof HTMLButtonElement) || !anchorLink) return;
    returnLink.hidden = true;
    if (location.hash === anchorLink.hash) history.replaceState(history.state, '', location.pathname + location.search);
    anchorLink.focus();
  });
}
