import { loadPosition, percentLabel } from './progress.js';
import './book-search.js';
import './feedback.js';

const startLinks = new Map([...document.querySelectorAll('a[data-book-resume]')].map(link => [
  link, { href: link.getAttribute('href') ?? '', label: link.textContent ?? '', hidden: link.hasAttribute('hidden') },
]));

/** @param {HTMLElement} container */
function updateBook(container) {
  const id = container.dataset.book;
  const base = '/books/' + id + '/';
  /** @type {Map<string, {title: string, type: string, percent: number, read: boolean, time: number, words: number}>} */
  const pages = new Map();
  for (const entry of container.querySelectorAll('[data-book-page]')) {
    const slug = entry.getAttribute('data-book-page') ?? '';
    const title = entry.getAttribute('data-page-title') ?? '';
    const position = loadPosition(id + '/' + slug);
    const percent = position?.percent ?? 0;
    const read = position?.read ?? false;
    pages.set(slug, {
      title,
      type: entry.getAttribute('data-page-type') ?? '',
      percent: read ? 100 : percent,
      read,
      time: position?.y ? position.updatedAt ?? 0 : 0,
      words: Number(entry.getAttribute('data-page-words')) || 0,
    });
    const label = entry.querySelector('[data-page-progress]');
    if (label) label.textContent = read ? 'Finished' : percent ? 'At ' + percentLabel(percent) : '';
    if (entry.hasAttribute('aria-label')) {
      entry.setAttribute('aria-label', label?.textContent ? title + ', ' + label.textContent : title);
    }
  }
  if (!pages.size) return;

  const chapters = [...pages.values()].filter(page => page.type === 'chapter');
  const finished = chapters.filter(page => page.read).length;
  // The book's main text counts, introduction included, each page by its length (the server leaves notes and such at 0).
  const all = [...pages.values()];
  const weight = /** @param {{words:number}} page */ page => all.some(other => other.words) ? page.words : 1;
  const total = all.reduce((sum, page) => sum + weight(page), 0);
  const percent = Math.min(100, Math.floor(all.reduce((sum, page) => sum + page.percent * weight(page), 0) / (total || 1) * 10) / 10);
  for (const bar of container.querySelectorAll('progress[data-book-progress]')) {
    if (bar instanceof HTMLProgressElement) bar.value = percent;
  }

  const recent = [...pages].filter(([, page]) => page.time > 0).sort(([, a], [, b]) => b.time - a.time)[0]?.[0] ?? '';
  const chapter = pages.get(recent);
  // The library uses these to sort the shelf and to fill "Continue reading".
  container.dataset.state = chapters.length && finished === chapters.length ? 'done' : chapter || finished ? 'reading' : 'new';
  container.dataset.percent = String(percent);
  container.dataset.time = String(chapter?.time ?? 0);
  container.dataset.chapter = chapter?.title ?? '';
  const summary = container.querySelector('[data-book-progress-row]');
  if (summary instanceof HTMLElement) {
    summary.hidden = container.dataset.state === 'new';
    const label = summary.querySelector('[data-book-percent]');
    if (label) label.textContent = percentLabel(percent) + ' read' + (finished ? ' · ' + finished + ' of ' + chapters.length + ' chapters finished' : '');
  }
  for (const status of container.querySelectorAll('[data-book-status]')) {
    status.textContent = finished ? finished + ' of ' + chapters.length + ' chapters finished'
      : chapter ? 'In progress' : 'To read';
  }
  for (const link of container.querySelectorAll('a[data-book-resume]')) {
    const start = startLinks.get(link);
    if (!(link instanceof HTMLAnchorElement) || !start) continue;
    link.href = chapter ? base + recent : start.href;
    link.hidden = !chapter && start.hidden;
    link.textContent = chapter ? 'Continue reading →' : start.label;
    link.title = chapter?.title ?? '';
    const chapterTitle = link.parentElement?.querySelector('[data-resume-title]');
    if (chapterTitle) chapterTitle.textContent = chapter?.title ?? '';
  }
}

function updateBooks() {
  for (const container of document.querySelectorAll('[data-book]')) {
    if (container instanceof HTMLElement) updateBook(container);
  }
}

const contents = document.getElementById('book-contents');
document.querySelector('[data-open-book-contents]')?.addEventListener('click', () => {
  if (!(contents instanceof HTMLDialogElement)) return;
  updateBooks();
  contents.showModal();
  contents.querySelector('a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
});

// Wide pictures get a typeset cover instead of a letterbox; the shape is known once the image loads.
for (const image of document.querySelectorAll('.cover-image')) {
  if (!(image instanceof HTMLImageElement)) continue;
  const mark = () => {
    if (image.naturalWidth && image.naturalWidth / image.naturalHeight > .85) image.parentElement?.classList.add('is-wide');
  };
  if (image.complete) mark();
  else image.addEventListener('load', mark, { once: true });
}

updateBooks();
window.addEventListener('pageshow', updateBooks);
window.addEventListener('readerstatechange', updateBooks);
