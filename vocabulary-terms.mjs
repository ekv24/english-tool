import { parseFragment } from 'parse5';
import wink from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import { loadBooks } from './book.mjs';
import { libraryDirectory, libraryIds, loadArticle, loadGlossary, readOptional } from './library.mjs';
import { targetLanguage } from './translation.mjs';

/** @typedef {import('./public/reader-records.js').SavedExpression} SavedExpression */
/** @typedef {import('parse5').DefaultTreeAdapterMap['node']} HtmlNode */

const nlp = wink(model, ['pos']);
const { its } = nlp;
const boundary = '\u0001';
const ignoredTags = new Set(['code', 'pre', 'script', 'style', 'nav', 'table', 'svg', 'math']);
const ignoredClasses = /(?:^|\s)(?:math|highlight|highlight-[\w-]+|output|output_area|anchor-link)(?=\s|$)/;
const blocks = new Set(['p', 'li', 'blockquote', 'figcaption', 'h1', 'h2', 'h3', 'h4']);
const inflectingCategories = new Set(['NOUN', 'VERB', 'AUX', 'ADJ']);

/** @param {string} text */
function normalized(text) {
  return text.normalize().trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–−]/g, '-').replace(/\s+/g, ' ');
}

/** @param {string} text */
function tokens(text) {
  const list = nlp.readDoc(text).tokens();
  const raw = list.out(its.value);
  // The SDK's token overload does not describe its built-in lemma callback.
  /** @type {import('wink-nlp').ItsFunction<string>} */
  const lemma = /** @type {any} */ (its.lemma);
  const base = list.out(lemma);
  const pos = list.out(its.pos);
  const spaces = list.out(its.precedingSpaces);
  return raw.map((value, i) => ({
    value: normalized(value), raw: value,
    lemma: /^[A-Za-z]+$/.test(value) && inflectingCategories.has(pos[i]) ? base[i] : value,
    gap: spaces[i], pos: pos[i],
  }));
}

/** @param {string} text @param {string} sentence */
function baseForm(text, sentence) {
  const wanted = normalized(text);
  if (!wanted || !sentence || wanted.length > 160 || sentence.length > 4000) return text;
  const picked = tokens(text.trim());
  if (!picked.length) return text;
  const context = tokens(sentence);
  const candidates = new Set();
  for (let start = 0; start <= context.length - picked.length; start++) {
    const span = context.slice(start, start + picked.length);
    const form = span.map((token, i) => (i && token.gap ? ' ' : '') + token.value).join('');
    if (form !== wanted) continue;
    candidates.add(span.map((token, i) => {
      const attributive = /(?:ing|ed)$/i.test(token.raw) && span[i + 1]?.pos === 'NOUN';
      const lemma = attributive ? token.value : /^[A-Z]{2,}$/.test(token.raw) ? token.raw : token.lemma;
      return (i && token.gap ? ' ' : '') + lemma;
    }).join(''));
  }
  const candidate = [...candidates][0];
  return candidates.size === 1 && normalized(candidate) !== wanted ? candidate : text;
}

/** @param {string} html */
function prose(html) {
  /** @type {string[]} */
  const chunks = [];
  /** @param {HtmlNode} node */
  function visit(node) {
    if ('tagName' in node && (ignoredTags.has(node.tagName) ||
      node.attrs.some(attr => attr.name === 'class' && ignoredClasses.test(attr.value)))) return;
    if (node.nodeName === '#text' && 'value' in node) chunks.push(node.value);
    if ('childNodes' in node) {
      const separate = 'tagName' in node && blocks.has(node.tagName);
      if (separate) chunks.push('\n');
      for (const child of node.childNodes) visit(child);
      if (separate) chunks.push('\n');
    }
  }
  visit(parseFragment(html));
  return chunks.join('').split(/\n+/g).map(chunk => chunk.trim()).filter(Boolean);
}

/** @param {string} input */
function searchTokens(input) {
  return normalized(input).match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? [];
}

/** @param {string[]} words */
function pattern(words) {
  return boundary + words.join(boundary) + boundary;
}

/** @typedef {{source:string, path:string, text:string}} IndexedPage */

