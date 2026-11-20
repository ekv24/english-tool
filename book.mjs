import { escape } from './html.mjs';
import { libraryDirectory, libraryIds, originalSource, readMetadata } from './library.mjs';

/** @param {string} id */
export function bookPath(id) {
  return '/books/' + id;
}

/** @typedef {{slug:string,title:string,number?:string,original:string,type:'intro'|'chapter'|'appendix'}} BookPage */
/** @typedef {{title:string,entries:({slug:string}|{title:string,href:string})[]}} BookPart */
/**
 * @typedef {{id:string,title:string,author:string,source?:string,math?:boolean,glossaryLanguage?:string,cover?:string,
 *   description?:string,copyright?:string,start?:string,startLabel?:string,license?:string,licenseName?:string,
 *   items:BookPage[],toc:BookPart[]}} Book
 */

/** @param {string} id @param {URL} directory @returns {Promise<Book|null>} */
export async function loadBook(id, directory) {
  const book = /** @type {Book|null} */ (await readMetadata(new URL('manifest.json', directory), id));
  return book?.id === id && book.items.length &&
    book.items.every(item => /^[a-z0-9-]+$/.test(item.slug)) ? book : null;
}

export async function loadBooks() {
  const ids = await libraryIds('books');
  const entries = await Promise.all(ids.map(async id => {
    const directory = await libraryDirectory('books', id);
    return directory ? loadBook(id, directory) : null;
  }));
  return entries.filter(book => book !== null);
}

/** @param {Book} book @param {boolean} [eager] */
export function libraryBook(book, eager = false) {
  const count = book.items.filter(item => item.type === 'chapter').length;
  const path = bookPath(book.id);
  const start = book.items.find(item => item.type === 'chapter') ?? book.items[0];
  return '<section class="library-books" aria-label="' + escape(book.title) + '" data-book="' + escape(book.id) + '">' +
    '<a class="book-library-card" href="' + path + '" data-book-summary>' +
    libraryImage(path + '/images/', book.cover, eager) +
    '<div class="book-library-copy">' +
    '<p class="book-library-meta">Book · ' + count + ' chapters</p><h2 class="book-library-title">' + escape(book.title) + '</h2>' +
    '<p class="book-library-description">' + escape(book.author) + '</p></div>' +
    '<div class="book-library-progress"><span class="card-status" data-book-status>To read</span>' +
    '<progress max="100" value="0" aria-label="Book reading progress" data-book-progress></progress></div></a>' +
    '<a class="book-library-resume" data-book-resume href="' + path + '/' + escape(start.slug) + '" hidden>Continue reading →</a>' +
    '<div data-book-pages hidden>' + book.items.map(item => bookPageData(item)).join('') + '</div></section>';
}

export const libraryThumbnail = 'library-v1';

/** @param {string} base @param {string} [file] @param {boolean} [eager] */
export function libraryImage(base, file, eager = false) {
  if (!file || !/^[\w.-]+\.(?:png|jpe?g|webp|avif)$/i.test(file)) return '';
  return '<img class="library-image" src="' + escape(base + file) + '?thumbnail=' + libraryThumbnail +
    '" alt="" decoding="async"' + (eager ? '' : ' loading="lazy"') + '>';
}

/** @param {BookPage} item */
function bookPageData(item) {
  return '<span data-book-page="' + escape(item.slug) + '" data-page-type="' + escape(item.type) + '" data-page-title="' + escape(item.title) + '"></span>';
}

/** @param {Book} book */
export function bookOverview(book) {
  const path = bookPath(book.id);
  const start = book.items.find(item => item.slug === book.start) ?? book.items[0];
  const description = book.description;
  return '<main class="reading-column book-overview" data-book="' + escape(book.id) + '"><header class="book-hero">' +
    '<p class="book-eyebrow">Book · ' + escape(book.author) + '</p><h1>' + escape(book.title) + '</h1>' +
    (description ? '<p class="book-description">' + escape(description) + '</p>' : '') +
    '<div class="book-actions"><a class="book-primary" data-book-resume href="' + path + '/' + escape(start.slug) + '">' +
    escape(start.slug === book.start && book.startLabel ? book.startLabel : 'Start reading') + '</a>' +
    '<span data-resume-title></span><span data-book-status aria-live="polite"></span></div></header>' +
    '<h2 id="book-toc-heading">Contents</h2>' + bookSearch('overview-search') + bookContents(book) +
    '<footer class="book-credit">By ' + escape(book.author) +
    (bookLicense(book) ? ' · <a href="' + path + '/license">' + escape(book.licenseName ?? 'License') + '</a>'
      : book.copyright ? ' · ' + escape(book.copyright) : '') + '</footer></main>';
}

