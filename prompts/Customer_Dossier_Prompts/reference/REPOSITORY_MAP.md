# Фактическая карта переданных архивов и особенности baseline

Основание: `Customer-Dossier-main.zip`, `Customer-Dossier-reviewed-2026-09-11.zip`, прежние review/spec. Проверены локально при составлении этого пакета. **Это не аудит рабочей папки пользователя**: этап 00 обязан проверить наличие кода и строки повторно.

## Стек и точки входа в inspected reviewed-копии

Backend — Express/TypeScript, pg без ORM; frontend — React/Vite/TypeScript/CSS modules. Две отдельные package.json. SQL в docs/migrations, в inspected-копии 001–009. Имена npm-пакетов остаются `tg-info-server` и `tg-info-app`; это не другой проект, переименование само по себе не требуется.

| Область | Реальные пути относительно корня |
|---|---|
| Запуск/конфигурация | backend/src/index.ts, app.ts, config/env.ts |
| Миграции | backend/src/db/migrate.ts; docs/migrations/*.sql |
| Сбор | backend/src/ingest/scheduler.ts, sources.ts, store.ts, website.ts, telegramWeb.ts, telegramBot.ts |
| Извлечение | backend/src/llm/client.ts, prompt.ts, schema.ts, vocabulary.ts |
| Конвейер | backend/src/pipeline/worker.ts, chunks.ts, apply.ts, verify.ts, recheck.ts |
| Сопоставление | backend/src/resolve/company.ts, project.ts, identity.ts, normalize.ts, merge.ts |
| API | backend/src/api/companies.routes.ts, contractors.routes.ts, admin.routes.ts, manual.routes.ts |
| Метрики | docs/migrations/007_metrics.sql; backend/src/metrics/refresh.ts, cli.ts |
| UI | frontend/src/pages/SearchPage.tsx, CompanyPage.tsx, ContractorsPage.tsx, AdminPage.tsx |
| Штатные тесты | backend/vitest.config.ts; backend/src/__tests__/setup.ts; соседние *.test.ts |
| Прежние автономные проверки | backend/scripts/offline-regression.mjs, static-audit.mjs — только в reviewed |

## Обнаруженные дополнительные ловушки при подготовке промтов

**CLAUDE.md:** новый верхний запрет на массовое переизвлечение противоречит ниже оставшемуся старому правилу «после смены промпта переразбирать всё». Ссылка на родительский `Odintsov/CLAUDE.md` не означает, что такой файл есть в вашей локальной установке. Не создавать несуществующую родительскую структуру. В этапе 01 исправить конфликт точечно.

**backend/src/index.ts:** startup вызывает startIngestScheduler, startPipelineWorker, startMetricsScheduler, а при token — runBotLoop. Поэтому обычный dev-start в этой версии — не read-only просмотр. Без изоляции он может обращаться к сети и менять данные.

**backend/src/db/migrate.ts:** runMigrations выполняет ENSURE_TABLE_SQL до проверки dryRun. `--dry` не полностью read-only. Также inspected runner вычисляет путь через три `..` из backend/src/db, что необходимо проверить и для dev, и для compiled layout, не угадывая.

**docs/migrations/009_switch_to_russia.sql:** есть `UPDATE events SET amount_rub = NULL WHERE amount_rub IS NOT NULL`. Это историческая destructive-операция. Нельзя запускать непросмотренный migration runner на неизвестной рабочей базе и нельзя переписывать применённую историю задним числом.

**backend/src/__tests__/setup.ts:** defaults выставляются через `??=`. Уже существующий DATABASE_URL может сохраниться. Значение timezone исторически Asia/Almaty, оно не доказывает текущую географию проекта и не должно влиять на новые даты молча.

**frontend/vite.config.ts:** есть runtimeCaching для `/api/` с NetworkFirst и хранением; фактическое совпадение pattern проверить в браузере. При введении auth нельзя оставлять возможность хранения закрытого досье в service worker. Во frontend есть внешние font resources; для локальной автономности не должны быть обязательны.

**store.ts:** outcome edited_skipped; content hash и source/external ID имеют разные смыслы. Нельзя просто превратить skipped в UPDATE body — это повредит старые quotes.

**apply.ts:** clearDocumentContribution удаляет mentions/events/project_participants конкретного документа. В комментариях признаётся потеря роли, дополнительно подтверждённой другим источником. Сохранять manual review надо моделью, а не просьбой «переразбирай всё».

**007_metrics.sql:** неизвестная дата подменяется current_date; court_case используется в hard events; текущим участникам присваиваются задержки объекта. UI-label patch не исправил SQL. Полное изменение в 06/07.

## Команды, реально присутствовавшие в inspected package.json

Backend: `dev`, `build`, `start`, `test`, `migrate`, `ingest:once`, `pipeline:once`, `metrics:refresh`, а в reviewed — `test:offline`, `check:syntax`. Frontend: `dev`, `build`, `preview`, `icons:generate`. Frontend test/lint/e2e scripts в inspected package.json отсутствуют: нельзя объявлять их выполненными. Новые команды сначала реально добавить на соответствующем этапе.

Прежний отчёт заявляет 41 автономную проверку и статические проверки, но не подтверждает PostgreSQL integration, полный npm build/test, live sources и реальную модель. Этот пакет **не повторяет и не повышает** тот уровень подтверждения. Все gates выполняются заново в рабочей среде пользователя.
