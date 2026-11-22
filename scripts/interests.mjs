#!/usr/bin/env node
// The agents' side of the reader: read what the reader did and said, log feedback from a chat,
// and offer new materials. Everything goes through the running reader's API, so the data stays
// in its database and syncs to every browser. See docs/agents/recommendations.md.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { isReaderRecord, levels } from '../public/reader-records.js';

/** @typedef {import('../public/reader-records.js').ReaderRecord} ReaderRecord */
/** @typedef {import('../public/reader-records.js').Suggestion} Suggestion */
/** @typedef {{id:string,title:string,publisher?:string,kind?:string,date?:string,source?:string,words:number}} CatalogArticle */
/** @typedef {{id:string,title:string,author:string,description?:string,source?:string,pages:{slug:string,title:string,type:string,words:number}[]}} CatalogBook */
/** @typedef {{articles:CatalogArticle[],books:CatalogBook[]}} Catalog */

const usage = `Usage: npm run interests -- <command> [options]

Commands
  digest [--json]                    What the reader read, how it went, notes and suggestions.
  note <text> [--material <id>] [--kind feedback|question|interest|note] [--source chat|agent]
                                     Log what the reader said, for example in a chat.
  suggest --title <t> --url <u> --kind article|book --why <reason> --score <0..1>
          [--author <a>] [--publisher <p>] [--minutes <n>] [--level easy|right|hard] [--id <slug>]
                                     Offer a material in the library's "For you" section.
  imported <suggestion-id> <material-id>
                                     Link a suggestion to the material prepared from it.
  profile [--set <file>|-]           Print the interest profile, or replace it from a file or stdin.
  forget <key>                       Delete a note:, suggestion: or choice: record.

Options
  --server <url>   The reader to talk to. Default: $ENGLISH_TOOL_URL or http://127.0.0.1:4173`;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string', default: process.env.ENGLISH_TOOL_URL ?? 'http://127.0.0.1:4173' },
    json: { type: 'boolean', default: false },
    material: { type: 'string' },
    kind: { type: 'string' },
    source: { type: 'string', default: 'chat' },
    title: { type: 'string' },
    url: { type: 'string' },
    why: { type: 'string' },
    score: { type: 'string' },
    author: { type: 'string' },
    publisher: { type: 'string' },
    minutes: { type: 'string' },
    level: { type: 'string' },
    id: { type: 'string' },
    set: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const server = options.server.replace(/\/$/, '');

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Sends records and returns the whole state. @param {ReaderRecord[]} [records] */
async function exchange(records = []) {
  for (const record of records) if (!isReaderRecord(record)) fail('Not a valid record: ' + JSON.stringify(record));
  const response = await fetch(server + '/api/reader-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, records }),
  }).catch(error => fail('The reader at ' + server + ' did not answer: ' + error.message));
  if (!response.ok) fail('The reader answered ' + response.status + '.');
  /** @type {{records: ReaderRecord[]}} */
  const data = await response.json();
  const state = new Map(data.records.map(record => [record[0], record]));
  for (const [key, updatedAt] of records) {
    if (state.get(key)?.[1] !== updatedAt) fail('A newer value of ' + key + ' is already stored; nothing changed.');
  }
  return state;
}

async function catalog() {
  const response = await fetch(server + '/api/library').catch(error => fail('The reader at ' + server + ' did not answer: ' + error.message));
  if (!response.ok) fail('The reader answered ' + response.status + ' for its library.');
  return /** @type {Catalog} */ (await response.json());
}

/** A timestamp after any stored version of the key. @param {Map<string, ReaderRecord>} state @param {string} key */
const nextTime = (state, key) => Math.max(Date.now(), (state.get(key)?.[1] ?? 0) + 1);

/** @param {string} text */
const slug = text => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** @param {number} time */
const day = time => new Date(time).toISOString().slice(0, 10);

/** @param {number} seconds */
const duration = seconds => seconds < 3600 ? Math.round(seconds / 60) + ' min' : (seconds / 3600).toFixed(1) + ' h';

