import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Tests of the author's own library read prepared books, articles and the OPUS-MT model from `.local/`.
// That data is not part of the repository, so a fresh checkout or CI skips these tests.
export const localRoot = new URL('../.local/', import.meta.url);

/** Returns the reason to skip a test, or false when all paths exist. @param {string[]} paths */
export async function missingLocalData(paths) {
  for (const path of paths) {
    try { await access(new URL(path, localRoot)); }
    catch { return 'needs local data that is not in the repository: .local/' + path; }
  }
  return false;
}

export const opusModel = 'models/Xenova/opus-mt-en-ru/e050376e960175e8ddc5cff85025dc8436cddd68/config.json';

/** The reader settings for a Russian library in `.local/` without the bundled examples. */
export const localReaderEnv = {
  ENGLISH_TOOL_DATA_DIR: fileURLToPath(localRoot),
  ENGLISH_TOOL_EXAMPLES: '0',
  ENGLISH_TOOL_TARGET_LANGUAGE: 'ru',
  ENGLISH_TOOL_OPUS_MODEL: 'Xenova/opus-mt-en-ru',
  ENGLISH_TOOL_OPUS_REVISION: 'e050376e960175e8ddc5cff85025dc8436cddd68',
  ENGLISH_TOOL_OLLAMA_MODEL: '',
};
