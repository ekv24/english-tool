# 01 — Сигналы чтения

Category: enhancement\
Triage: ready-for-agent\
Status: resolved\
Assignee: Claude\
Blocked by: —

[Рекомендации чтения](../../../docs/specs/reading-recommendations.md).

- [x] За каждый день читалка записывает для документа активное время чтения и число поисков (`activity:<document>:<yyyy-mm-dd>`).
- [x] Простой дольше 90 секунд и скрытая вкладка не засчитываются.
- [x] Счётчики уходят на сервер при уходе со страницы вместе с остальными изменениями и синхронизируются между устройствами.
- [x] Беглый просмотр места из Vocabulary не считается чтением.

## Comments

`public/activity.js`. Проверка — тест «reading time counts only while the reader is active» в
[test/interests.browser.mjs](../../../test/interests.browser.mjs). Тест управляет часами через Playwright clock.
Поиски проверяет тест «the reader’s take and lookups reach the server».