/** @param {Map<string, ReaderRecord>} state @param {string} key */
function stored(state, key) {
  return state.get(key)?.[2];
}

/** The material a document, passage or note belongs to: `deep-work/introduction` → `deep-work`. @param {string} id */
const materialOf = id => id.split('/')[0];

/** @param {Map<string, ReaderRecord>} state @param {Catalog} library */
function summarize(state, library) {
  const records = [...state.values()].filter(([, , value]) => value !== null);
  /** @param {string} prefix */
  const byPrefix = prefix => records.filter(([key]) => key.startsWith(prefix));
  /** @type {{id:string,kind:'book'|'article',title:string,by?:string,source?:string,book?:CatalogBook,article?:CatalogArticle}[]} */
  const entries = [
    ...library.books.map(book => ({ id: book.id, kind: /** @type {const} */ ('book'), title: book.title, by: book.author, source: book.source, book })),
    ...library.articles.map(article => ({ id: article.id, kind: /** @type {const} */ ('article'), title: article.title, by: article.publisher, source: article.source, article })),
  ];
  const materials = entries.map(material => {
    const documents = material.book
      ? material.book.pages.map(page => ({ id: material.id + '/' + page.slug, words: page.words, chapter: page.type === 'chapter' }))
      : [{ id: material.id, words: material.article?.words ?? 0, chapter: true }];
    let words = 0; let wordsRead = 0; let lastRead = 0; let finished = 0;
    for (const document of documents) {
      const position = /** @type {{percent?:number}|undefined} */ (stored(state, 'reading:v3:' + document.id));
      const read = stored(state, 'read:' + document.id) === true;
      words += document.words;
      wordsRead += document.words * (read ? 1 : (position?.percent ?? 0) / 100);
      lastRead = Math.max(lastRead, state.get('reading:v3:' + document.id)?.[1] ?? 0);
      if (read && document.chapter) finished++;
    }
    // Activity keys end with the day: activity:<document>:<yyyy-mm-dd>.
    const activity = byPrefix('activity:' + material.id).filter(([key]) => materialOf(key.slice('activity:'.length, -11)) === material.id);
    const seconds = activity.reduce((sum, [, , value]) => sum + Number(/** @type {{seconds:number}} */ (value).seconds), 0);
    const lookups = activity.reduce((sum, [, , value]) => sum + Number(/** @type {{lookups:number}} */ (value).lookups), 0);
    const days = new Set(activity.map(([key]) => key.slice(-10))).size;
    const saved = byPrefix('vocabulary:').map(([, , value]) => /** @type {{text:string,href:string,savedAt:number}} */ (value))
      .filter(entry => materialOf(entry.href.replace(/^\/(?:read|books)\//, '').split('#')[0]) === material.id)
      .sort((a, b) => b.savedAt - a.savedAt);
    const notes = byPrefix('note:').map(([key, , value]) => ({ key, ...(/** @type {import('../public/reader-records.js').JournalNote} */ (value)) }))
      .filter(note => note.material && materialOf(note.material) === material.id).sort((a, b) => b.at - a.at);
    return {
      id: material.id, kind: material.kind, title: material.title, by: material.by, source: material.source,
      words, percent: words ? Math.floor(wordsRead / words * 1000) / 10 : 0,
      chapters: documents.filter(document => document.chapter).length, finished,
      lastRead: Math.max(lastRead, ...activity.map(([, updatedAt]) => updatedAt)),
      readingSeconds: seconds, readingDays: days, lookups,
      lookupsPer1000Words: wordsRead >= 200 ? Math.round(lookups / wordsRead * 10000) / 10 : null,
      saved: saved.length, savedExamples: saved.slice(0, 8).map(entry => entry.text),
      feedback: /** @type {import('../public/reader-records.js').Feedback|undefined} */ (stored(state, 'feedback:' + material.id)),
      notes,
    };
  }).sort((a, b) => b.lastRead - a.lastRead || a.title.localeCompare(b.title));
  const known = new Set(materials.map(material => material.id));
  const journal = byPrefix('note:').map(([key, , value]) => ({ key, ...(/** @type {import('../public/reader-records.js').JournalNote} */ (value)) }))
    .filter(note => !note.material || !known.has(materialOf(note.material))).sort((a, b) => b.at - a.at);
  const suggestions = byPrefix('suggestion:').map(([key, , value]) => {
    const id = key.slice('suggestion:'.length);
    return { id, choice: /** @type {string|undefined} */ (stored(state, 'choice:' + id)) ?? 'open', ...(/** @type {Suggestion} */ (value)) };
  }).sort((a, b) => b.addedAt - a.addedAt);
  const profile = /** @type {{text:string}|undefined} */ (stored(state, 'profile:interests'))?.text ?? '';
  return { generatedAt: new Date().toISOString(), profile, materials, journal, suggestions };
}

const interestNames = { more: 'More like this', fine: 'It was fine', less: 'Not for me' };
const levelNames = { easy: 'Easy', right: 'Just right', hard: 'Hard' };

/** @param {ReturnType<typeof summarize>} digest */
function markdown(digest) {
  const lines = ['# Reading digest, ' + digest.generatedAt.slice(0, 16).replace('T', ' ') + ' UTC', '',
    'Personal data from ' + server + '. Keep it out of the repository.', '', '## Interest profile', '',
    digest.profile.trim() || '_No profile yet. Write one with `npm run interests -- profile --set <file>`._', ''];
  const opened = digest.materials.filter(material => material.lastRead || material.feedback || material.notes.length || material.saved);
  lines.push('## Materials the reader opened', '');
  for (const material of opened) {
    lines.push('### ' + material.title + (material.by ? ' — ' + material.by : '') + ' (' + material.kind + ', `' + material.id + '`)', '');
    const progress = [material.percent + '% read'];
    if (material.kind === 'book') progress.push(material.finished + ' of ' + material.chapters + ' chapters finished');
    else if (material.finished) progress.push('finished');
    if (material.lastRead) progress.push('last read ' + day(material.lastRead));
    lines.push('- Progress: ' + progress.join(' · ') + ' · ' + material.words.toLocaleString('en') + ' words');
    if (material.readingSeconds || material.lookups) {
      lines.push('- Active reading: ' + duration(material.readingSeconds) + ' on ' + material.readingDays + ' day(s) · ' + material.lookups + ' lookups' +
        (material.lookupsPer1000Words === null ? '' : ' (' + material.lookupsPer1000Words + ' per 1,000 words read)'));
    }
    if (material.saved) lines.push('- Saved expressions: ' + material.saved + ' — ' + material.savedExamples.map(text => '“' + text + '”').join(', '));
    const take = material.feedback;
    if (take && (take.interest || take.level || take.note)) {
      lines.push('- Reader’s take: ' + [take.interest ? 'interest: ' + interestNames[take.interest] : '', take.level ? 'English: ' + levelNames[take.level] : '',
        take.note ? 'note: “' + take.note.trim() + '”' : ''].filter(Boolean).join(' · '));
    }
    for (const note of material.notes) lines.push('- ' + day(note.at) + ' ' + note.source + ' ' + note.kind + (note.material !== material.id ? ' on `' + note.material + '`' : '') + ': “' + note.text.trim() + '”');
    if (material.source) lines.push('- Source: ' + material.source);
    lines.push('');
  }
  const unopened = digest.materials.filter(material => !opened.includes(material));
  if (unopened.length) {
    lines.push('## In the library, not opened yet', '', ...unopened.map(material => '- ' + material.title + (material.by ? ' — ' + material.by : '') +
      ' (' + material.kind + ', `' + material.id + '`, ' + material.words.toLocaleString('en') + ' words)'), '');
  }
  lines.push('## Journal', '');
  lines.push(...(digest.journal.length ? digest.journal.map(note => '- ' + day(note.at) + ' ' + note.source + ' ' + note.kind +
    (note.material ? ' on `' + note.material + '`' : '') + ': “' + note.text.trim() + '” (`' + note.key + '`)') : ['_Nothing logged outside the materials yet._']), '');
  lines.push('## Suggestions', '');
  lines.push(...(digest.suggestions.length ? digest.suggestions.map(item => '- [' + item.choice + '] ' + item.title + ' (' + item.kind + ', score ' + item.score +
    (item.material ? ', imported as `' + item.material + '`' : '') + ', `' + item.id + '`) — ' + item.why + ' — ' + item.url) : ['_None yet._']), '');
  return lines.join('\n');
}

/** @param {string|undefined} text @param {string} name @returns {number} */
function number(text, name) {
  const parsed = Number(text);
  if (text === undefined || !Number.isFinite(parsed)) fail('--' + name + ' needs a number.');
  return parsed;
}

const [command, ...rest] = positionals;
if (options.help || !command) {
  console.log(usage);
  process.exit(command || options.help ? 0 : 1);
}

if (command === 'digest') {
  const [state, library] = await Promise.all([exchange(), catalog()]);
  const digest = summarize(state, library);
  console.log(options.json ? JSON.stringify(digest, null, 2) : markdown(digest));
} else if (command === 'note') {
  const text = rest.join(' ').trim();
  if (!text) fail('Write the note text after `note`.');
  const kind = options.kind ?? 'note';
  if (!['feedback', 'question', 'interest', 'note'].includes(kind)) fail('--kind is feedback, question, interest or note.');
  if (!['chat', 'agent'].includes(options.source)) fail('--source is chat or agent.');
  const at = Date.now();
  const key = 'note:' + at.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const note = { text, kind, source: options.source, at, ...(options.material ? { material: options.material } : {}) };
  await exchange([[key, at, /** @type {import('../public/reader-records.js').JournalNote} */ (note)]]);
  console.log('Logged ' + key);
} else if (command === 'suggest') {
  const { title, url, why, kind } = options;
  if (!title || !url || !why || (kind !== 'article' && kind !== 'book')) fail('suggest needs --title, --url, --why, --score and --kind article|book.');
  if (options.level && !(/** @type {readonly string[]} */ (levels)).includes(options.level)) fail('--level is easy, right or hard.');
  const id = slug(options.id ?? title);
  if (!id) fail('Give the suggestion an --id made of letters or digits.');
  const key = 'suggestion:' + id;
  const state = await exchange();
  /** @type {Suggestion} */
  const suggestion = {
    title, url, kind, why, score: number(options.score, 'score'), addedAt: Date.now(),
    ...(options.author ? { author: options.author } : {}), ...(options.publisher ? { publisher: options.publisher } : {}),
    ...(options.minutes ? { minutes: Math.round(number(options.minutes, 'minutes')) } : {}),
    ...(options.level ? { level: /** @type {Suggestion['level']} */ (options.level) } : {}),
  };
  await exchange([[key, nextTime(state, key), suggestion]]);
  console.log('Suggested ' + id);
} else if (command === 'imported') {
  const [id, material] = rest;
  if (!id || !material) fail('imported needs a suggestion id and a material id.');
  const key = 'suggestion:' + id;
  const state = await exchange();
  const current = /** @type {Suggestion|null|undefined} */ (stored(state, key));
  if (!current) fail('No suggestion ' + id + '.');
  await exchange([[key, nextTime(state, key), { ...current, material }]]);
  console.log('Linked ' + id + ' to ' + material);
} else if (command === 'profile') {
  const state = await exchange();
  if (options.set === undefined) {
    console.log(/** @type {{text:string}|undefined} */ (stored(state, 'profile:interests'))?.text ?? '');
  } else {
    let text = '';
    if (options.set === '-') for await (const chunk of process.stdin) text += chunk;
    else text = await readFile(options.set, 'utf8');
    await exchange([['profile:interests', nextTime(state, 'profile:interests'), { text }]]);
    console.log('Profile saved, ' + text.length + ' characters.');
  }
} else if (command === 'forget') {
  const [key] = rest;
  if (!/^(?:note|suggestion|choice):/.test(key ?? '')) fail('forget takes a note:, suggestion: or choice: key.');
  const state = await exchange();
  if (!state.has(key)) fail('No record ' + key + '.');
  await exchange([[key, nextTime(state, key), null]]);
  console.log('Forgot ' + key);
} else {
  fail(usage);
}
