#!/usr/bin/env node
// Makes the day's recording for Listen: asks the reader which expressions to play today and has
// vocabulary-audio.py speak them. See docs/agents/vocabulary-audio.md.
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dataRoot } from '../library.mjs';

const { values: options } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.ENGLISH_TOOL_URL ?? 'http://127.0.0.1:4173' },
    directory: { type: 'string', default: fileURLToPath(new URL('speech/', dataRoot)) },
    python: { type: 'string' },
    day: { type: 'string' },
  },
});
const directory = options.directory.replace(/\/?$/, '/');
const python = options.python ?? directory + 'venv/bin/python';
const now = new Date();
const pad = /** @param {number} number */ number => String(number).padStart(2, '0');
const day = options.day ?? now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

const response = await fetch(options.server.replace(/\/$/, '') + '/api/reader-state', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ since: 0, records: [], vocabulary: { type: 'playlist', day } }),
});
if (!response.ok) throw new Error('The reader answered ' + response.status + '.');
/** @type {{key:string,lemma:string,text:string,translation:string,sentence:string}[]} */
const cards = (await response.json()).vocabulary.playlist;
console.log(new Date().toISOString() + ' ' + cards.length + ' expressions to play on ' + day);
if (!cards.length) process.exit(0);

/** @type {{version:string, cards:{key:string,lemma:string}[]}|null} */
const current = await readFile(directory + 'mix.json', 'utf8').then(JSON.parse, () => null);
/** @param {{key:string,lemma:string}[]} list */
const contents = list => JSON.stringify(list.map(card => [card.key, card.lemma]).sort());
const ready = current && contents(current.cards) === contents(cards) && await access(directory + current.version + '.mp3').then(() => true, () => false);
if (ready) {
  console.log('The recording is up to date.');
  process.exit(0);
}
const child = spawn(python, [fileURLToPath(new URL('vocabulary-audio.py', import.meta.url)), directory], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(JSON.stringify({ cards }));
const code = await new Promise((resolve, reject) => child.on('error', reject).on('close', resolve));
if (code !== 0) process.exit(1);
