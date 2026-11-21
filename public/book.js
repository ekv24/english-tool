import { loadPosition } from './progress.js';
import './book-search.js';

const startLinks = new Map([...document.querySelectorAll('a[data-book-resume]')].map(link => [
  link, { href: link.getAttribute('href') ?? '', label: link.textContent ?? '', hidden: link.hasAttribute('hidden') },
]));

/** @param {HTMLElement} container */
function updateBook(container) {
  const id = container.dataset.book;
  const base = '/books/' + id + '/';
  /** @type {Map<string, {title: string, type: string, percent: number, read: boolean, time: number}>} */
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
    });
    const label = entry.querySelector('[data-page-progress]');
    if (label) label.textContent = read ? 'Finished' : percent ? 'At ' + percent + '%' : '';
    if (entry.hasAttribute('aria-label')) {
      entry.setAttribute('aria-label', label?.textContent ? title + ', ' + label.textContent : title);
    }
  }
  if (!pages.size) return;

  const chapters = [...pages.values()].filter(page => page.type === 'chapter');
  const finished = chapters.filter(page => page.read).length;
  const percent = Math.floor(chapters.reduce((sum, page) => sum + page.percent, 0) / (chapters.length || 1));
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

updateBooks();
window.addEventListener('pageshow', updateBooks);
window.addEventListener('readerstatechange', updateBooks);
