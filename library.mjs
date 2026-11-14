import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultData = fileURLToPath(new URL('./.local/', import.meta.url));
const dataPath = resolve(process.env.ENGLISH_TOOL_DATA_DIR || defaultData);
export const dataRoot = pathToFileURL(dataPath + (dataPath.endsWith(sep) ? '' : sep));
const examplesRoot = new URL('./examples/', import.meta.url);

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

/** @typedef {{id:string,title:string,date?:string,source?:string,publisher?:string,kind?:string,previewMedia?:string,glossaryLanguage?:string}} Material */

/** @param {URL} directory @param {string} id @returns {Promise<Material|null>} */
export async function loadArticle(directory, id) {
  const raw = await readOptional(new URL('metadata.json', directory));
  const article = /** @type {Material|null} */ (raw ? JSON.parse(raw) : null);
  return article?.id === id && typeof article.title === 'string' ? article : null;
}

/** @param {URL} directory @param {{glossaryLanguage?:string}} material @param {string} language */
export async function loadGlossary(directory, material, language) {
  // Only match an explicitly tagged glossary to its own target. Untagged glossaries belong to the instance's target.
  if (material.glossaryLanguage && material.glossaryLanguage.toLowerCase() !== language.toLowerCase()) {
    return new Map();
  }
  const file = new URL('glossary.json', directory);
  const raw = await readOptional(file);
  if (!raw) return new Map();
  const entries = /** @type {Record<string,[string,string]>} */ (JSON.parse(raw));
  /** @type {Map<string,[string,string]>} */
  const glossary = new Map();
  for (const [term, meaning] of Object.entries(entries)) {
    if (Array.isArray(meaning) && meaning.length === 2 && meaning.every(part => typeof part === 'string')) {
      glossary.set(term, meaning);
    }
  }
  return glossary;
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
