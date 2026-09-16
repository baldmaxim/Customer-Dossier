# Карта актуального архива
Пути относительно корня приложения. Перед изменением проверить актуальную ветку; название функции важнее номера строки. Это навигация, не требование переписать перечисленные модули.

| Область | Основные пути | Этапы |
|---|---|---|
| История и текущая готовность | `docs/development/STATE.md`, `HANDOFF.md`, `RELEASE_READINESS.md`, `evidence/09/USER_RUN.md` | 10,19 |
| Старые инструкции | `CLAUDE.md`, `README.md`, `docs/development/BACKLOG.md` | 10,14A |
| Схема и guards | `backend/src/db/migrate.ts`, `testTarget.ts`, миграции 001–020 | 10,11,13 |
| Проверки установки/замеры | `backend/src/release/{inventory,bench,cli}.ts` | 10,18 |
| Создание/исполнение запуска | `backend/src/reprocess/{provider,runs,worker,chunking}.ts` | 11,14A,15B |
| Semantic candidates/publication | `backend/src/reprocess/semantic/{verify,assemble,benchmark}.ts`, `reprocess/{candidates,publish,publishContent}.ts` | 11,12,14A,14B |
| Модель/схема | `backend/src/llm/client.ts`, `llm/semantic/{prompt,schema}.ts` | 11,14A,14B |
| Legacy comparison | `backend/src/pipeline/compare.ts` и CLI с shadow/compare | 14A |
| Досье и фильтрация фактов | `backend/src/dossier/caseDossier.ts`, `facts.ts`, `load.ts`, соседние builders | 12,13,17 |
| Сигналы | `backend/src/signals/{load,refresh,context,intervals,rules}.ts` | 12,13,17 |
| Граф | `backend/src/graph/load.ts` и builder, `frontend/src/components/GraphPanel.tsx` | 12,13,17 |
| Снимки | `backend/src/snapshot/{repository,build,canonical,export}.ts`, `api/snapshot.routes.ts` | 13,17 |
| Идентичность | `backend/src/api/entities.routes.ts`, `resolve/entityMerge.ts`, normalizers | 15A |
| Запуски API | `backend/src/api/reprocess.routes.ts`, `revisions.routes.ts`, `assertions.routes.ts` | 15B |
| Сайты/Telegram | `backend/src/ingest/website.ts`, остальные adapters/store/safe fetch/policy modules | 16 |
| Проверка человеком | `frontend/src/pages/ReviewQueuePage.tsx`, `components/AssertionDetail.tsx`, `AssertionReviewPanel.tsx`, `MergeQueuePanel.tsx` | 15A,15B |
| Сведения/обращения | `frontend/src/pages/{CompanyPage,ProjectPage,CasePage,CasesPage}.tsx`, `CompanySummary.tsx` | 17 |
| Источники/администрирование | `frontend/src/pages/AdminPage.tsx`, `components/{SourceHealth,SourcePolicyEditor,RevisionHistory}.tsx` | 15B,16 |
| Snapshot UI | `frontend/src/pages/SnapshotPage.tsx`, `components/SnapshotsPanel.tsx` | 13,17,18 |
| Клиент/session/cache | `frontend/src/api/client.ts`, `hooks/useSession.ts`, `lib/cachePurge.ts`, PWA files | 18 |

В исходном архиве 222 TS/TSX, 18 integration test files и 29 unit test files. Количества новых тестов определяются фактической реализацией. Наличие файла не означает, что тест выполнялся в текущем окружении.

## Уже сделанное — не повторять как новую функцию
Версии публикаций, раздельный source policy, auth/CSRF, assertions/evidence/reviews, семантическая схема extract@3, immutable snapshots, граф, HTML/MD/JSON export, source health, HTML/RSS adapters, Telegram cursor/edit и защищённый fetch, merge preview — основа уже есть. Проверять конкретные пробелы по F-номерам.
