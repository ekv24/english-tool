import { fileURLToPath } from 'node:url';

import { dataRoot } from './library.mjs';

export const targetLanguage = Intl.getCanonicalLocales(process.env.ENGLISH_TOOL_TARGET_LANGUAGE || 'en')[0];
const definitionMode = targetLanguage.split('-')[0] === 'en';
const targetLabel = new Intl.DisplayNames(['en'], { type: 'language' }).of(targetLanguage) ?? targetLanguage;
const model = process.env.ENGLISH_TOOL_OPUS_MODEL;
const revision = process.env.ENGLISH_TOOL_OPUS_REVISION || 'main';
if (model && (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(model) ||
    model.split('/').some(name => name === '.' || name === '..') ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(revision))) {
  throw new Error('Configure OPUS-MT with a Hugging Face owner/model name and a revision name or commit SHA.');
}
const cacheDir = fileURLToPath(new URL('models/', dataRoot));
const downloadModel = process.argv.includes('--download-model');
// ENGLISH_TOOL_SENTENCE_MODEL is the earlier name of the Ollama model setting.
const ollamaModel = process.env.ENGLISH_TOOL_OLLAMA_MODEL ?? process.env.ENGLISH_TOOL_SENTENCE_MODEL;
const ollamaUrl = process.env.ENGLISH_TOOL_OLLAMA_URL || 'http://127.0.0.1:11434';
// A local OPUS-MT model can take over when Ollama is slow, so Ollama gets less time in that case.
const ollamaTimeout = model ? 8000 : 15_000;

export const hasLookupModel = !!(model || ollamaModel);
/** @type {Promise<import('@huggingface/transformers').TranslationPipeline> | undefined} */
let translator;
function loadTranslator() {
  if (!model) return Promise.reject(new Error('Set ENGLISH_TOOL_OPUS_MODEL to a Transformers.js-compatible model for your target language.'));
  translator ??= import('@huggingface/transformers').then(({ env, pipeline }) => {
    env.cacheDir = cacheDir;
    env.allowRemoteModels = downloadModel;
    const installed = model + (revision === 'main' ? '' : '/' + revision);
    return pipeline('translation', downloadModel ? model : fileURLToPath(new URL(installed + '/', new URL('models/', dataRoot))), {
      revision, dtype: 'q8', device: 'cpu',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
  }).catch(error => {
    translator = undefined;
    throw error;
  });
  return translator;
}

/** Starts loading OPUS-MT without waiting for it. */
export function warmTranslation() {
  if (model) loadTranslator().catch(() => {});
}

// Repeated lookups of the same word or sentence skip the models.
/** @type {Map<string,string>} */
const results = new Map();
/** @param {string} key */
function recall(key) {
  const value = results.get(key);
  if (value !== undefined) { results.delete(key); results.set(key, value); }
  return value;
}
/** @param {string} key @param {string} value */
function remember(key, value) {
  results.set(key, value);
  if (results.size > 2000) results.delete(/** @type {string} */ (results.keys().next().value));
  return value;
}

/** @param {string} text @param {{maxNewTokens?:number}} [options] */
async function translateWithOpus(text, { maxNewTokens = 160 } = {}) {
  const key = 'opus:' + maxNewTokens + ':' + text;
  const cached = recall(key);
  if (cached !== undefined) return cached;
  const run = await loadTranslator();
  const output = await run(text, { max_new_tokens: maxNewTokens });
  const translation = Array.isArray(output) ? output[0]?.translation_text : undefined;
  if (!translation) throw new Error('Empty translation');
  return remember(key, translation);
}

let warmedAt = 0;

/**
 * Asks Ollama to load its model while the reader is still reading, so the first
 * "Translate sentence" does not wait for a cold start. Repeats at most every five minutes.
 */
export function warmSentenceModel() {
  if (!ollamaModel || Date.now() - warmedAt < 5 * 60_000) return;
  warmedAt = Date.now();
  fetch(new URL('/api/generate', ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: ollamaModel, keep_alive: '30m' }),
  }).then(response => response.body?.cancel(), () => { warmedAt = 0; });
}

