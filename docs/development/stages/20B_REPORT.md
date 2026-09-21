# Отчёт этапа 20B — данные реестра в карточках, без модели

Дата: 2026-09-21. Ветка: `main`. Точка кода: рабочее дерево поверх `9c77184` (этап 20A).
Node: локальный. cwd: `backend/` и `frontend/`.

## Статусы

IMPLEMENTED: ДА
CODE_CHECKED: ДА — офлайн: `npm run typecheck` (exit 0), backend `npm test`, frontend `npm test`,
`npm run check:labels`, `npx tsc -b`
REVIEWED: NOT_RUN
USER_VALIDATED: NOT_RUN — миграция, интеграционный тест и просмотр глазами за пользователем
Переход к следующему этапу: НЕ РАЗРЕШЁН АВТОМАТИЧЕСКИ

## Исходная проблема

После этапа 20A данные реестра собирались, но нигде не были видны: снимок лежал в `registry_records`,
карточка объекта его не читала, а в каноне запись реестра существовать не могла — `assertions.origin`
допускал только `extraction`, `legacy_import` и `manual`, а среди ролей участия не было застройщика.

## Изменения

Миграция `docs/migrations/026_registry_canon.sql` (additive, только расширение допустимых значений):
`registry` в `assertions.origin`, `evidence.origin`, `entity_identifiers.origin`; роль `developer`
в `assertions_role_check` и в ветке `participates_in_project` ограничения `assertions_predicate_shape`.

Новое:

| Файл | Содержание |
|---|---|
| `backend/src/registry/publish.ts` | `registry-publish@1`: компания по реквизиту, объект, роль застройщика, связь с группой; цитата — целая строка рендера через `locateQuote`; не нашлась — утверждения нет |
| `backend/src/registry/changes.ts` | разница двух снимков (чистая функция); появление и исчезновение поля — тоже изменение |
| `backend/src/registry/read.ts` | чтение снимков для карточки объекта и компании, список объектов застройщика, текст атрибуции |
| `backend/src/registry/canon.test.ts` | 5 офлайн-проверок разницы снимков (T20B-01) |
| `frontend/src/components/RegistryPanel.tsx` (+`.module.css`) | блок «Данные реестра»: дата сведений, атрибуция, поля, «что изменилось» |
| `frontend/src/components/registryPanel.test.tsx` | 5 компонентных проверок, в т. ч. отсутствие слова «проверено» |

Правки: `assertions/repository.ts` (тип `AssertionOrigin`), `resolve/identifiers.ts` и
`resolve/company.ts` (`identifierOrigin` — происхождение реквизита при создании компании,
по умолчанию прежнее `extraction`), `config/env.ts` и `backend/.env.example`
(`REGISTRY_PUBLISH_ENABLED`, по умолчанию true), `ingest/registry/crawler.ts` (публикация отдельной
транзакцией после записи редакции, счётчики в покрытии), `ingest/registry/profile.ts` и `map.ts`
(`projectKind` — вид объекта задаёт профиль, а не догадка кода), `dossier/projectDossier.ts` и
`api/companies.routes.ts` (блок `registry` в ответах), `frontend/src/api/types.ts`,
`frontend/src/lib/labels.ts` (`developer` → «застройщик»), `ProjectPage.tsx`, `CompanyPage.tsx`,
шаблон профиля, `ADR-012`, `CLAUDE.md`, `TESTING_LOCAL.md` (раздел P).

Отклонено сознательно: писать в канон сроки, цену, распроданность и стадию банкротства (утверждение
неизменяемо, эти значения меняются); отдельная таблица изменений (второй источник правды);
роль `customer` вместо `developer` (расхождение роли с цитатой).

## Проверки

