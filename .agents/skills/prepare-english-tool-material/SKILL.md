---
name: prepare-english-tool-material
description: Prepare an English article, book, PDF, or scan for English Tool with a glossary, optional comprehension questions, and source-checked figures.
---

# Prepare material for English Tool

1. Read [the material format](../../../docs/materials.md) and choose a stable ID. Put prepared files in the configured data directory. Keep a copy of the original with its author, source URL, and edition. Check `scripts/` for an importer that already handles a similar source before writing a new one.
2. Build the HTML fragments in the original reading order. Keep the English wording, heading hierarchy, quotations, tables, formulas, citations, and captions. After OCR, check the page order, formulas, and figure labels visually against the scan.
3. Choose a representative library image, such as a source illustration, book cover, or publisher logo. Check cropping and readability at card size. When restyling a figure, keep both versions and compare axes, ticks, units, values, labels, and legend meanings before exposing the comparison in the reader.
4. Write glossary entries in the configured lookup language. For the Russian library in this repository, keep the glossary and quiz as [companion files](../../../docs/materials.md#companion-files-in-the-repository) in `materials/`. Explain the sense in the passage. For optional quizzes, ask readers to explain a conclusion, apply it to a new example, or identify an assumption. Give each answer a link to the relevant passage.
5. Open the material in the reader. Check the library card, document order, source link, and each quiz anchor. Check lookups, formulas, figures, and the reading layout at desktop and phone widths. Report any unresolved differences with the original.
