# English Tool

English Tool is a self-hosted web reader for learning vocabulary from English articles and books at any level. Click a word or select a phrase to look it up in place. Save useful expressions with their original sentences, review them later, and return to the passage they came from. The library keeps your reading position and completion status, and optional quizzes let you check your understanding of a text.

## Quick start

Install Node.js 24 or later. From the repository directory, run:

```sh
npm ci
npm start
```

Open [English Tool](http://127.0.0.1:4173/), choose **When a cached answer goes stale**, and click **stale** in the text to see its English gloss. Click **Save expression**, then open **Vocabulary**. Open the saved entry, select **Add to review** if needed, and start a review. **Reading a Latency Report** demonstrates book navigation and chapter quizzes. The examples work without a translation model.

To read your own texts, see [Adding articles and books](docs/materials.md). If you use Codex, the repository includes the [material preparation skill](.agents/skills/prepare-english-tool-material/SKILL.md).

## Choose a lookup language

The reading text and interface are in English. Set `ENGLISH_TOOL_TARGET_LANGUAGE` to a BCP 47 language tag such as `en`, `es`, or `pt-BR` to choose one lookup language for the server. The default is `en`. A glossary supplies short definitions or translations for its material in the selected language. When a selection has no glossary entry, a configured model can look it up.

**Ollama** supports lookups with a model that can translate from English into your target language. For English definitions, use a model that can follow an instruction to define or explain English text. With [Ollama](https://docs.ollama.com/) running and the model installed, set its name on startup. Replace the placeholder with the name of a model available in your Ollama installation.

```sh
ENGLISH_TOOL_TARGET_LANGUAGE=es \
  ENGLISH_TOOL_OLLAMA_MODEL=your-installed-model \
  npm start
```

The reader uses `http://127.0.0.1:11434` by default. Set `ENGLISH_TOOL_OLLAMA_URL` for a different Ollama endpoint. That endpoint receives the selected text or surrounding sentence for model lookups.

**OPUS-MT** uses a compatible Hugging Face translation model through Transformers.js. Pick a checkpoint for the English-to-target language pair, then set the same variables when preparing the model and starting the server.

```sh
export ENGLISH_TOOL_TARGET_LANGUAGE=ru
export ENGLISH_TOOL_OPUS_MODEL=Xenova/opus-mt-en-ru
npm run prepare:model
npm start
```

Set `ENGLISH_TOOL_OPUS_REVISION` to pin a specific checkpoint revision. The default is `main`. Model preparation downloads the files for local inference. For English definitions, use the glossary or Ollama. When both providers are configured, the reader uses OPUS-MT for selections and prefers Ollama for surrounding sentences.

## Self-hosting and data

The server listens on `127.0.0.1:4173`. Set `PORT` to use a different local port. Each running instance is for one reader. It shares one SQLite database across browsers and has no built-in login. For access from other devices, use a private tunnel or an authenticated HTTPS reverse proxy that restricts access to that reader. Keep the reader's port off the public internet.

By default, personal data lives in `.local/`. You can place it outside the checkout by setting `ENGLISH_TOOL_DATA_DIR` to an absolute directory path. The database is `reader-state/reader.sqlite` within that data directory. Set `ENGLISH_TOOL_STATE_DB` for a separate database path or `ENGLISH_TOOL_EXAMPLES=0` to hide the bundled examples. Back up the data directory and any separately configured database to keep imported files, vocabulary, and progress.

## Checks

```sh
npm run check
npm test
```

To run the browser tests, install Chromium through Playwright first.

```sh
npx playwright-core install chromium
npm run test:browser
```