/** Returns the license file named by the manifest, if it is a plain file name. @param {Book} book */
export function bookLicense(book) {
  return book.license && /^[\w-]+(?:\.[\w-]+)*$/.test(book.license) ? book.license : '';
}

/** @param {Book} book @param {BookPage} [current] */
export function bookContents(book, current) {
  const intro = book.items[0];
  const items = new Map(book.items.map(item => [item.slug, item]));
  return '<nav class="book-toc" aria-label="Book contents"><ul>' + entryLink(intro) +
    book.toc.map(part => '<li class="book-part"><h3>' + escape(part.title) + '</h3><ul>' + part.entries.map(entry => {
      if ('href' in entry) return '<li><a class="book-entry" href="' + escape(entry.href) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="book-entry-title">' + escape(entry.title) + ' ↗</span></a></li>';
      const item = items.get(entry.slug);
      return item ? entryLink(item) : '';
    }).join('') + '</ul></li>').join('') +
    '</ul></nav>';

  /** @param {BookPage} item */
  function entryLink(item) {
    const currentPage = item.slug === current?.slug ? ' aria-current="page"' : '';
    return '<li class="book-entry"><a href="' + bookPath(book.id) + '/' + escape(item.slug) + '"' + currentPage +
      ' data-book-page="' + escape(item.slug) + '" data-page-type="' + escape(item.type) + '" data-page-title="' + escape(item.title) + '"' +
      ' aria-label="' + escape(item.title) + '">' +
      (item.number ? '<span class="book-entry-number">' + escape(item.number) + '</span>' : '') +
      '<span class="book-entry-title">' + escape(item.number ? item.title.slice(item.number.length + 3) : item.title) + '</span>' +
      '<span class="book-entry-progress" data-page-progress></span></a></li>';
  }
}

/** @param {Book} book @param {BookPage} item */
export function bookTrail(book, item) {
  return '<div class="book-trail"><a href="' + bookPath(book.id) + '">← ' + escape(book.title) + '</a></div>' +
    '<dialog class="book-contents" id="book-contents" aria-labelledby="book-contents-title"><div class="book-contents-header">' +
    '<h2 id="book-contents-title">Book contents</h2><form method="dialog"><button type="submit" aria-label="Close book contents" autofocus>×</button></form></div>' +
    bookSearch('chapter-search') + bookContents(book, item) + '</dialog>';
}

export function bookContentsButton() {
  return '<button class="book-contents-trigger topbar-link" type="button" aria-label="Book contents" ' +
    'aria-haspopup="dialog" aria-controls="book-contents" data-open-book-contents>Contents</button>';
}

/** @param {string} id */
function bookSearch(id) {
  return '<div class="book-search"><label for="' + id + '">Find a chapter</label>' +
    '<input type="search" id="' + id + '" placeholder="Search chapter titles" autocomplete="off" data-book-filter>' +
    '<p data-book-filter-status role="status" hidden></p></div>';
}

/** @param {Book} book @param {BookPage} item */
export function chapterNav(book, item) {
  const index = book.items.indexOf(item);
  return '<nav class="book-chapter-nav" aria-label="Chapter navigation">' + chapterLink(book.items[index - 1], 'Previous') +
    chapterLink(book.items[index + 1], 'Next') + '</nav>';

  /** @param {BookPage|undefined} page @param {'Previous'|'Next'} direction */
  function chapterLink(page, direction) {
    if (!page) return '<span></span>';
    return '<a href="' + bookPath(book.id) + '/' + escape(page.slug) + '" rel="' + (direction === 'Next' ? 'next' : 'prev') +
      '"><small>' + (direction === 'Next' ? 'Next →' : '← Previous') + '</small><strong>' + escape(page.title) + '</strong></a>';
  }
}

/** @param {Book} book @param {BookPage} item */
export function originalUrl(book, item) {
  const local = bookPath(book.id) + '/' + bookOriginal(book);
  const source = originalSource(book.source, local);
  return source ? originalSource((book.source ?? '') + item.original, local) : '';
}

/** Names the local original file that the manifest's source points to. @param {Book} book */
export function bookOriginal(book) {
  return book.source === bookPath(book.id) + '/original.epub' ? 'original.epub' : 'original.pdf';
}
