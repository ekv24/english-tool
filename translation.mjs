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
const ollamaModel = process.env.ENGLISH_TOOL_OLLAMA_MODEL;
const ollamaUrl = process.env.ENGLISH_TOOL_OLLAMA_URL || 'http://127.0.0.1:11434';

export const hasLookupModel = !!(model || ollamaModel);
/** @type {Promise<import('@huggingface/transformers').TranslationPipeline> | undefined} */
let translator;
function loadTranslator() {
  if (!model) throw new Error('Set ENGLISH_TOOL_OPUS_MODEL to a Transformers.js-compatible model for your target language.');
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

/** @param {string} text @param {{maxNewTokens?:number}} [options] */
async function translateWithOpus(text, { maxNewTokens = 160 } = {}) {
  const run = await loadTranslator();
  const output = await run(text, { max_new_tokens: maxNewTokens });
  const translation = Array.isArray(output) ? output[0]?.translation_text : undefined;
  if (!translation) throw new Error('Empty translation');
  return translation;
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
  const terminology = terms ? 'Use these glossary meanings where relevant. Do not repeat the glossary.\n' + terms + '\n\n' : '';
  const task = definitionMode
    ? (sentence ? 'Explain this English sentence in plain English.' : 'Give only a short definition of this English expression in plain English.')
    : 'Translate this English text to ' + targetLabel + ' (' + targetLanguage + '). Return only the translation.';
  const nativeTranslation = !definitionMode && /^translategemma(?::|$)/i.test(ollamaModel ?? '');
  const prompt = nativeTranslation
    ? 'You are a professional English (en) to ' + targetLabel + ' (' + targetLanguage + ') translator. ' +
      'Your goal is to accurately convey the meaning and nuances of the original English text while adhering to ' +
      targetLabel + ' grammar, vocabulary, and cultural sensitivities.\n\n' +
      terminology + 'Produce only the ' + targetLabel + ' translation, without any additional explanations or commentary. Please translate the following English text into ' +
      targetLabel + ':\n\n\n' + text
    : task + '\n\n' + terminology + text;
  const response = await fetch(new URL('/api/chat', ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
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
  return output.trim();
}

/** @param {string} text @param {ReadonlyMap<string,[string,string]>} glossary @param {boolean} [sentence] */
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
