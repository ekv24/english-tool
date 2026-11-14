import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export async function testData(t) {
  const directory = await mkdtemp(join(tmpdir(), 'english-tool-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  return directory;
}

export async function startReader(t, options = {}) {
  const server = spawn(process.execPath, ['server.mjs'], {
    env: {
      ...process.env,
      PORT: '0',
      ENGLISH_TOOL_TARGET_LANGUAGE: 'en',
      ENGLISH_TOOL_OLLAMA_MODEL: '',
      ENGLISH_TOOL_OPUS_MODEL: '',
      ENGLISH_TOOL_STATE_DB: ':memory:',
      ENGLISH_TOOL_DATA_DIR: options.ENGLISH_TOOL_DATA_DIR ?? await testData(t),
      ENGLISH_TOOL_EXAMPLES: '1',
      ...options,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const output = createInterface({ input: server.stdout });
  t.after(() => {
    output.close();
    server.kill();
  });
  const [url] = await Promise.race([
    once(output, 'line'),
    once(server, 'exit').then(() => { throw new Error('Reader did not start'); }),
  ]);
  return url;
}