/** @type {ReturnType<typeof buildIndex> | undefined} */
let index;
let readAt = 0;

async function buildIndex() {
  const [books, articleIds] = await Promise.all([loadBooks(), libraryIds('articles')]);
  const bookSources = (await Promise.all(books.map(async material => {
    const directory = await libraryDirectory('books', material.id);
    return directory ? { material, directory } : null;
  }))).filter(source => source !== null);
  const articleSources = (await Promise.all(articleIds.map(async id => {
    const directory = await libraryDirectory('articles', id);
    const material = directory ? await loadArticle(directory, id) : null;
    return directory && material ? { material, directory } : null;
  }))).filter(source => source !== null);
  const files = [
    ...bookSources.flatMap(({ material, directory }) => material.items.map(item => ({
      source: material.id, path: '/books/' + material.id + '/' + item.slug,
      file: new URL(item.slug + '.html', directory),
    }))),
    ...articleSources.map(({ material, directory }) => ({
      source: material.id, path: '/read/' + material.id, file: new URL('article.html', directory),
    })),
  ];
  const glossaries = new Map(await Promise.all([...bookSources, ...articleSources].map(async ({ material, directory }) => {
    const glossary = await loadGlossary(directory, material, targetLanguage);
    return /** @type {const} */ ([material.id, new Map(
      [...glossary].map(([name, [translation]]) => [normalized(name), translation])
    )]);
  })));
  /** @type {IndexedPage[]} */
  const pages = await Promise.all(files.map(async ({ source, path, file }) => {
    const html = await readOptional(file) ?? '';
    const text = prose(html).map(line => pattern(searchTokens(line))).join('\n');
    return { source, path, text };
  }));
  return { pages, glossaries };
}

export async function vocabularyIndex() {
  if (!index || Date.now() - readAt > 300_000) {
    readAt = Date.now();
    index = buildIndex().catch(error => {
      index = undefined;
      throw error;
    });
  }
  return index;
}

/** @param {SavedExpression} entry @param {Awaited<ReturnType<typeof vocabularyIndex>>} index */
export function describeExpression(entry, index) {
  const fromPath = entry.href.split('#')[0];
  const source = fromPath.split('/')[2];
  const gloss = index.glossaries.get(source);
  const proposed = baseForm(entry.text, entry.sentence);
  const originalGloss = gloss?.get(normalized(entry.text));
  const proposedGloss = gloss?.get(normalized(proposed));
  const usesGlossaryTranslation = originalGloss !== undefined && normalized(entry.translation) === normalized(originalGloss);
  const keepsGlossaryForm = originalGloss !== undefined && proposedGloss === undefined &&
    (entry.text.includes(' ') || usesGlossaryTranslation);
  const lemma = keepsGlossaryForm ? entry.text : proposed;
  const translation = usesGlossaryTranslation && proposedGloss !== undefined ? proposedGloss : entry.translation;
  const isGlossaryTerm = !!(originalGloss || proposedGloss);
  const forms = [...new Set([entry.text, lemma].map(searchTokens).filter(words => words.length).map(pattern))];
  const matches = index.pages.filter(page => {
    if (page.path === fromPath) return true;
    const otherGlossary = index.glossaries.get(page.source);
    const otherMeaning = otherGlossary?.get(normalized(lemma)) ?? otherGlossary?.get(normalized(entry.text));
    if (page.source !== source && otherMeaning && normalized(otherMeaning) !== normalized(translation)) return false;
    return forms.some(form => page.text.includes(form));
  });
  const sources = new Set(matches.map(page => page.source)).size;
  const chapterCount = matches.filter(page => page.source === source && page.path.startsWith('/books/')).length;
  // Glossary evidence belongs to the original source. Surface matches elsewhere are weaker evidence.
  const priority = sources > 1 ? 3 : (chapterCount > 1 || (isGlossaryTerm && fromPath.startsWith('/books/'))) ? 2 : 0;
  return {
    id: JSON.stringify([normalized(lemma), normalized(translation)]),
    lemma, isGlossaryTerm, priority, spread: matches.length,
  };
}
