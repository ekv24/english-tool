# 03 — API и CLI для агентов

Category: enhancement\
Triage: ready-for-agent\
Status: resolved\
Assignee: Claude\
Blocked by: —

[Рекомендации чтения](../../../docs/specs/reading-recommendations.md), [ADR 0001](../../../docs/adr/0001-reader-data-and-agent-api.md).

- [x] `GET /api/library` отдаёт каталог без данных читателя, с числом слов статей и страниц книг.
- [x] `npm run interests -- digest [--json]` собирает по материалам прогресс, время, поиски, сохранённые выражения, отзыв и заметки, а затем журнал, предложения и профиль.
- [x] Есть команды `note`, `suggest`, `imported`, `profile`, `forget`. Каждая пишет через `/api/reader-state` и не затирает более новую версию.
- [x] Есть правила в AGENTS.md и [docs/agents/recommendations.md](../../../docs/agents/recommendations.md) и скиллы `log-reading-feedback` и `recommend-reading`. Они доступны и Codex (`.agents/skills`), и Claude Code (`.claude/skills`).

## Comments

`scripts/interests.mjs`, проверка — [test/interests.test.mjs](../../../test/interests.test.mjs).