/** @param {string} sentence @param {ReadonlyMap<string,[string,string]>} glossary */
function glossaryForSentence(sentence, glossary) {
  const normalize = /** @param {string} value */ value =>
    value.normalize('NFC').toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–−]/g, '-').replace(/\s+/g, ' ');
  const normalized = normalize(sentence);
  /** @type {{term:string, translation:string, start:number, end:number}[]} */
  const matches = [];
  for (const [term, [translation]] of glossary) {
    const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'gu');
    for (const match of normalized.matchAll(pattern)) {
      matches.push({ term, translation, start: match.index, end: match.index + match[0].length });
    }
  }
  /** @type {typeof matches} */
  const chosen = [];
  const terms = new Map();
  for (const match of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (chosen.some(other => match.start < other.end && match.end > other.start)) continue;
    chosen.push(match);
    terms.set(match.term, match.translation);
    if (terms.size === 12) break;
  }
  return [...terms].map(([term, translation]) => term + ' → ' + translation).join('\n');
}

/** @param {string} text @param {ReadonlyMap<string,[string,string]>} glossary @param {boolean} sentence */
async function translateWithOllama(text, glossary, sentence) {
  const terms = glossaryForSentence(text, glossary);
  const nativeTranslation = !definitionMode && /^translategemma(?::|$)/i.test(ollamaModel ?? '');
  const terminology = !terms ? '' : nativeTranslation
    ? 'Use the following glossary when translating. Preserve the ' + targetLabel + ' terminology below, changing only its grammatical form as needed. ' +
      'Keep the meaning of each glossary term in the output. Do not translate or repeat this glossary.\n' + terms + '\n\n'
    : 'Use these glossary meanings where relevant. Do not repeat the glossary.\n' + terms + '\n\n';
  const task = definitionMode
    ? (sentence ? 'Explain this English sentence in plain English.' : 'Give only a short definition of this English expression in plain English.')
    : 'Translate this English text to ' + targetLabel + ' (' + targetLanguage + '). Return only the translation.';
  const prompt = nativeTranslation
    ? 'You are a professional English (en) to ' + targetLabel + ' (' + targetLanguage + ') translator. ' +
      'Your goal is to accurately convey the meaning and nuances of the original English text while adhering to ' +
      targetLabel + ' grammar, vocabulary, and cultural sensitivities.\n' +
      terminology + 'Produce only the ' + targetLabel + ' translation, without any additional explanations or commentary. Please translate the following English text into ' +
      targetLabel + ':\n\n\n' + text
    : task + '\n\n' + terminology + text;
  const key = 'ollama:' + ollamaModel + ':' + prompt;
  const cached = recall(key);
  if (cached !== undefined) return cached;
  const response = await fetch(new URL('/api/chat', ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(ollamaTimeout),
    body: JSON.stringify({
      model: ollamaModel, stream: false, keep_alive: '30m',
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0, num_ctx: 2048, num_predict: 512 },
    }),
  });
  if (!response.ok) throw new Error('Ollama lookup failed (' + response.status + ')');
  const result = await response.json();
  const output = result.message?.content;
  if (result.done_reason !== 'stop' || typeof output !== 'string' || !output.trim()) {
    throw new Error('Ollama returned no complete lookup result');
  }
  warmedAt = Date.now();
  return remember(key, output.trim());
}

/** TranslateGemma can translate a word inside its sentence; other models are not asked to. */
export const hasContextModel = !definitionMode && /^translategemma(?::|$)/i.test(ollamaModel ?? '');

/** Word stems long enough to recognise a Russian word in another grammatical form. @param {string} text */
function stems(text) {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter(word => word.length >= 4)
    .map(word => word.slice(0, Math.max(4, Math.ceil(word.length * .6))));
}

/**
 * Translates a word or short phrase as it is used in its sentence. TranslateGemma is asked to
 * translate «"word", as used in the sentence: "…"»; it answers with the word's translation in
 * quotes followed by its translation of the sentence. The answer is kept only when the word's
 * translation also appears in that sentence translation, which rejects answers that drift to a
 * neighbouring word. Returns null when there is no trustworthy answer.
 * @param {string} text @param {string} sentence @param {ReadonlyMap<string,[string,string]>} glossary
 */
