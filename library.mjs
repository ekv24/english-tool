import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultData = fileURLToPath(new URL('./.local/', import.meta.url));
const dataPath = resolve(process.env.ENGLISH_TOOL_DATA_DIR || defaultData);
export const dataRoot = pathToFileURL(dataPath + (dataPath.endsWith(sep) ? '' : sep));
const examplesRoot = new URL('./examples/', import.meta.url);
// Companion files kept under version control: `<id>.json` metadata defaults,
// `<id>.glossary.json`, `<id>.quiz.json` for articles and `<id>.quizzes.json` for books.
const companionRoot = new URL('./materials/', import.meta.url);
// The companion glossaries in this repository are written in Russian.
const companionLanguage = 'ru';

/** @param {'articles'|'books'} kind */
function roots(kind) {
  const local = new URL(kind === 'articles' ? 'materials/' : 'books/', dataRoot);
  return process.env.ENGLISH_TOOL_EXAMPLES === '0' ? [local] : [local, new URL(kind + '/', examplesRoot)];
}

/** @param {URL} file */
export async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {URL} file */
export async function isFile(file) {
  try { return (await stat(file)).isFile(); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {'articles'|'books'} kind */
export async function libraryIds(kind) {
  const entries = await Promise.all(roots(kind).map(root => readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })));
  return [...new Set(entries.flat().filter(entry => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name))
    .map(entry => entry.name))].sort();
}

/** @param {'articles'|'books'} kind @param {string} id */
export async function libraryDirectory(kind, id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid material id');
  for (const root of roots(kind)) {
    const directory = new URL(id + '/', root);
    if (await isFile(new URL(kind === 'articles' ? 'metadata.json' : 'manifest.json', directory))) return directory;
  }
  return null;
}

/** @param {string} id @param {string} suffix */
function companionFile(id, suffix) {
  return new URL(id + suffix, companionRoot);
}

/**
 * Reads prepared metadata and fills the fields it leaves out from `materials/<id>.json`.
 * @param {URL} file @param {string} id @returns {Promise<Record<string, unknown>|null>}
 */
export async function readMetadata(file, id) {
  const [raw, companion] = await Promise.all([readOptional(file), readOptional(companionFile(id, '.json'))]);
  if (!raw) return null;
  return { ...(companion ? JSON.parse(companion) : {}), ...JSON.parse(raw) };
}

/** @typedef {{id:string,title:string,date?:string,source?:string,publisher?:string,kind?:string,previewMedia?:string,glossaryLanguage?:string,format?:string,sourcePage?:number,compareFigures?:boolean}} Material */

/** @param {URL} directory @param {string} id @returns {Promise<Material|null>} */
export async function loadArticle(directory, id) {
  const article = /** @type {Material|null} */ (await readMetadata(new URL('metadata.json', directory), id));
  return article?.id === id && typeof article.title === 'string' ? article : null;
}

/**
 * Finds a quiz next to the material or, failing that, in the companion folder.
 * @param {URL} directory @param {string} id @param {'articles'|'books'} kind
 */
export async function readQuiz(directory, id, kind) {
  const name = kind === 'articles' ? 'quiz.json' : 'quizzes.json';
  return await readOptional(new URL(name, directory)) ??
    await readOptional(companionFile(id, kind === 'articles' ? '.quiz.json' : '.quizzes.json'));
}

/**
 * Finds a downloadable original next to the material or in `<data>/originals/<id>/`.
 * @param {URL} directory @param {string} id @param {string} name
 */
export async function originalFile(directory, id, name) {
  const local = new URL(name, directory);
  return await isFile(local) ? local : new URL('originals/' + id + '/' + name, dataRoot);
}

/** @type {Map<string, {key:string, glossary:Promise<Map<string,[string,string]>>}>} */
const glossaries = new Map();

/** Reads a glossary once and again only after the file changes. @param {URL} file */
async function readGlossary(file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const key = info.size + ':' + info.mtimeMs;
  const cached = glossaries.get(file.href);
  if (cached?.key === key) return cached.glossary;
  const glossary = readFile(file, 'utf8').then(raw => {
    const entries = /** @type {Record<string,[string,string]>} */ (JSON.parse(raw));
    /** @type {Map<string,[string,string]>} */
    const terms = new Map();
    for (const [term, meaning] of Object.entries(entries)) {
      if (Array.isArray(meaning) && meaning.length === 2 && meaning.every(part => typeof part === 'string')) {
        terms.set(term, meaning);
      }
    }
    return terms;
  });
  glossaries.set(file.href, { key, glossary });
  glossary.catch(() => glossaries.delete(file.href));
  return glossary;
}

/** @param {string|undefined} tagged @param {string} language */
function sameLanguage(tagged, language) {
  return !tagged || tagged.toLowerCase() === language.toLowerCase();
}

/** @param {URL} directory @param {{id?:string,glossaryLanguage?:string}} material @param {string} language */
export async function loadGlossary(directory, material, language) {
  // Only match an explicitly tagged glossary to its own target. Untagged glossaries belong to the instance's target.
  const own = sameLanguage(material.glossaryLanguage, language) ? await readGlossary(new URL('glossary.json', directory)) : null;
  if (own) return own;
  const companion = material.id && companionLanguage === language.toLowerCase().split('-')[0]
    ? await readGlossary(companionFile(material.id, '.glossary.json')) : null;
  return companion ?? new Map();
}

/** @param {string|undefined} source @param {string} localOriginal */
export function originalSource(source, localOriginal) {
  if (!source) return '';
  if (source === localOriginal || source.startsWith(localOriginal + '#')) return source;
  try {
    const url = new URL(source);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch { /* No usable original link was supplied. */ }
  return '';
}
