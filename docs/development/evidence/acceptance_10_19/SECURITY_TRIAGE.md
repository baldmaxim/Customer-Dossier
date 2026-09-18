# Приёмка 10–19 — разбор безопасности зависимостей (sharp)

Статус: **VERIFIED по отчёту пользователя A3 (2026-09-17)** — sharp (ограничение принято владельцем); backend `qs`/`express` — **открыто, достижимый путь, решение владельца (ACC-04)**.
Отчёты: `A3-npm-explain-sharp.log`, `A3-npm-audit-frontend.json`, `A3-npm-audit-frontend-prod.json`, `A3-npm-audit-backend.json` на машине пользователя.
Исключение риска утверждает владелец, не агент. `npm audit fix` / `install` / `update` не выполнялись и не рекомендуются.

## Карточка
| Поле | Значение |
|---|---|
| Пакет и версия | `sharp@0.34.5` (resolved из registry), в `frontend/package-lock.json`: `dev: true`, `hasInstallScript: true`; нативная часть на машине агента — `@img/sharp-win32-x64@0.34.5` (содержит libvips); в lock также варианты для других платформ |
| Где объявлен | прямая devDependency `frontend/package.json` (`^0.34.5`). В `backend` пакета нет |
| Advisory | подтверждено отчётом A3: severity **high**, `isDirect: true`, range `<=0.35.4-rc.0`, `fixAvailable: sharp@0.35.4, isSemVerMajor: true`. Два `via`: **GHSA-f88m-g3jw-g9cj** (`<0.35.0`, libvips: CVE-2026-33327, -33328, -35590, -35591) и **GHSA-rgj7-g3m4-5g8c** (`<0.35.4`, libheif: GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545). Оба — обработка недоверенных изображений; уязвимость установки или сборки не заявлена |
| Цепочка | прямая: корень `frontend` → `sharp` → `@img/sharp-*` (нативные libvips/libheif) |
| Где исполняется | 1) **установка**: install-скрипт `node install/check.js || npm run build` при `npm ci`/`npm install` в `frontend`; 2) **явный генератор** `npm run icons:generate` (`frontend/scripts/generate-icons.mjs`). В `frontend/src`, `frontend/e2e`, `backend/src` импортов `sharp` нет; Vite-сборка его не импортирует; в бандл и API не попадает |
| Какие данные | генератор читает только `frontend/public/favicon.svg` и `favicon-maskable.svg` (отслеживаемые файлы репозитория) и пишет PNG в `public/`. Внешних изображений, URL и вложений нет: ингест не скачивает медиа, OCR не выполняется (этап 16) |
| Достижимый путь | от API, ингеста, оператора и E2E — **не установлен** (вызовов нет). Путь установки (`install/check.js`) существует, но оба advisory описывают декодирование изображений, а не установку. В production-аудите (`--omit=dev`) sharp отсутствует: 0 уязвимостей |
| Ограничения | Windows, локальная машина; `.env` backend не читается генератором; сеть при `npm ci` (registry) |

## Решение по конкретным действиям (предложение владельцу)
| Действие | Предложение | Основание |
|---|---|---|
| Чтение кода, документов | продолжать | sharp не исполняется |
| Backend: typecheck, unit, integration, сиды, bench, миграции | продолжать | в backend sharp нет |
| Frontend `npm test`, `npm run build`, `check:build`, `npm run e2e` при **уже установленных** `node_modules` | продолжать | sharp не импортируется тестами, Vite и Playwright |
| Frontend `npm ci` (переустановка) | **допустимо** (решение владельца 2026-09-17 по отчёту A3) | advisory касаются декодирования изображений, не установки |
| `npm run icons:generate` на файлах репозитория | **оставлен выключенным** (решение владельца 2026-09-17); при необходимости — отдельное решение и только на неизменённых `favicon*.svg` | путь к libvips/libheif достижим, вход доверенный |
| Обработка внешних изображений любым путём | **запрещено** (такого пути в коде нет; не добавлять) | high в декодере |
| Пилот (этап 19) | sharp не блокирует, пока выполняются условия выше | runtime-пути нет |