export async function translateInContext(text, sentence, glossary) {
  if (!hasContextModel) return null;
  const terms = glossaryForSentence(sentence, glossary);
  const terminology = terms ? 'Use the following glossary when translating. Preserve the ' + targetLabel +
    ' terminology below, changing only its grammatical form as needed. Do not translate or repeat this glossary.\n' + terms + '\n\n' : '';
  const prompt = 'You are a professional English (en) to ' + targetLabel + ' (' + targetLanguage + ') translator. ' +
    'Your goal is to accurately convey the meaning and nuances of the original English text while adhering to ' +
    targetLabel + ' grammar, vocabulary, and cultural sensitivities.\n' + terminology +
    'Produce only the ' + targetLabel + ' translation, without any additional explanations or commentary. ' +
    'Please translate the following English text into ' + targetLabel + ':\n\n\n' +
    '"' + text + '", as used in the sentence: "' + sentence.replace(/"/g, "'") + '"';
  const output = await askOllama(prompt);
  return checkInContext(text, sentence, output);
}

/**
 * Picks the quoted translation of the expression out of TranslateGemma's answer and checks it
 * against the sentence translation that follows it.
 * @param {string} text @param {string} sentence @param {string} output
 */
export function checkInContext(text, sentence, output) {
  const [, found = '', rest = ''] = output.match(/^\s*[«"“„]([^«»"“”„\n]{1,60})[»"”“]([\s\S]*)$/u) ?? [];
  const candidate = found.trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
  if (!candidate || /[a-z]/i.test(candidate) || candidate.split(' ').length > text.split(' ').length + 3) return null;
  const echo = rest.toLowerCase();
  if (echo.length < 12) return null;
  const parts = stems(candidate);
  const confirmed = parts.length ? parts.every(stem => echo.includes(stem)) : echo.includes(candidate.toLowerCase());
  return confirmed ? matchCase(text, candidate, sentence) : null;
}

/**
 * Lowercases a translation unless the English expression is a name or an acronym. A capital
 * letter that only comes from the start of the sentence does not count.
 * @param {string} english @param {string} translation @param {string} [sentence]
 */
export function matchCase(english, translation, sentence = '') {
  const startsSentence = sentence.trimStart().toLowerCase().startsWith(english.toLowerCase());
  const name = /\p{Lu}/u.test(english.slice(1)) || (/^\p{Lu}/u.test(english) && !startsSentence);
  return name ? translation : translation.charAt(0).toLocaleLowerCase(targetLanguage) + translation.slice(1);
}

/** @param {string} prompt */
async function askOllama(prompt) {
  const key = 'ollama:' + ollamaModel + ':' + prompt;
  const cached = recall(key);
  if (cached !== undefined) return cached;
  const response = await fetch(new URL('/api/chat', ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: ollamaModel, stream: false, keep_alive: '30m',
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0, num_ctx: 2048, num_predict: 400 },
    }),
  });
  if (!response.ok) throw new Error('Ollama lookup failed (' + response.status + ')');
  const result = await response.json();
  const output = result.message?.content;
  if (result.done_reason !== 'stop' || typeof output !== 'string' || !output.trim()) {
    throw new Error('Ollama returned no complete lookup result');
  }
  warmedAt = Date.now();
  return remember(key, output.trim());
}

/**
 * Looks up a selection with OPUS-MT and a surrounding sentence with Ollama when both are set.
 * Falls back to OPUS-MT if Ollama is unavailable.
 * @param {string} text @param {ReadonlyMap<string,[string,string]>} glossary @param {boolean} [sentence]
 */
export async function translate(text, glossary, sentence = false) {
  if (ollamaModel && (sentence || !model)) {
    try { return { text: await translateWithOllama(text, glossary, sentence), source: 'Ollama' }; }
    catch (error) { if (!model) throw error; }
  }
  return { text: await translateWithOpus(text, { maxNewTokens: sentence ? 512 : 160 }), source: 'OPUS-MT' };
}

if (downloadModel) {
  await translateWithOpus('context window');
  console.log('OPUS-MT is ready.');
}