| Scenario ID | Файл/команда | Кем/где | Exit code | Результат | Доказательство |
|---|---|---|---|---|---|
| T20B-01 | `npx vitest run src/registry/canon.test.ts` | AGENT | 0 | PASS 5/5 | вывод vitest |
| Панель | `npx vitest run src/components/registryPanel.test.tsx` (frontend) | AGENT | 0 | PASS 5/5 | вывод vitest |
| Типы | `npm run typecheck` (backend), `npx tsc -b` (frontend) | AGENT | 0 | PASS | пустой вывод |
| Подписи | `npm run check:labels` | AGENT | 0 | PASS, 47 файлов | вывод скрипта |
| Регрессия frontend | `npm test` (frontend) | AGENT | 0 | PASS 25/25 (до добавления панели) | вывод vitest |
| T20B-02 | `npm run test:integration -- src/ingest/registry/registry.int.test.ts` | USER | Не получен | NOT_RUN | Не получено |
| Миграция 026 | `npm run migrate -- --dry`, `npm run migrate` | USER | Не получен | NOT_RUN | Не получено |
| Просмотр глазами, 390 px | `TESTING_LOCAL.md` P2 | USER | Не получен | NOT_RUN | Не получено |

**Отдельно о регрессии backend.** `npm test` на момент отчёта даёт 1 падение —
`src/release/manifest.test.ts`: таблица `revision_headlines` из миграции `027_revision_headlines.sql`
не внесена в `release/manifestSpec.ts`. Эта миграция и модуль `backend/src/headline/` появились в
рабочем дереве **параллельно, из другой сессии** (файлы созданы 15:12–15:17, мои — 14:45). К этапам
20A/20B отношения не имеет; `registry_records` в перечне присутствует и проверку проходит.
Не исправлялось: чужая незавершённая работа не трогается.

## Неизменённые ограничения

Рабочая БД, `.env`, допуски источников, фоновые флаги, слияние и модель не трогались. Источник не
заведён и не допущен. Схема извлечения `extract@3`, промпт и `PROMPT_VERSION` не менялись:
модель по-прежнему выбирает из восьми подрядных ролей. Старый путь `pipeline/apply.ts` и
`assertCanonWriteAllowed` не вызываются и не воскрешались. Прежние утверждения, решения аналитика и
снимки не затронуты: миграция только расширяет списки допустимых значений.

## Миграция и откат

`026_registry_canon.sql` — additive, в `DESTRUCTIVE_MIGRATIONS` не вносилась. Применяет пользователь.
Ограничения пересоздаются по автоматическим именам PostgreSQL (`assertions_origin_check` и др.);
если имя в базе другое, `DROP CONSTRAINT` упадёт и миграция не применится молча.

Откат без потери данных: `REGISTRY_PUBLISH_ENABLED=false` — сбор и снимки продолжаются, новых
утверждений из реестра нет, записанное остаётся. Полный откат миграции не предусмотрен: сужать CHECK
обратно можно только после удаления строк с `origin = 'registry'`, а это потеря доказательств.

## Ревью

Не проводилось.

## Открытые риски

1. **Доступ к наш.дом.рф не подтверждён** (из среды агента — 403). Этап проверялся на синтетическом
   реестре; на живых данных карта полей и качество резолва объектов не измерялись.
2. **Резолв объекта по названию** — самое слабое место: «Большая Татарская 35» в реестре и в прессе
   могут разойтись, и появится второй объект. Резолвер кладёт спорные пары в `merge_queue`, слияние
   выключено (`MERGE_APPLY_ENABLED=false`). Смотреть очередь после первых сборов.
3. **Роль `developer` в статистике подрядчиков** — участие, не договор. Проверить глазами, что экран
   подрядчиков не считает застройщика договором.
4. **Параллельная работа в одном дереве** (см. раздел «Проверки»): часть моих файлов фронтенда уже
   попала в чужой коммит `93dc53f`. Риск спутанной истории, не кода.

## Следующий шаг пользователя

`docs/development/TESTING_LOCAL.md` раздел **P** (P1 — миграция и тесты, P2 — просмотр глазами,
P3 — выключатель) и раздел **O3** — живая проба источника. Агент остановлен.
