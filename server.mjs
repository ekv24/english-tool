import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { hasLookupModel, targetLanguage, translate } from './translation.mjs';
import { libraryDirectory, libraryIds, loadArticle, loadGlossary, originalSource, readOptional } from './library.mjs';
import { escape } from './html.mjs';
import { syncReaderState } from './reader-state.mjs';
import { bookPath, loadBook, loadBooks, libraryBook, libraryImage, bookOverview, bookTrail, bookContentsButton, chapterNav, originalUrl } from './book.mjs';

const webRoot = new URL('./public/', import.meta.url);
const mediaTypes = new Map(Object.entries({
  css: 'text/css', js: 'text/javascript', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', woff2: 'font/woff2',
  svg: 'image/svg+xml', avif: 'image/avif', woff: 'font/woff', txt: 'text/plain', pdf: 'application/pdf',
}));
/** @typedef {{ question:string, answer:string, anchor:string }} Question */

/** @param {string} title @param {string} main @param {string} [script] @param {string} [topLink] @param {string} [head] */
function render(title, main, script = '', topLink = '', head = '') {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escape(title) + ' · English Tool</title><link rel="stylesheet" href="/style.css">' +
    '<link rel="stylesheet" href="/vocabulary.css">' + head +
    '<body data-target-language="' + escape(targetLanguage) + '"><header class="topbar"><a class="brand" href="/">' +
    '<svg class="brand-mark" viewBox="0 0 24 24" width="22" height="23" aria-hidden="true" focusable="false">' +
    '<path d="M12 4v16M4 12h16M6.4 6.4l11.2 11.2m0-11.2L6.4 17.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
    ' English Tool</a>' + topLink + '</header>' +
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
  '<aside id="lookup"' + (hasLookupModel ? ' data-lookup-model' : '') + ' hidden aria-label="Translation"><div class="lookup-head"><strong id="expression" lang="en"></strong>' +
  '<button id="dismiss" type="button" aria-label="Close translation">×</button></div><div id="translation" role="status" lang="' + escape(targetLanguage) + '"></div>' +
  '<small id="translation-source"></small><div id="context" hidden lang="' + escape(targetLanguage) + '"></div><div class="lookup-actions">' +
  '<button id="explain" type="button" aria-controls="context" aria-expanded="false" hidden>In context</button>' +
  '<button type="button" data-save-expression hidden>Save expression</button></div></aside>';

const readingButton = '<button class="mark-read" type="button" data-mark-read hidden>Mark as read</button>';

const figureDialog =
  '<dialog class="book-figure-dialog" id="book-figure-dialog" aria-labelledby="book-figure-title">' +
  '<div class="book-contents-header"><h2 id="book-figure-title">Figure</h2>' +
  '<div class="book-figure-controls"><button type="button" data-figure-size>Zoom in</button>' +
  '<form method="dialog"><button type="submit" aria-label="Close figure" autofocus>×</button></form></div></div>' +
  '<div class="book-figure-comparison">' + ['Reader version', 'Original'].map(label =>
    '<section class="book-figure-panel" aria-label="' + label + '"><header><h3>' + label + '</h3>' +
    '<a target="_blank" rel="noopener noreferrer" aria-label="Open ' + label.toLowerCase() + ' at full size">Full size ↗</a></header>' +
    '<div class="book-figure-view" role="region" aria-label="' + label + ' image" tabindex="0"><img alt=""></div></section>'
  ).join('') + '</div></dialog>';

/** @param {string} text */
function normalizeExpression(text) {
  return text.normalize('NFC').replace(/[’‘]/g, "'").replace(/[‐‑–−]/g, '-');
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL('http://localhost' + (req.url?.startsWith('/') ? req.url : '/'));
  const { pathname } = url;
  /** @param {number} code @param {string} data @param {string} [type] */
  function send(code, data, type = 'text/html') {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }).end(data);
  }
  try {
    if (pathname === '/api/reader-state' && process.env.ENGLISH_TOOL_STATE_DB !== '') {
      return await syncReaderState(req, res);
    }
    if (req.method !== 'GET') return send(405, 'Method not allowed', 'text/plain');
    if (pathname === '/') {
      const [books, ids] = await Promise.all([loadBooks(), libraryIds('articles')]);
      const materials = (await Promise.all(ids.map(async id => {
        const directory = await libraryDirectory('articles', id);
        return directory ? loadArticle(directory, id) : null;
      }))).filter(material => material !== null);
      const cards = materials.map(({ id, title, publisher, kind, date, previewMedia }) =>
        '<a class="card" href="/read/' + escape(id) + '" data-material="' + escape(id) + '">' +
        libraryImage('/read/' + id + '/media/', previewMedia) + '<div class="card-copy">' +
        '<span class="meta">' + escape(publisher ?? 'Reading library') + ' · ' + escape(kind ?? 'Article') + '</span><h2 lang="en">' + escape(title) +
        '</h2><span class="card-date">' + escape(date ?? '') + '</span></div><div class="card-progress">' +
        '<span class="card-status">To read</span><progress max="100" value="0" aria-label="Reading progress"></progress></div></a>').join('');
      return send(200, render('Library', '<main class="library"><h1>Library</h1>' +
        books.map(libraryBook).join('') +
        (cards ? (books.length ? '<h2 class="library-section-heading">Articles</h2>' : '') + '<div class="cards">' + cards + '</div>' : '') +
        (!cards && !books.length ? '<p>Add a prepared article or book to your library.</p>' : '') +
        '</main>', 'library.js', vocabularyLink, books.length ? bookStyle : ''));
    }
    if (pathname === '/vocabulary') {
      return send(200, render('Vocabulary', '<main class="vocabulary reading-column"><div data-vocabulary-home>' +
        '<h1>Vocabulary</h1><p data-word-count></p>' +
        '<section class="review-launch" aria-labelledby="review-title" hidden><div>' +
        '<h2 id="review-title">Review</h2><p data-review-summary role="status"></p></div>' +
        '<button class="review-primary" data-review-start type="button">Start review</button></section>' +
        '<div data-vocabulary></div></div>' +
        '<section class="review-session" aria-labelledby="review-heading" hidden><header class="review-bar">' +
        '<button class="review-quiet" data-review-exit type="button">← Vocabulary</button><span data-review-progress></span>' +
        '</header><div class="review-meter" aria-hidden="true"><span></span></div>' +
        '<div class="review-card"><h1 id="review-heading" data-review-heading tabindex="-1"></h1>' +
        '<p data-review-prompt></p><blockquote data-review-example lang="en" hidden></blockquote>' +
        '<div class="review-feedback" data-review-feedback hidden><p data-review-translation lang="' + escape(targetLanguage) + '"></p>' +
        '<a data-review-source></a></div><div class="review-controls">' +
        '<button class="review-quiet" data-review-hint type="button">Show context</button>' +
        '<button class="review-primary" data-review-reveal type="button">Show answer</button>' +
        '<button class="review-secondary" data-review-again type="button" hidden>Again</button>' +
        '<button class="review-primary" data-review-remembered type="button" hidden>Remembered</button>' +
        '<button class="review-primary" data-review-more type="button" hidden>Review more</button>' +
        '</div></div><p class="review-status" role="status" data-review-status></p></section>' +
        '</main>', 'vocabulary.js', '<a class="topbar-link" href="/">Library</a>'));
    }
    const bookMatch = pathname.match(/^\/books\/([a-z0-9-]+)(?:\/(.+))?$/);
    if (bookMatch) {
      const [, id, part] = bookMatch;
      const path = bookPath(id);
      const dir = await libraryDirectory('books', id);
      const book = dir ? await loadBook(id, dir) : null;
      if (!book || !dir) return send(404, render('Book not found', '<main class="library"><h1>This book hasn’t been prepared yet</h1><a href="/">Back to library</a></main>'));
      if (/^(?:images|figures)\/[\w.-]+\.(?:png|jpe?g|webp|svg)$/i.test(part ?? '') ||
        /^mathjax\/es5\/(?:tex-mml-chtml\.js|output\/chtml\/fonts\/woff-v2\/[\w-]+\.woff)$/.test(part ?? '')) {
        return await fileResponse(new URL(part, dir), part);
      }
      if (part === 'lookup') return await lookup(dir, book, 'Book glossary');
      if (part === 'original.pdf' && book.source === path + '/original.pdf') {
        return await fileResponse(new URL('original.pdf', dir), part);
      }
      if (!part) {
        const source = book.source === path + '/original.pdf' ? book.source : originalUrl(book, book.items[0]);
        return send(200, render(book.title, bookOverview(book), 'book.js', originalLink(source), bookStyle));
      }
      const item = book.items.find(item => part === item.slug);
      if (!item) return send(404, render('Page not found', '<main class="library"><h1>Page not found</h1><a href="' + path + '">Book contents</a></main>'));
      const [body, rawQuiz] = await Promise.all([
        readOptional(new URL(item.slug + '.html', dir)),
        readOptional(new URL('quizzes.json', dir)),
      ]);
      if (!body) return send(404, 'Page not found', 'text/plain');
      const quiz = /** @type {Record<string,Question[]>} */ (rawQuiz ? JSON.parse(rawQuiz) : {});
      const questions = quiz[item.slug] ?? quiz[item.original.replace(/\.html$/, '')] ?? [];
      return send(200, render(item.title,
        '<main class="reader book-reader" data-book="' + id + '" data-id="' + id + '/' + escape(item.slug) + '" data-lookup="' + path + '/lookup">' +
        readerRail(path, 'Book', 'On this page') + '<div class="reading-column">' + bookTrail(book, item) +
        '<article class="book-article article-content" id="article" lang="en">' + body + '</article><section class="end">' +
        readingButton + renderQuiz(questions, item.type === 'appendix' ? 'Review questions' : 'Chapter quiz') + chapterNav(book, item) +
        '</section></div>' + figureDialog + translationPopover +
        (questions.length ? '<button class="quiz-return" type="button" data-quiz-return hidden>← Back to quiz</button>' : '') +
        '</main>', 'book-reader.js',
        originalLink(originalUrl(book, item), bookContentsButton()), bookStyle + (book.math ? bookMath(path) : '')));
    }
    const match = pathname.match(/^\/read\/([a-z0-9-]+)(?:\/(media\/[\w.-]+|lookup|original\.pdf))?$/);
    if (match) {
      const [, id, part] = match;
      const path = '/read/' + id;
      const dir = await libraryDirectory('articles', id);
      const material = dir ? await loadArticle(dir, id) : null;
      const missing = '<main class="library"><h1>This article hasn’t been prepared yet</h1><a href="/">Back to library</a></main>';
      if (!dir || !material) return send(404, render('Article not found', missing));
      if (part === 'lookup') return await lookup(dir, material, 'Article glossary');
      if (part === 'original.pdf' && material.source !== path + '/original.pdf') return send(404, 'Not found', 'text/plain');
      if (part) return await fileResponse(new URL(part, dir), part);
      const [body, quiz] = await Promise.all([
        readOptional(new URL('article.html', dir)), readOptional(new URL('quiz.json', dir)),
      ]);
      if (!body) return send(404, render('Article not found', missing));
      const questions = /** @type {Question[]} */ (quiz ? JSON.parse(quiz) : []);
      return send(200, render(material.title,
        '<main class="reader" data-id="' + escape(id) + '">' + readerRail('/', 'Library', 'Contents') +
        '<div class="reading-column"><article id="article" lang="en"><header class="article-header"><p class="meta">' +
        [material.publisher, material.date].filter(Boolean).map(value => escape(value ?? '')).join(' · ') + '</p><h1>' + escape(material.title) + '</h1></header>' +
        body + '</article><section class="end">' +
        readingButton + renderQuiz(questions, 'Article quiz') + '<a href="/">← Back to library</a></section></div>' +
        translationPopover + '</main>', 'reader.js', originalLink(originalSource(material.source, path + '/original.pdf'))));
    }
    if (/^\/(?:style\.css|book(?:-search)?\.css|vocabulary\.css|(?:reader|reader-records|sync|library|progress|book|book-math|book-reader|book-search|vocabulary|vocabulary-review)\.js|fonts\/[a-z-]+\.woff2)$/.test(pathname)) {
      return await fileResponse(new URL(pathname.slice(1), webRoot), pathname);
    }
    send(404, 'Not found', 'text/plain');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ERR_STREAM_PREMATURE_CLOSE' && res.destroyed) return;
    console.error(error);
    if (!res.headersSent) send(503, 'Temporarily unavailable', 'text/plain');
    else res.destroy();
  }

  /** @param {URL} dir @param {{glossaryLanguage?:string}} material @param {string} label */
  async function lookup(dir, material, label) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Forbidden', 'text/plain');
    const text = url.searchParams.get('text')?.trim().replace(/\s+/g, ' ') ?? '';
    const sentence = url.searchParams.get('sentence')?.trim() ?? '';
    if (!text || text.length > 320 || sentence.length > 1000) return send(400, 'Invalid selection', 'text/plain');
    const glossary = await loadGlossary(dir, material, targetLanguage);
    const normalized = normalizeExpression(text);
    const term = glossary.get(normalized) ?? glossary.get(normalized.toLowerCase());
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
    return send(200, JSON.stringify(result), 'application/json');
  }

  /** @param {URL} file @param {string} path */
  async function fileResponse(file, path) {
    const type = mediaTypes.get(path.split('.').at(-1) ?? '');
    if (!type) return send(404, 'Not found', 'text/plain');
    const info = await stat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info?.isFile()) return send(404, 'Not found', 'text/plain');
    const size = info.size;
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    const partial = range && Boolean(range[1] || range[2]);
    const start = partial ? (range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))) : 0;
    const end = partial && range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (partial && (start > end || start >= size)) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
      return;
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
/** @param {string} href @param {string} back @param {string} outline */
function readerRail(href, back, outline) {
  return '<div class="reader-rail"><a class="back" href="' + href + '">← ' + back + '</a>' +
    '<details id="outline"><summary class="contents-label">' + outline + '</summary><nav id="contents" aria-label="' + outline + '"></nav></details></div>';
}

server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log('http://127.0.0.1:' + address.port);
});
