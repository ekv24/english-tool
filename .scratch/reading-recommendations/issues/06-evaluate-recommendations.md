# 06 — Оценка качества подбора

Category: enhancement\
Triage: needs-triage\
Status: open\
Assignee: —\
Blocked by: [№05 — Первый подбор и профиль интересов](05-first-recommendation-pass.md)

[Рекомендации чтения](../../../docs/specs/reading-recommendations.md).

- [ ] После 15–20 предложений посчитано, какая их доля получила **Want to read**, была дочитана и получила **More like this**.
- [ ] Сопоставлены `score` и исход. Видно, переоценивает или недооценивает подбор интерес.
- [ ] Выводы и поправки к процедуре записаны в [docs/agents/recommendations.md](../../../docs/agents/recommendations.md), без личных подробностей.

## Comments

Если `score` плохо отделяет попадания от промахов, сначала стоит менять профиль и процедуру, а не вводить модель.
