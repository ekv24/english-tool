import { createServer } from 'node:http';
import { hash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import sharp from 'sharp';
import { hasContextModel, hasLookupModel, matchCase, targetLanguage, translate, translateInContext, warmSentenceModel, warmTranslation } from './translation.mjs';
import { assets, versionPage } from './assets.mjs';
import { libraryDirectory, loadArticle, loadArticles, loadGlossary, originalFile, originalSource, readOptional, readQuiz, wordsIn } from './library.mjs';
import { escape, feedbackCard } from './html.mjs';
import { syncReaderState } from './reader-state.mjs';
import { bookLicense, bookOriginal, bookPath, loadBook, loadBooks, libraryBook, libraryImage, libraryThumbnail, bookOverview, bookTrail, bookContentsButton, chapterNav, originalUrl } from './book.mjs';

const mediaTypes = new Map(Object.entries({
  css: 'text/css', js: 'text/javascript', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', woff2: 'font/woff2',
  svg: 'image/svg+xml', avif: 'image/avif', woff: 'font/woff', txt: 'text/plain', pdf: 'application/pdf',
  epub: 'application/epub+zip',
}));
const compressible = new Set(['text/css', 'text/javascript', 'image/svg+xml']);
// Figures, covers and the bundled MathJax rarely change: reuse them for an hour, then refresh in the background.
const mediaCache = 'private, max-age=3600, stale-while-revalidate=604800';
const thumbnailTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const maxCompressionBytes = 4 * 1024 * 1024;
const gzipBody = promisify(gzip);
const brotliBody = promisify(brotliCompress);
/** @type {Map<string, Promise<Buffer>>} */
const transfers = new Map();

/** @param {string} key @param {() => Promise<Buffer>} build */
function cachedTransfer(key, build) {
  const entry = transfers.get(key);
  if (entry) {
    transfers.delete(key);
    transfers.set(key, entry);
    return entry;
  }
  const result = build().catch(error => {
    if (transfers.get(key) === result) transfers.delete(key);
    throw error;
  });
  transfers.set(key, result);
  if (transfers.size > 48) {
    const oldest = transfers.keys().next().value;
    if (oldest !== undefined) transfers.delete(oldest);
  }
  return result;
}

/** @param {string|undefined} header */
function contentEncoding(header) {
  const weights = new Map(header?.toLowerCase().split(',').map(value => {
    const [coding, quality] = value.trim().split(/\s*;\s*/);
    const weight = quality === undefined ? 1 : Number(quality.match(/^q\s*=\s*([01](?:\.\d{0,3})?)$/)?.[1]);
    return [coding, weight >= 0 && weight <= 1 ? weight : 0];
  }));
  const wildcard = weights.get('*') ?? 0;
  const br = weights.get('br') ?? wildcard;
  const gz = weights.get('gzip') ?? wildcard;
  const preferred = Math.max(br, gz);
  if (!preferred || preferred < (weights.get('identity') ?? 0)) return null;
  return br >= gz ? 'br' : 'gzip';
}

/** @param {Buffer} data @param {'br'|'gzip'} encoding */
function encode(data, encoding) {
  return encoding === 'br'
    ? brotliBody(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
    : gzipBody(data, { level: 4 });
}

/** @typedef {{ question:string, answer:string, anchor:string }} Question */

// Chromium-based browsers fetch a page when the pointer rests on its link or the finger touches it,
// so moving between the library, a book and its chapters feels immediate. Others ignore the header.
const speculationRules = JSON.stringify({
  prefetch: [{
    source: 'document',
    where: { and: [
      { href_matches: '/*' },
      { not: { href_matches: '/api/*' } },
      { not: { href_matches: '/*.(pdf|epub)' } },
      { not: { href_matches: '/books/*/license' } },
      { not: { selector_matches: '[target=_blank], [download]' } },
    ] },
    eagerness: 'moderate',
  }],
});

// Runs before the first paint so a saved theme never flashes the other palette.
const themeScript = "(()=>{const d=document.documentElement,k='english-tool-theme';try{const t=localStorage.getItem(k);" +
  "if(t==='light'||t==='dark')d.dataset.theme=t}catch{}addEventListener('click',e=>{" +
  "if(!(e.target instanceof Element)||!e.target.closest('[data-theme-toggle]'))return;" +
  "const n=getComputedStyle(d).colorScheme==='dark'?'light':'dark';d.dataset.theme=n;" +
  "try{localStorage.setItem(k,n)}catch{}})})()";
const themeHash = "'sha256-" + hash('sha256', themeScript, 'base64') + "'";
const themeToggle = '<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' +
  '<svg class="theme-icon-dark" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.2 12.6A6.6 6.6 0 0 1 7.4 3.8a6.6 6.6 0 1 0 8.8 8.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
  '<svg class="theme-icon-light" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.2v1.6M10 16.2v1.6M2.2 10h1.6M16.2 10h1.6M4.5 4.5l1.1 1.1M14.4 14.4l1.1 1.1M4.5 15.5l1.1-1.1M14.4 5.6l1.1-1.1"/></g></svg></button>';

/** @param {string} title @param {string} main @param {string} [script] @param {string} [topLink] @param {string} [head] */
function render(title, main, script = '', topLink = '', head = '') {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f4ecdc" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#262624" media="(prefers-color-scheme: dark)"><script>' + themeScript + '</script>' +
    '<title>' + escape(title) + ' · English Tool</title><link rel="stylesheet" href="/style.css">' +
    '<link rel="stylesheet" href="/vocabulary.css">' + head +
    '<body data-target-language="' + escape(targetLanguage) + '"><header class="topbar"><a class="brand" href="/">' +
    '<svg class="brand-mark" viewBox="0 0 24 24" width="22" height="23" aria-hidden="true" focusable="false">' +
    '<path d="M12 4v16M4 12h16M6.4 6.4l11.2 11.2m0-11.2L6.4 17.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
    ' English Tool</a><div class="topbar-end">' + topLink + themeToggle + '</div></header>' +
    main + (script ? '<script type="module" src="/' + script + '"></script>' : '') + '</html>';
}

const bookStyle = '<link rel="stylesheet" href="/book.css"><link rel="stylesheet" href="/book-search.css">';
/** @param {string} path */
function bookMath(path) {
  return '<script src="/book-math.js" defer></script><script src="' + path + '/mathjax/es5/tex-mml-chtml.js" defer></script>';
}
const vocabularyLink = '<a class="topbar-link" href="/vocabulary">Vocabulary</a>';

/** @param {string} source @param {string} [contents] */
function originalLink(source, contents = '') {
  return '<nav class="topbar-actions" aria-label="Reader">' + contents + vocabularyLink +
    (source ? '<a class="original" href="' + escape(source) + '" target="_blank" rel="noopener noreferrer">Original ↗</a>' : '') + '</nav>';
}

/** @param {Question[]} questions @param {string} label */
function renderQuiz(questions, label) {
  if (!questions.length) return '';
  return '<details id="quiz"><summary>' + label + '</summary>' + questions.map(({ question, answer, anchor }, i) =>
    '<section class="question"><h3>' + escape(question) + '</h3><label for="answer-' + i + '">Your answer</label>' +
    '<textarea id="answer-' + i + '" rows="3"></textarea><button type="button" class="reveal" disabled>Check answer</button>' +
    '<div class="expected" hidden><p>' + escape(answer) + '</p><a href="#' + escape(anchor) + '">Go to the passage ↗</a></div></section>'
  ).join('') + '</details>';
}

const translationPopover =
  '<aside id="lookup"' + (hasLookupModel ? ' data-lookup-model' : '') + (hasContextModel ? ' data-context-model' : '') + ' hidden aria-label="Translation"><div class="lookup-head"><div class="lookup-phrase">' +
  '<button class="extend" id="extend-before" type="button" hidden></button><strong id="expression" lang="en"></strong>' +
  '<button class="extend" id="extend-after" type="button" hidden></button></div>' +
  '<button id="dismiss" type="button" aria-label="Close translation">×</button></div><div id="translation" role="status" lang="' + escape(targetLanguage) + '"></div>' +
  '<small id="translation-source"></small><p id="saved-note" hidden></p><div id="context" hidden lang="' + escape(targetLanguage) + '"></div><div class="lookup-actions">' +
  '<button id="explain" type="button" aria-controls="context" aria-expanded="false" hidden>In context</button>' +
  '<button id="edit-translation" type="button" aria-label="Edit translation before saving" hidden>Edit</button>' +
  '<button type="button" data-save-expression hidden>Save expression</button></div></aside>';

const readingButton = '<div class="reading-status" id="reading-status" tabindex="-1">' +
  '<button class="mark-read" type="button" data-mark-read hidden>' +
  '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<circle cx="10" cy="10" r="8"></circle><path d="m6.25 10 2.5 2.5 5-5" pathLength="12" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
  '<span data-mark-read-label>Mark as read</span></button><span class="reading-status-label" role="status"></span></div>';

/** @param {string} [sourceLabel] */
function figureDialog(sourceLabel = 'Original') {
  return '<dialog class="book-figure-dialog" id="book-figure-dialog" aria-labelledby="book-figure-title">' +
  '<div class="book-contents-header"><h2 id="book-figure-title">Figure</h2>' +
  '<div class="book-figure-controls"><button type="button" data-figure-size>Zoom in</button>' +
  '<form method="dialog"><button type="submit" aria-label="Close figure" autofocus>×</button></form></div></div>' +
  '<div class="book-figure-comparison">' + ['Reader version', sourceLabel].map(label =>
    '<section class="book-figure-panel" aria-label="' + label + '"><header><h3>' + label + '</h3>' +
    '<a target="_blank" rel="noopener noreferrer" aria-label="Open ' + label.toLowerCase() + ' at full size">Full size ↗</a></header>' +
    '<div class="book-figure-view" role="region" aria-label="' + label + ' image" tabindex="0"><img alt=""></div></section>'
  ).join('') + '</div></dialog>';
}

/** @param {string} text */
function normalizeExpression(text) {
  return text.normalize('NFC').replace(/[’‘]/g, "'").replace(/[‐‑–−]/g, '-');
}

/** @param {string} extraScripts */
function policy(extraScripts) {
  return "default-src 'self'; script-src 'self' " + themeHash + extraScripts + "; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', policy(''));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL('http://localhost' + (req.url?.startsWith('/') ? req.url : '/'));
  const { pathname } = url;
  /** @param {number} code @param {string} data @param {string} [type] */
  function send(code, data, type = 'text/html') {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }).end(data);
  }
  try {
    if (pathname === '/api/reader-state' && process.env.ENGLISH_TOOL_STATE_DB !== '') {
      return await syncReaderState(req, res, sendJson);
    }
    if (req.method !== 'GET') return send(405, 'Method not allowed', 'text/plain');
    if (pathname === '/speculation-rules.json') {
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return send(200, speculationRules, 'application/speculationrules+json');
    }
    if (pathname === '/api/library') {
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Forbidden', 'text/plain');
      return await sendJson(JSON.stringify(await libraryCatalog()));
    }
    if (pathname === '/') {
      const [books, materials] = await Promise.all([loadBooks(), loadArticles()]);
      const cards = materials.map(({ id, title, publisher, kind, date, previewMedia }) =>
        '<a class="card article-tile" href="/read/' + escape(id) + '" data-material="' + escape(id) + '" data-state="new">' +
        '<span class="article-thumb">' + (libraryImage('/read/' + id + '/media/', previewMedia) ||
          '<span class="article-thumb-type" aria-hidden="true">' + escape(publisher ?? kind ?? 'Article') + '</span>') + '</span>' +
        '<span class="card-copy"><span class="meta">' + escape(publisher ?? kind ?? 'Article') + (date ? ' · ' + escape(date) : '') + '</span>' +
        '<h3 lang="en">' + escape(title) + '</h3></span>' +
        '<span class="card-progress"><span class="card-status">To read</span>' +
        '<progress max="100" value="0" aria-label="Reading progress"></progress></span></a>').join('');
      const count = /** @param {number} n @param {string} one */ (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
      const summary = [books.length ? count(books.length, 'book') : '', materials.length ? count(materials.length, 'article') : '']
        .filter(Boolean).join(' · ');
      return await sendPage(render('Library', '<main class="library">' +
        '<header class="library-head"><div><h1>Library</h1><p class="library-summary">' + summary + '</p></div>' +
        '<a class="library-words" href="/vocabulary" data-library-words hidden></a></header>' +
        '<section class="library-continue" aria-labelledby="continue-heading" data-continue hidden>' +
        '<h2 class="library-label" id="continue-heading">Continue reading</h2><div class="continue-list" data-continue-list></div></section>' +
        '<section class="library-suggestions" aria-labelledby="suggestions-heading" data-suggestions hidden>' +
        '<h2 class="library-label" id="suggestions-heading">For you</h2><div class="suggestion-list" data-suggestion-list></div></section>' +
        (books.length ? '<section class="library-section" aria-labelledby="books-heading"><h2 class="library-label" id="books-heading">Books</h2>' +
          '<div class="shelf">' + books.map((book, index) => libraryBook(book, index < 6)).join('') + '</div></section>' : '') +
        (cards ? '<section class="library-section" aria-labelledby="articles-heading"><h2 class="library-label" id="articles-heading">Articles</h2>' +
          '<div class="article-grid">' + cards + '</div></section>' : '') +
        (!cards && !books.length ? '<p>Add a prepared article or book to your library.</p>' : '') +
        '</main>', 'library.js', vocabularyLink, books.length ? bookStyle : ''));
    }
    if (pathname === '/vocabulary') {
      return await sendPage(render('Vocabulary', '<main class="vocabulary reading-column"><div data-vocabulary-home>' +
        '<h1>Vocabulary</h1><p data-word-count></p>' +
        '<section class="review-launch" aria-label="Vocabulary review" hidden>' +
        '<p data-review-summary role="status"></p>' +
        '<button class="review-primary" data-review-start type="button">Start review</button></section>' +
        '<div data-vocabulary></div></div>' +
        '<section class="review-session" aria-label="Vocabulary review" hidden><header class="review-bar">' +
        '<button class="review-quiet" data-review-exit type="button">← Vocabulary</button>' +
        '<div class="review-progress" data-review-progress hidden><span aria-hidden="true"></span>' +
        '<progress aria-label="Review progress" max="1" value="0"></progress></div>' +
        '</header><div class="review-card"><div class="review-content">' +
        '<h1 id="review-heading" data-review-heading tabindex="-1"></h1>' +
        '<p data-review-summary-line hidden></p>' +
        '<p class="review-translation" data-review-translation lang="' + escape(targetLanguage) + '" tabindex="-1" hidden></p>' +
        '<blockquote data-review-example lang="en" tabindex="-1" hidden></blockquote>' +
        '</div><div class="review-controls">' +
        '<button class="review-primary" data-review-reveal type="button" aria-keyshortcuts="Space" hidden>Show answer<kbd aria-hidden="true">Space</kbd></button>' +
        '<button class="review-secondary" data-review-again type="button" aria-keyshortcuts="1" hidden>Again<kbd aria-hidden="true">1</kbd></button>' +
        '<button class="review-primary" data-review-remembered type="button" aria-keyshortcuts="2" hidden>Remembered<kbd aria-hidden="true">2</kbd></button>' +
        '<button class="review-primary" data-review-more type="button" hidden>Review more</button>' +
        '</div><div class="review-tools" data-review-tools hidden>' +
        '<button class="review-quiet" data-review-hint type="button" hidden>Show context</button>' +
        '<a data-review-source hidden>Source passage</a>' +
        '<button class="review-quiet" data-review-exclude type="button">Exclude from review</button>' +
        '</div></div><p class="review-status" role="status" data-review-status></p></section>' +
        '</main>', 'vocabulary.js', '<a class="topbar-link" href="/">Library</a>'));
    }
    const bookMatch = pathname.match(/^\/books\/([a-z0-9-]+)(?:\/(.+))?$/);
    if (bookMatch) {
      const [, id, part] = bookMatch;
      const path = bookPath(id);
      const dir = await libraryDirectory('books', id);
      if (!dir) return send(404, render('Book not found', '<main class="library"><h1>This book hasn’t been prepared yet</h1><a href="/">Back to library</a></main>'));
      if (/^(?:images|figures)\/[\w.-]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(part ?? '') ||
        /^mathjax\/es5\/(?:tex-mml-chtml\.js|output\/chtml\/fonts\/woff-v2\/[\w-]+\.woff)$/.test(part ?? '')) {
        return await fileResponse(new URL(part, dir), part, part.startsWith('images/'));
      }
      const book = await loadBook(id, dir);
      if (!book) return send(404, render('Book not found', '<main class="library"><h1>This book hasn’t been prepared yet</h1><a href="/">Back to library</a></main>'));
      const license = bookLicense(book);
      if (part === 'license' && license) return await fileResponse(new URL(license, dir), 'license.txt');
      if (part === 'lookup') return await lookup(dir, book, 'Book glossary');
      if (part === bookOriginal(book) && book.source === path + '/' + part) {
        if (part === 'original.epub') res.setHeader('Content-Disposition', 'attachment; filename="' + id + '.epub"');
        return await fileResponse(await originalFile(dir, id, part), part);
      }
      if (!part) {
        const source = book.source === path + '/original.pdf' ? book.source : originalUrl(book, book.items[0]);
        return await sendPage(render(book.title, bookOverview(book), 'book.js', originalLink(source), bookStyle));
      }
      const item = book.items.find(item => part === item.slug);
      if (!item) return send(404, render('Page not found', '<main class="library"><h1>Page not found</h1><a href="' + path + '">Book contents</a></main>'));
      const [body, rawQuiz] = await Promise.all([
        readOptional(new URL(item.slug + '.html', dir)),
        readQuiz(dir, id, 'books'),
      ]);
      if (!body) return send(404, 'Page not found', 'text/plain');
      const quiz = /** @type {Record<string,Question[]>} */ (rawQuiz ? JSON.parse(rawQuiz) : {});
      const questions = quiz[item.slug] ?? quiz[item.original.replace(/\.html$/, '')] ?? [];
      warmSentenceModel();
      return await sendPage(render(item.title,
        '<main class="reader book-reader" data-book="' + id + '" data-id="' + id + '/' + escape(item.slug) + '" data-lookup="' + path + '/lookup">' +
        readerRail(path, 'Book', 'On this page') + '<div class="reading-column">' + bookTrail(book, item) +
        '<article class="book-article article-content" id="article" lang="en">' + deferImages(body) + '</article><section class="end">' +
        readingButton + renderQuiz(questions, item.type === 'appendix' ? 'Review questions' : 'Chapter quiz') + feedbackCard(book.id) + chapterNav(book, item) +
        '</section></div>' + figureDialog() + translationPopover +
        (questions.length ? '<button class="quiz-return" type="button" data-quiz-return hidden>← Back to quiz</button>' : '') +
        '</main>', 'book-reader.js',
        originalLink(originalUrl(book, item), bookContentsButton()), bookStyle + (book.math && /\bclass="(?:[^"]*\s)?math[\s"]/.test(body) ? bookMath(path) : '')));
    }
    const match = pathname.match(/^\/read\/([a-z0-9-]+)(?:\/(media\/[\w.-]+|lookup|original\.pdf))?$/);
    if (match) {
      const [, id, part] = match;
      const path = '/read/' + id;
      const dir = await libraryDirectory('articles', id);
      const material = dir ? await loadArticle(dir, id) : null;
      const missing = '<main class="library"><h1>This article hasn’t been prepared yet</h1><a href="/">Back to library</a></main>';
      if (!dir || !material) return send(404, render('Article not found', missing));
      const pdf = material.format === 'pdf';
      if (part === 'lookup') return await lookup(dir, material, 'Article glossary');
      if (part === 'original.pdf') {
        if (!pdf && material.source !== path + '/original.pdf') return send(404, 'Not found', 'text/plain');
        return await fileResponse(await originalFile(dir, id, part), part);
      }
      if (part) return await fileResponse(new URL(part, dir), part, true);
      const [body, quiz] = await Promise.all([readOptional(new URL('article.html', dir)), readQuiz(dir, id, 'articles')]);
      if (!body) return send(404, render('Article not found', missing));
      const questions = /** @type {Question[]} */ (quiz ? JSON.parse(quiz) : []);
      const compareFigures = pdf || material.compareFigures === true;
      const original = pdf ? path + '/original.pdf' + (material.sourcePage ? '#page=' + material.sourcePage : '')
        : originalSource(material.source, path + '/original.pdf');
      warmSentenceModel();
      return await sendPage(render(material.title,
        '<main class="reader" data-id="' + escape(id) + '"' + (compareFigures ? ' data-figure-originals="' + path + '/media/"' : '') + '>' + readerRail('/', 'Library', 'Contents') +
        '<div class="reading-column"><article id="article" lang="en"><header class="article-header"><p class="meta">' +
        [material.publisher, material.date].filter(Boolean).map(value => escape(value ?? '')).join(' · ') + '</p><h1>' + escape(material.title) + '</h1></header>' +
        deferImages(body) + '</article><section class="end">' +
        readingButton + renderQuiz(questions, 'Article quiz') + feedbackCard(id) + '<a href="/">← Back to library</a></section></div>' +
        (compareFigures ? figureDialog(pdf ? 'Original' : 'Source rendering') : '') + translationPopover + '</main>', compareFigures ? 'book-reader.js' : 'reader.js',
        originalLink(original), compareFigures ? bookStyle : ''));
    }
    if (/^\/(?:style\.css|book(?:-search)?\.css|vocabulary\.css|(?:reader|reader-records|sync|library|progress|book|book-math|book-reader|book-search|vocabulary|vocabulary-review|feedback|activity)\.js|fonts\/[a-z-]+\.woff2)$/.test(pathname)) {
      return await assetResponse(pathname.slice(1));
    }
    send(404, 'Not found', 'text/plain');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ERR_STREAM_PREMATURE_CLOSE' && res.destroyed) return;
    console.error(error);
    if (res.headersSent) return res.destroy();
    res.setHeader('Cache-Control', 'private, no-store');
    res.removeHeader('ETag');
    send(503, 'Temporarily unavailable', 'text/plain');
  }

  /** @param {string} data */
  async function sendPage(data) {
    const found = await assets();
    res.setHeader('Content-Security-Policy', policy(' ' + found.importMapHash));
    res.setHeader('Speculation-Rules', '"/speculation-rules.json"');
    const content = Buffer.from(versionPage(data, found));
    const tag = 'W/"' + hash('sha256', content, 'base64url') + '"';
    const encoding = negotiateEncoding(content.length);
    if (revalidate(tag)) return;
    const body = encoding ? await cachedTransfer(encoding + tag, () => encode(content, encoding)) : content;
    finishTransfer(body, 'text/html; charset=utf-8', encoding);
  }

  /** @param {string} json */
  async function sendJson(json) {
    const content = Buffer.from(json);
    const encoding = negotiateEncoding(content.length);
    finishTransfer(encoding ? await encode(content, encoding) : content, 'application/json; charset=utf-8', encoding);
  }

  /** @param {number} size */
  function negotiateEncoding(size) {
    if (size < 1024 || size > maxCompressionBytes) return null;
    res.setHeader('Vary', 'Accept-Encoding');
    return contentEncoding(req.headers['accept-encoding']);
  }

  /** @param {string} tag @param {string} [cache] */
  function revalidate(tag, cache = 'private, no-cache') {
    res.setHeader('Cache-Control', cache);
    res.setHeader('ETag', tag);
    const conditional = req.headers['if-none-match']?.trim();
    if (conditional !== '*' && !conditional?.match(/"[^"]*"/g)?.includes(tag.slice(2))) return false;
    res.writeHead(304).end();
    return true;
  }

  /** @param {Buffer} body @param {string} type @param {'br'|'gzip'|null} [encoding] */
  function finishTransfer(body, type, encoding = null) {
    if (encoding) res.setHeader('Content-Encoding', encoding);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }).end(body);
  }

  /** @param {URL} dir @param {{id?:string,glossaryLanguage?:string}} material @param {string} label */
  async function lookup(dir, material, label) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Forbidden', 'text/plain');
    const text = url.searchParams.get('text')?.trim().replace(/\s+/g, ' ') ?? '';
    const sentence = url.searchParams.get('sentence')?.trim() ?? '';
    if (!text || text.length > 320 || sentence.length > 1000) return send(400, 'Invalid selection', 'text/plain');
    const glossary = await loadGlossary(dir, material, targetLanguage);
    warmSentenceModel();
    const normalized = normalizeExpression(text);
    const term = glossary.get(normalized) ?? glossary.get(normalized.toLowerCase());
    if (url.searchParams.has('refine')) {
      // A second, slower answer: the expression translated inside its sentence.
      if (term || !sentence || sentence.toLowerCase() === text.toLowerCase() || text.split(' ').length > 6) {
        return send(422, 'Nothing to refine', 'text/plain');
      }
      const refined = await translateInContext(text, sentence, glossary).catch(() => null);
      if (!refined) return send(422, 'No translation in context', 'text/plain');
      return send(200, JSON.stringify({ text: refined, source: 'In context' }), 'application/json');
    }
    if (url.searchParams.has('context')) {
      let translatedSentence = '';
      if (hasLookupModel && sentence && sentence.toLowerCase() !== text.toLowerCase()) {
        try { translatedSentence = (await translate(sentence, glossary, true)).text; }
        catch (error) { if (!term) throw error; }
      }
      const context = [term?.[1], translatedSentence].filter(Boolean).join('\n\n');
      if (!context) return send(422, 'No surrounding sentence', 'text/plain');
      return send(200, JSON.stringify({ text: context, source: term ? label : 'Sentence translation' }), 'application/json');
    }
    if (!term && !hasLookupModel) return send(422, 'No glossary entry for this selection. Configure a lookup model to look up more expressions.', 'text/plain');
    const result = term ? { text: term[0], source: label } : await translate(text, glossary);
    if (!term) result.text = matchCase(text, result.text);
    return send(200, JSON.stringify(result), 'application/json');
  }

  /** @param {string} name */
  async function assetResponse(name) {
    const found = await assets();
    const body = found.bodies.get(name);
    const type = mediaTypes.get(name.split('.').at(-1) ?? '');
    if (!body || !type) return send(404, 'Not found', 'text/plain');
    const current = found.versions.get(name);
    if (revalidate('W/"' + current + '"')) return;
    // A versioned URL never changes its content, so the browser can skip revalidation.
    if (url.searchParams.get('v') === current) res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    const encoding = compressible.has(type) ? negotiateEncoding(body.length) : null;
    const data = encoding ? await cachedTransfer(encoding + current, () => encode(body, encoding)) : body;
    finishTransfer(data, type, encoding);
  }

  /** @param {URL} file @param {string} path @param {boolean} [libraryMedia] */
  async function fileResponse(file, path, libraryMedia = false) {
    const type = mediaTypes.get(path.split('.').at(-1)?.toLowerCase() ?? '');
    if (!type) return send(404, 'Not found', 'text/plain');
    const info = await stat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info?.isFile()) return send(404, 'Not found', 'text/plain');
    const size = info.size;
    const statTag = hash('sha256', [info.dev, info.ino, size, info.mtimeMs, info.ctimeMs].join(':'), 'base64url');
    const cache = /^(?:image|font|video)\/|^text\/javascript$/.test(type) ? mediaCache : undefined;
    if (libraryMedia && thumbnailTypes.has(type) && url.searchParams.get('thumbnail') === libraryThumbnail) {
      const tag = 'W/"' + libraryThumbnail + '-' + statTag + '"';
      if (revalidate(tag, cache)) return;
      const thumbnail = await cachedTransfer(tag, () => sharp(fileURLToPath(file), { limitInputPixels: 32 * 1024 * 1024 })
        .autoOrient().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer())
        .catch(() => null);
      if (thumbnail) return finishTransfer(thumbnail, 'image/webp');
      res.removeHeader('ETag');
      res.setHeader('Cache-Control', 'private, no-store');
    }
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    const partial = range && Boolean(range[1] || range[2]);
    const start = partial ? (range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))) : 0;
    const end = partial && range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (partial && (start > end || start >= size)) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
      return;
    }
    if (!partial && type !== 'application/pdf' && type !== 'application/epub+zip' && type !== 'text/plain') {
      const tag = 'W/"' + statTag + '"';
      const encoding = compressible.has(type) ? negotiateEncoding(size) : null;
      if (revalidate(tag, cache)) return;
      if (encoding) {
        const body = await cachedTransfer(encoding + tag, async () => encode(await readFile(file), encoding));
        return finishTransfer(body, type, encoding);
      }
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', Math.max(0, end - start + 1));
    if (partial) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    res.writeHead(partial ? 206 : 200);
    if (!size) return res.end();
    await pipeline(createReadStream(file, { start, end }), res);
  }
});
/** @param {string} body */
function deferImages(body) {
  return body.replace(/<img\b[^>]*>/gi, tag => {
    if (!/\swidth="[1-9]\d*"/i.test(tag) || !/\sheight="[1-9]\d*"/i.test(tag)) return tag;
    const loading = /\sloading\s*=/i.test(tag) ? '' : ' loading="lazy"';
    const decoding = /\sdecoding\s*=/i.test(tag) ? '' : ' decoding="async"';
    return '<img' + loading + decoding + tag.slice(4);
  });
}

/** What agents need to know about the library: titles, sources and lengths, without any reader data. */
async function libraryCatalog() {
  const [books, articles] = await Promise.all([loadBooks(), loadArticles()]);
  return {
    articles: await Promise.all(articles.map(async ({ id, title, publisher, kind, date, source }) => {
      const directory = await libraryDirectory('articles', id);
      return { id, title, publisher, kind, date, source, words: directory ? await wordsIn(new URL('article.html', directory)) : 0 };
    })),
    books: books.map(({ id, title, author, description, source, items }) => ({
      id, title, author, description, source,
      pages: items.map(({ slug, title, type, words }) => ({ slug, title, type, words })),
    })),
  };
}

/** @param {string} href @param {string} back @param {string} outline */
function readerRail(href, back, outline) {
  return '<div class="reader-rail"><a class="back" href="' + href + '">← ' + back + '</a>' +
    '<details id="outline"><summary class="contents-label">' + outline + '</summary><nav id="contents" aria-label="' + outline + '"></nav></details></div>';
}

server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log('http://127.0.0.1:' + address.port);
  // Load the word model in the background so the first lookup after a restart is fast.
  if (process.env.ENGLISH_TOOL_WARM_MODELS !== '0') warmTranslation();
});
