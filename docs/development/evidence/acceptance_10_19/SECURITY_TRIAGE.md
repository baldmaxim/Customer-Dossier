# Приёмка 10–19 — разбор безопасности зависимостей (sharp)

Статус: **NOT_VERIFIED** — свежего audit-JSON нет. Ниже — прочитанное из lock-файла и кода; advisory требует отчёта пользователя.
Исключение риска утверждает владелец, не агент. `npm audit fix` / `install` / `update` не выполнялись и не рекомендуются.

## Карточка
| Поле | Значение |
|---|---|
| Пакет и версия | `sharp@0.34.5` (resolved из registry), в `frontend/package-lock.json`: `dev: true`, `hasInstallScript: true`; нативная часть на машине агента — `@img/sharp-win32-x64@0.34.5` (содержит libvips); в lock также варианты для других платформ |
| Где объявлен | прямая devDependency `frontend/package.json` (`^0.34.5`). В `backend` пакета нет |
| Advisory | **не установлено по отчёту**. При установке зависимостей этапа 18 (17.09) `npm audit` на машине агента показал: `sharp <=0.35.4-rc.0`, «inherited vulnerabilities in libvips» CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (GHSA-f88m-g3jw-g9cj) и «vulnerabilities in libheif» GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545 (GHSA-rgj7-g3m4-5g8c); fix — `sharp@0.35.4` (major по подсказке npm). JSON не сохранён — **использовать только после повтора A3** |
| Цепочка | прямая: корень `frontend` → `sharp` → `@img/sharp-*` (нативные libvips/libheif) |
| Где исполняется | 1) **установка**: install-скрипт `node install/check.js || npm run build` при `npm ci`/`npm install` в `frontend`; 2) **явный генератор** `npm run icons:generate` (`frontend/scripts/generate-icons.mjs`). В `frontend/src`, `frontend/e2e`, `backend/src` импортов `sharp` нет; Vite-сборка его не импортирует; в бандл и API не попадает |
| Какие данные | генератор читает только `frontend/public/favicon.svg` и `favicon-maskable.svg` (отслеживаемые файлы репозитория) и пишет PNG в `public/`. Внешних изображений, URL и вложений нет: ингест не скачивает медиа, OCR не выполняется (этап 16) |
| Достижимый путь | от API, ингеста, оператора и E2E — **не установлен** (вызовов нет). Путь установки (`install/check.js`) — есть; относится ли advisory к нему — NOT_VERIFIED |
| Ограничения | Windows, локальная машина; `.env` backend не читается генератором; сеть при `npm ci` (registry) |

## Решение по конкретным действиям (предложение владельцу)
| Действие | Предложение | Основание |
|---|---|---|
| Чтение кода, документов | продолжать | sharp не исполняется |
| Backend: typecheck, unit, integration, сиды, bench, миграции | продолжать | в backend sharp нет |
| Frontend `npm test`, `npm run build`, `check:build`, `npm run e2e` при **уже установленных** `node_modules` | продолжать | sharp не импортируется тестами, Vite и Playwright |
| Frontend `npm ci` (переустановка) | допустимо после A3; install-скрипт sharp проверяет/собирает нативный модуль, декодирования изображений нет — применимость advisory к установке NOT_VERIFIED | решение владельца после отчёта |
| `npm run icons:generate` на файлах репозитория | **не выполнять до A3**; при необходимости — только на неизменённых `favicon*.svg`, после решения владельца | путь к libvips достижим, вход доверенный |
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

## Прочие зависимости
Отчёт audit для backend на `d33521b` отсутствует — NOT_VERIFIED. Новые dev-зависимости этапа 18 (vitest, jsdom, Testing Library,
Playwright) в runtime и бандл не входят; браузер Playwright скачивается пользователем отдельно (`npx playwright install chromium`).
