---
name: recommend-reading
description: Suggest new articles or books for the English Tool reader from their reading history, feedback and interest profile, and keep that profile up to date. Use when the user asks what to read next, asks to find materials on a topic, or asks to update or show their reading profile.
---

# Recommend reading

Follow [the recommendation procedure](../../../docs/agents/recommendations.md#подбор-материалов).

1. Read `npm run interests -- digest`. Note what was finished, rated **More like this** or **Not for me**, where the English was hard, which words were saved, the journal, and earlier suggestions.
2. Update the interest profile with `npm run interests -- profile --set <file>`. Keep the file outside the repository. Cover topics, sources, English level and preferred length in at most a page.
3. Search for candidates. Start from the sources and authors of liked materials. Give one slot in five to a topic outside the profile. Skip anything already in the library or dismissed.
4. Score each candidate as the chance of **More like this** (0 to 1). Write `why` in English for the reader, tied to concrete signals.
5. Add at most five with `npm run interests -- suggest ...`, then summarise them for the user. They appear under **For you** in the library.
6. For a suggestion marked **Want to read**, prepare it with the `prepare-english-tool-material` skill and run `npm run interests -- imported <suggestion-id> <material-id>`.

The digest and profile are personal data: never commit them.
