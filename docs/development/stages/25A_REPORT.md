# Отчёт этапа 25A — сайты компаний: веб-поиск находит, человек подтверждает

Дата: 2026-10-06. Ветка: `company-sites` (worktree `TG_Info-sites`) поверх `origin/main` `835c26f`.

## Статусы

IMPLEMENTED: ДА
CODE_CHECKED: ДА — backend `tsc --noEmit`, `vitest --maxWorkers=1` 958/958 (87 файлов, до тестов 25A — 908);
frontend `tsc -b`, `vitest --maxWorkers=1` 443/443, `build` + `check:build`, `check:labels`
REVIEWED: NOT_RUN
USER_VALIDATED: NOT_RUN — интеграционный тест, миграция 045 и проба веб-поиска на сервере (TESTING_LOCAL.md §U)

## Задача

Владелец (06.10.2026): «нейронка пробегает по интернету в поисках личных сайтов компаний, человек подтверждает и
привязывает их к заказчикам, оттуда видим объекты». Решения: поиск — веб-плагин OpenRouter, push-уведомлений нет,
проверка найденного сайта до подтверждения разрешена. 25A — найти и подтвердить; чтение сайта — 25B. Заменяет «24G».

## Изменения

Миграция `045_company_sites.sql`: `company_site_searches`, `company_site_candidates`, `site_search_requests`.

| Файл | Содержание |
|---|---|
| `backend/src/llm/siteSearch/{prompt,schema}.ts` | `site-search@1`: запрос одной строкой, правила в system, строгая схема `{sites[], none_reason}` |
| `backend/src/llm/client.ts` | `IExtractSpec.plugins` (только у `SITE_SEARCH_SPEC`), цитаты из `annotations`, отказ без OpenRouter, `extractSiteSearch` — одна попытка |
| `backend/src/companySites/url.ts` | адрес сайта (origin, без IP/порта), стоп-лист справочников и СМИ, `acceptCandidates` — хост из выдачи |
| `backend/src/companySites/verify.ts` | проверка кандидата: главная + ≤ 3 страницы «Контакты / О компании», признаки ИНН/ОГРН/названия, другие ИНН |
| `backend/src/companySites/store.ts` | очередь с арендой, резерв лимита, кандидаты, решения, списки |
| `backend/src/companySites/search.ts` | проход поиска (лимит, повтор при ответе не по схеме), проход проверки |
| `backend/src/companySites/cli.ts` | `npm run site-search -- --status / --probe <ИНН> / --pass / --check` |
| `backend/src/api/companySites.routes.ts` | `GET /companies/:id/site`, `/admin/company-sites[/summary]`, поиск, вручную, решения |
| `frontend/src/components/company/CompanySite.tsx` | «Сайт компании» на «Сведениях» |
| `frontend/src/components/companySite/*` | строки кандидатов, признаки, «Указать вручную / Искать снова», действия |
| `frontend/src/pages/admin/CompanySitesPage.tsx`, `components/admin/CompanySites*.tsx` | очередь `/admin/sources/company-sites`, вход на «Сайтах» |

Правки: `index.ts` (проход поиска — последним в тике разбора, проверка — в тике сбора), `jobs.ts`, `config/env.ts`
(`SITE_SEARCH_*`), `app.ts`, `auth/routePolicy.ts` (+ тест), `resolve/entityMerge.ts` (перенос, `dependencyState`,
счётчик предпросмотра), `release/manifestSpec.ts` и `inventory.ts`, `__tests__/setup.ts`, `db/testTargetBootstrap.ts`,
`.env.example`, `deploy/tginfo.env.example`, `lib/labels.ts`, `api/types.ts`, фикстуры карточки.

## Тесты

- unit: `llm/siteSearch/siteSearch.test.ts` (схема, запрос, плагин только у поиска, цитаты, отказ без OpenRouter),
  `companySites/url.test.ts`, `verify.test.ts` (фикстуры страниц: ИНН на контактах, чужой ИНН, ИНН внутри числа,
  запрет/недоступность/редирект/не HTML/JS), `search.test.ts` (лимит, повтор, сбой, проба без записи), `routePolicy`.
- frontend: `companySite.test.tsx` (оператор/читатель/сайт группы), `companySitesPage.test.tsx`.
- int (пишет пользователь): `companySites/companySites.int.test.ts` — очередь, решения, лимит, фильтры, слияние.
  Правило «у группы сайт подтверждён — СЗ не ищем» в int-тесте проверено только на выполнимость запроса: утверждение
  «входит в группу» в тесте создаётся лишь публикацией реестра.

## Не проверено

- Живой ответ OpenRouter: приходят ли `annotations` вместе со строгой JSON-схемой, принимает ли маршрут с
  `require_parameters` плагин. До пробы флаг не включать (§U2).
- Доступ сервера к сайтам компаний (Selectel) и доля сайтов, закрытых от программ (`blocked`).
