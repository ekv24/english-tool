import { readFile, stat } from 'node:fs/promises';
import { escape } from './html.mjs';
import { libraryDirectory, libraryIds, originalSource, readMetadata } from './library.mjs';

/** @param {string} id */
export function bookPath(id) {
  return '/books/' + id;
}

/** @typedef {{slug:string,title:string,number?:string,original:string,type:'intro'|'chapter'|'appendix',words?:number}} BookPage */
/** @typedef {{title:string,entries:({slug:string}|{title:string,href:string})[]}} BookPart */
/**
 * @typedef {{id:string,title:string,author:string,source?:string,math?:boolean,glossaryLanguage?:string,cover?:string,
 *   description?:string,copyright?:string,start?:string,startLabel?:string,license?:string,licenseName?:string,
 *   items:BookPage[],toc:BookPart[]}} Book
 */

/** @type {Map<string,{mtimeMs:number,words:number}>} */
const pageWords = new Map();

/** Counts the words of a book page so its share of the book's progress matches its length. @param {URL} file */
async function wordsIn(file) {
  try {
    const { mtimeMs } = await stat(file);
    const cached = pageWords.get(file.href);
    if (cached?.mtimeMs === mtimeMs) return cached.words;
    const text = (await readFile(file, 'utf8')).replace(/<(script|style|svg|math)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    const words = text.match(/\p{L}+/gu)?.length ?? 0;
    pageWords.set(file.href, { mtimeMs, words });
    return words;
  } catch { return 0; }
}

/** @param {string} id @param {URL} directory @returns {Promise<Book|null>} */
export async function loadBook(id, directory) {
  const book = /** @type {Book|null} */ (await readMetadata(new URL('manifest.json', directory), id));
  if (!(book?.id === id && book.items.length && book.items.every(item => /^[a-z0-9-]+$/.test(item.slug)))) return null;
  // Only the main text counts toward progress: notes, index, copyright and covers are also "appendix" pages.
  const mainText = /** @param {BookPage} item */ item =>
    item.type !== 'appendix' || /^(?:conclusion|epilogue|afterword|appendix(?:-[a-z0-9-]+)?)$/.test(item.slug);
  await Promise.all(book.items.map(async item => {
    item.words = mainText(item) ? await wordsIn(new URL(item.slug + '.html', directory)) : 0;
  }));
  return book;
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
  const excerpt = / \(publisher excerpt\)$/i.test(book.title);
  const title = book.title.replace(/ \(publisher excerpt\)$/i, '');
  // The resume link sits on the cover, so every tile keeps the same height whatever its progress.
  return '<article class="shelf-item" aria-label="' + escape(book.title) + '" data-book="' + escape(book.id) + '" data-state="new">' +
    '<a class="shelf-link" href="' + path + '" data-book-summary>' +
    '<span class="cover">' + libraryCover(path + '/images/', book.cover, title, book.author, eager) +
    (excerpt ? '<span class="cover-badge">Excerpt</span>' : '') +
    '<progress class="cover-progress" max="100" value="0" aria-label="Book reading progress" data-book-progress></progress></span>' +
    '<span class="shelf-copy"><h3 class="shelf-title">' + escape(title) + '</h3>' +
    '<span class="shelf-author">' + escape(book.author) + '</span>' +
    '<span class="shelf-status"><span class="card-status" data-book-status>To read</span>' +
    '<span class="shelf-count"> · ' + count + (count === 1 ? ' chapter' : ' chapters') + '</span></span></span></a>' +
    '<a class="shelf-resume" data-book-resume href="' + path + '/' + escape(start.slug) + '" hidden>Continue reading →</a>' +
    '<div data-book-pages hidden>' + book.items.map(item => bookPageData(item)).join('') + '</div></article>';
}

/**
 * A cover of any shape on a book-shaped plate. A portrait cover fills the plate over a blurred
 * copy of itself; a wide picture becomes the top of a typeset cover with the title and author.
 * @param {string} base @param {string|undefined} file @param {string} title @param {string} author @param {boolean} eager
 */
function libraryCover(base, file, title, author, eager) {
  const typeset = '<span class="cover-type" aria-hidden="true"><span class="cover-type-title">' + escape(title) +
    '</span><span class="cover-type-author">' + escape(author) + '</span></span>';
  const image = libraryImage(base, file, eager);
  if (!image) return typeset;
  return image.replace('class="library-image"', 'class="cover-blur" aria-hidden="true"') +
    image.replace('class="library-image"', 'class="cover-image"') + typeset;
}

export const libraryThumbnail = 'library-v2';

/** @param {string} base @param {string} [file] @param {boolean} [eager] */
export function libraryImage(base, file, eager = false) {
  if (!file || !/^[\w.-]+\.(?:png|jpe?g|webp|avif)$/i.test(file)) return '';
  return '<img class="library-image" src="' + escape(base + file) + '?thumbnail=' + libraryThumbnail +
    '" alt="" decoding="async"' + (eager ? '' : ' loading="lazy"') + '>';
}

/** @param {BookPage} item */
function bookPageData(item) {
  return '<span data-book-page="' + escape(item.slug) + '" data-page-type="' + escape(item.type) + '" data-page-title="' + escape(item.title) + '"' +
    ' data-page-words="' + (item.words ?? 0) + '"></span>';
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
      ' data-page-words="' + (item.words ?? 0) + '" aria-label="' + escape(item.title) + '">' +
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
