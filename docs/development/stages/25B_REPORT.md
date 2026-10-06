# Отчёт этапа 25B — чтение подтверждённого сайта компании, проекты на карточке

Дата: 2026-10-06. Ветка: `company-sites` (worktree `TG_Info-sites`) поверх `origin/main` `97566f2`.

## Статусы

IMPLEMENTED: ДА
CODE_CHECKED: ДА — backend `tsc --noEmit`, `vitest --maxWorkers=1` 993/993 (93 файла); frontend `tsc -b`,
`vitest --maxWorkers=1` 450/450, `build` + `check:build`, `check:labels`
INTEGRATION: ДА — на quantor во временном контейнере `postgres:18-alpine` (удалён): 352/360, новые
`companySites.int.test.ts` и `siteSources.int.test.ts` — 14/14; 8 падений «без входа — 401/403» — прежний долг
USER_VALIDATED: NOT_RUN — чтение настоящего сайта с сервера и ответ модели на настоящей странице

## Задача

Владелец: «человек подтвердит сайт и привяжет к заказчику, оттуда мы будем видеть информацию об объектах текущих или
новых». 25A находил и подтверждал сайт, но текста не хранил. 25B читает подтверждённый сайт и показывает его проекты.

## Изменения

Миграция `046_company_site_pages.sql`: `company_site_candidates.source_id`, `company_site_pages`,
`company_site_extractions` (обе — только добавление).

| Файл | Содержание |
|---|---|
| `backend/src/companySites/sources.ts` | источник `site:<хост>`, включение с основанием оператора, снятие при «Отвязать», синхронизация решений 25A |
| `backend/src/ingest/companySite/{profile,robots,links,crawler,store}.ts` | профиль `company_site`, robots.txt, ссылки на страницы проектов, обход, запись снимка с перепроверкой допуска |
| `backend/src/llm/siteProjects/{prompt,schema}.ts` | `site-projects@1`: проекты страницы с дословной цитатой |
| `backend/src/companySites/projects.ts` | выбор страниц, проверка цитат, проход модели с допуском до и после ответа |
| `backend/src/companySites/readModel.ts` | сверка проектов сайта с объектами компании, «новое», `GET /companies/:id/site-projects` |
| `frontend/src/components/company/CompanySiteProjects.tsx` | «С сайта компании» на вкладке «Объекты» |
| `frontend/src/components/company/CompanySite.tsx` | «прочитан …» и число проектов на «Сведениях» |

Правки: `ingest/sources.ts` (`setSourceEnabled` с основанием, `deleteSource` считает снимки), `ingest/crawl.ts`,
`ingest/scheduler.ts` (≤ 2 сайтов за проход), `api/admin.routes.ts` (список источников без сайтов компаний),
`companySites/store.ts` (решения заводят и снимают источник, состояние источника у кандидата), `llm/client.ts`,
`index.ts`, `jobs.ts`, `config/env.ts` (`SITE_PROJECTS_*`), манифест и инвентарь, `.env`-примеры, `labels.ts`, типы.
Тест 25A поправлен: решение возвращает и `sourceId`.

## Не проверено

- Доступ сервера к сайтам компаний (Selectel) и доля сайтов на одном JS или закрытых от программ.
- Качество `site-projects@1` на настоящих страницах (модель сервера `qwen/qwen3-30b-a3b-instruct-2507`).
