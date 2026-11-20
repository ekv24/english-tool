import { hash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';

// Static files from public/ are kept in memory and addressed by content version,
// so browsers can cache them for a year instead of revalidating on every page.
const webRoot = new URL('./public/', import.meta.url);

/** @typedef {{ versions: Map<string,string>, bodies: Map<string,Buffer>, deps: Map<string,string[]>, importMap: string, importMapHash: string }} Assets */

/** @type {Promise<Assets> | undefined} */
let current;
let signature = '';
let checkedAt = 0;

async function listAssets() {
  const top = (await readdir(webRoot)).filter(name => /^[\w-]+\.(?:css|js)$/.test(name));
  const fonts = (await readdir(new URL('fonts/', webRoot))).filter(name => /^[\w-]+\.woff2$/.test(name)).map(name => 'fonts/' + name);
  return [...top, ...fonts].sort();
}

/** @param {Buffer|string} data */
const version = data => hash('sha256', data, 'base64url').slice(0, 12);

/** @param {string[]} names */
async function build(names) {
  /** @type {Map<string,Buffer>} */
  const bodies = new Map(await Promise.all(names.map(async name => /** @type {[string,Buffer]} */ ([name, await readFile(new URL(name, webRoot))]))));
  /** @type {Map<string,string>} */
  const versions = new Map();
  for (const name of names) if (!name.endsWith('.css')) versions.set(name, version(/** @type {Buffer} */ (bodies.get(name))));
  for (const name of names.filter(name => name.endsWith('.css'))) {
    const css = String(bodies.get(name)).replace(/url\((['"]?)\/(fonts\/[\w-]+\.woff2)\1\)/g, (match, quote, font) =>
      versions.has(font) ? 'url(' + quote + '/' + font + '?v=' + versions.get(font) + quote + ')' : match);
    bodies.set(name, Buffer.from(css));
    versions.set(name, version(css));
  }
  /** @type {Map<string,string[]>} */
  const deps = new Map();
  for (const name of names.filter(name => name.endsWith('.js'))) {
    const source = String(bodies.get(name));
    const imports = [...source.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]\.\/([\w-]+\.js)['"]/gm)].map(match => match[1]);
    deps.set(name, imports.filter(dep => versions.has(dep)));
  }
  const importMap = JSON.stringify({
    imports: Object.fromEntries([...deps.keys()].map(name => ['/' + name, '/' + name + '?v=' + versions.get(name)])),
  });
  return { versions, bodies, deps, importMap, importMapHash: "'sha256-" + hash('sha256', importMap, 'base64') + "'" };
}

/** Returns the current assets, rebuilding them at most once a second after a file changes. */
export async function assets() {
  if (current && Date.now() - checkedAt < 1000) return current;
  checkedAt = Date.now();
  const names = await listAssets();
  const stats = await Promise.all(names.map(name => stat(new URL(name, webRoot))));
  const next = names.map((name, i) => name + ':' + stats[i].size + ':' + stats[i].mtimeMs).join('|');
  if (!current || next !== signature) {
    signature = next;
    const built = build(names);
    current = built;
    built.catch(() => { if (current === built) { current = undefined; signature = ''; } });
  }
  return current;
}

/** @param {Assets} found @param {string} entry */
function closure(found, entry) {
  const seen = new Set();
  const visit = /** @param {string} name */ name => {
    for (const dep of found.deps.get(name) ?? []) if (!seen.has(dep)) { seen.add(dep); visit(dep); }
  };
  visit(entry);
  seen.delete(entry);
  return [...seen];
}

/**
 * Adds asset versions, the module import map and module preloads to a rendered page.
 * @param {string} html @param {Assets} found
 */
export function versionPage(html, found) {
  const entries = [...html.matchAll(/<script type="module" src="\/([\w-]+\.js)">/g)].map(match => match[1]);
  const preload = [...new Set(entries.flatMap(entry => closure(found, entry)))]
    .map(name => '<link rel="modulepreload" href="/' + name + '">').join('');
  const head = '<script type="importmap">' + found.importMap + '</script>' + preload;
  return html.replace('<title>', head + '<title>')
    .replace(/\b(href|src)="\/([\w-]+\.(?:css|js))"/g, (match, attribute, name) =>
      found.versions.has(name) ? attribute + '="/' + name + '?v=' + found.versions.get(name) + '"' : match);
}
