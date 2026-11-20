# Read Causal Inference for the Brave and True in English Tool

Triage: ready-for-agent
Status: resolved
Assignee: Codex
Blocked by: none
Spec: [Reading and vocabulary](../../../docs/specs/reading-vocabulary.md)

## Acceptance criteria

- The book appears as one library item with a resume action and chapter progress.
- The official introduction, all numbered chapters and appendices open in the reader. The book contents mirror the official order, groups and titles, including the contribution link.
- English text, math, plots, notebook code and outputs remain readable on desktop and mobile. The prepared copy credits Matheus Facure Alves and retains the upstream license.
- Translations, contextual terminology and progress work within chapters. Optional chapter questions link to the original passages they draw on.
- Browser checks cover the whole inventory and realistic reading flows. The Mac mini serves the updated reader at the existing MacBook address.

## Comments

Chromium verified the 31-page inventory, the official contents, 1,460 TeX
expressions, all local figures at a 320 px viewport, the chapter resume path,
and the translation-to-vocabulary flow. The chapter questions all point to
existing sections. See [reader tests](../../../test/reader.test.mjs) and
[book fidelity tests](../../../test/book-fidelity.test.mjs).

All 227 technical figures display as SVG in the reader palette. Verified
notebook runs produced 111. Another 64 were reconstructed from published
geometry, and 24 original vector diagrams received updated styling. The
remaining 28 are SVG traces with the source's resolution and geometry. A
pixel comparison checks the traced marks after the palette change. The
manifest records the method for every figure under `figureMethods`.

The deployed Tailscale address was verified in Chromium on all 31 pages,
including figure files, formulas, chapter titles and order at 320 px.
Browser tests also cover 100% figure zoom, the original toggle, returning to
a passage repeatedly, returning to the quiz, and sentence translation
alongside a glossary definition.
