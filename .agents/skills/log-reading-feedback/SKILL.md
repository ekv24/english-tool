---
name: log-reading-feedback
description: Log what the user says about their reading in English Tool (impressions, difficulty, questions about a text, reading interests) into the reader's journal. Use whenever the user comments on an article or book they read in English Tool, asks a question about one, or says what they want or do not want to read.
---

# Log reading feedback

The reader keeps a journal that later drives reading suggestions. Follow [the journal procedure](../../../docs/agents/recommendations.md#записать-сказанное-в-чате).

1. Find the material id. Run `npm run interests -- digest` if you do not know it. Use `<book>/<slug>` for a question about one chapter.
2. Log one thought per entry, briefly and in the user's own language, without your judgment:
   `npm run interests -- note "<what they said>" --material <id> --kind feedback|question|interest|note`
3. Tell the user in one line what you logged. Remove an entry on request with `npm run interests -- forget note:<id>`.

The command writes to the live reader at `http://127.0.0.1:4173` unless you pass `--server`. Its output is personal: never commit it.
