# 04 — For you

Category: enhancement\
Triage: ready-for-agent\
Status: resolved\
Assignee: Claude\
Blocked by: [№03 — API и CLI для агентов](03-agent-api-and-cli.md)

[Рекомендации чтения](../../../docs/specs/reading-recommendations.md).

- [x] Библиотека показывает до шести предложений, сначала отмеченные **Want to read**, затем по `score`. Пока предложений нет, раздела не видно.
- [x] **Not interested** скрывает карточку. До перезагрузки её можно вернуть кнопкой **Undo**.
- [x] Предложение, связанное с подготовленным материалом (`material`), из раздела исчезает.

## Comments

`public/library.js` (`updateSuggestions`). Проверка — тест «suggestions from agents appear in the library».