Уязвимость остаётся открытой независимо от решения. Варианты исправления — отдельной задачей через промт 04 после A3: обновление
sharp с проверкой генератора и сборки; вынос генератора в отдельный пакет/изоляцию; удаление зависимости с хранением готовых PNG.

## Команды пользователю (A3)
`npm audit` передаёт перечень зависимостей в настроенный registry. Ненулевой exit при найденных уязвимостях — ожидаемый результат диагностики.
```powershell
# cwd: TG_Info\frontend. Ничего не устанавливает и не меняет.
$L = "$env:USERPROFILE\tg-info-acceptance-1019"; New-Item -ItemType Directory -Force $L | Out-Null
npm explain sharp 2>&1 | Out-File -Encoding utf8 "$L\A3-npm-explain-sharp.log"; "exit=$LASTEXITCODE" | Add-Content "$L\A3-npm-explain-sharp.log"
npm audit --json 2>$null | Out-File -Encoding utf8 "$L\A3-npm-audit-frontend.json"; "exit=$LASTEXITCODE" | Out-File -Encoding utf8 "$L\A3-npm-audit-frontend.exit"
npm audit --omit=dev --json 2>$null | Out-File -Encoding utf8 "$L\A3-npm-audit-frontend-prod.json"
cd ..\backend; npm audit --json 2>$null | Out-File -Encoding utf8 "$L\A3-npm-audit-backend.json"
```
Передать: JSON-файлы (в них нет токенов; `.npmrc` не прикладывать). По ним заполняются «Advisory» и «Решение».

## Backend: `qs` и `express` (открыто, ACC-04)
| Поле | Значение |
|---|---|
| Пакеты | `express@4.22.2` (прямая, `isDirect: true`, via `qs`), `qs@6.15.3` (транзитивная). В lock также `body-parser/node_modules/qs@6.16.0` — уже исправленная версия |
| Advisory | **GHSA-x5fp-wj9c-mxmx** — обход `arrayLimit` через bracket-key comma parsing, `>=6.14.2 <=6.15.3`; **GHSA-4mjr-xmp4-gh2g** — DoS через управляемый атакующим `isBuffer`, `>=2.2.5 <6.16.0`. Severity moderate, `fixAvailable: true` |
| Почему не обновляется «само» | `express@4.22.2` требует `qs ~6.15.1`, исправление — `6.16.0`: нужен другой `express` (или override) |
| Где исполняется | `backend/src/app.ts`: Express 4 по умолчанию разбирает **каждую** строку запроса через `qs` (`query parser = extended`), до входа оператора; маршруты читают `req.query` через zod. `express.urlencoded` не подключён (тело — только JSON) |
| Какие данные | строка запроса любого HTTP-запроса к API на loopback (`requireLoopbackHost` и Origin-guard стоят до маршрутов, но GET без Origin с loopback проходит) |
| Достижимый путь | **есть**: локальный процесс или страница, способная отправить запрос на `127.0.0.1:4100` |
| Ограничения | только loopback; один оператор; вложенные параметры и массивы в запросах приложением не используются (все схемы — плоские строки/числа) |

Варианты для промта 04 (решение владельца):
1. **Код без смены зависимостей:** `app.set('query parser', 'simple')` — строка запроса разбирается `node:querystring`, `qs` из этого пути уходит.
   Подходит, потому что схемы плоские; повторённый ключ даёт массив → zod отвечает 400. Нужны: unit на 400 для `a[b]=1`/повтора ключа, повтор A1 и B1.
2. **Зависимость:** обновить `express` до версии с `qs >=6.16.0` (или `overrides` на `qs`) — меняется `backend/package-lock.json`, `npm ci` (сеть), повтор A1, B1, C.
3. Оба: 1 сразу как устранение пути, 2 — плановым обновлением.

До решения: B-шаги (синтетика в тестовой цели, API в том же процессе) не блокируются; **пилот (E) — не начинать, пока ACC-04 не закрыт или не принято исключение.**

## Прочие зависимости

Новые dev-зависимости этапа 18 (vitest, jsdom, Testing Library, Playwright) в runtime и бандл не входят; браузер Playwright
скачивается пользователем отдельно (`npx playwright install chromium`). По отчёту A3 других уязвимостей, кроме перечисленных
(frontend: 1 high в `sharp`; backend: 2 moderate в `qs` и `express`), не заявлено.
