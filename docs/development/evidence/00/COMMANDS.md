# Этап 00 — фактически выполненные команды

Дата: 2026-09-11, ~15:50–16:25 (+02:00). Исполнитель: Claude Code (Opus 5, 1M), одна пишущая сессия
+ один read-only помощник (Explore) для первичного аудита кода; все его выводы перепроверены чтением файлов.

Только read-only команды и распаковка пакета заданий. Значения секретов не выводились:
по `.env` получены **только имена ключей** и признак «задан/пуст».

| ID | Команда (сокращённо) | Окружение | Exit | Наблюдение |
|---|---|---|---|---|
| E00-01 | `ZipFile::OpenRead(...).Entries` | PowerShell 5.1 | 0 | 40 записей пакета, чтение без распаковки |
| E00-02 | `Expand-Archive <zip> -DestinationPath prompts` | PowerShell | 0 | `prompts/Customer_Dossier_Prompts/` создан |
| E00-03 | сверка `SHA256SUMS.txt` через `Get-FileHash` | PowerShell | 0 | ok=39, bad=0. SHA-256 zip: `039996DA…D290` |
| E00-04 | `node --version`, `npm --version`, `git --version`, `Get-Command psql` | PowerShell | 0 | Node v24.14.1, npm 11.11.0, git 2.53.0.windows.2, psql в scoop (PostgreSQL 18.3) |
| E00-05 | `Get-NetTCPConnection -LocalPort 5432,1234,4100,5173 -State Listen` | PowerShell | 0 | 5432 слушает (владельцы: `wslrelay`, `com.docker.backend`); 1234/4100/5173 — нет |
| E00-06 | `Get-Service postgres*`, `Get-Process "LM Studio","lms"` | PowerShell | 0 | Windows-службы PostgreSQL нет; процесса LM Studio нет |
| E00-07 | `Test-Path .env, backend/.env, backend/.env.example, frontend/.env` | PowerShell | 0 | есть корневой `.env` и `backend/.env.example`; `backend/.env` и `frontend/.env` отсутствуют |
| E00-08 | разбор корневого `.env`: только имена ключей | PowerShell | 0 | единственный ключ `TG_BOT_TOKEN` (задан). `DATABASE_URL` в файле нет |
| E00-09 | `[Environment]::GetEnvironmentVariable(...)` для DATABASE_URL, PG*, TZ, TG_BOT_TOKEN, LMSTUDIO_BASE_URL, DOTENV_CONFIG_PATH, NODE_ENV (Process/User/Machine) | PowerShell | 1* | ни одна не задана. *exit 1 от последующего `Get-Process postgres` без результата, не от проверки переменных |
| E00-10 | `git status --short`, `git log`, `git rev-parse HEAD`, `git remote -v`, `git branch -a`, `git status -sb` | Git Bash | 0 | HEAD `6431a5b`, 22 коммита, `main...origin/main` без расхождения (по локальным ref, без fetch); untracked только zip и `prompts/` |
| E00-11 | `git ls-files \| wc -l`, `wc -l` по backend/src и миграциям | Git Bash | 0 | 111 отслеживаемых файлов; backend+SQL 9129 строк |
| E00-12 | `npm ls --depth=0` в backend и frontend | Git Bash | 0 / 0 | зависимости установлены, дерево без ошибок (версии в 00_REPORT) |
| E00-13 | `grep -c hasInstallScript` по lock-файлам | Git Bash | 0 | install-скрипты: frontend 3, backend 2 (учесть при `npm ci` в этапе 01) |
| E00-14 | `git check-ignore -v prompts docs/development` | Git Bash | 1 | не игнорируются (exit 1 = нет совпадений) |
| E00-15 | поиск в `frontend/dist/sw.js` | Grep | 0 | собранный SW содержит правило `\/api` NetworkFirst и кэш Google Fonts |
| E00-16 | `Get-Date` | PowerShell | 0 | 2026-09-11 16:22 +02:00 |

## Не выполнялось (осознанно)

| Проверка | Статус | Причина |
|---|---|---|
| `npm test` / `npm run build` (backend, frontend) | NOT_RUN | Этап 00 запрещает test/build scripts до изоляции (запись `dist`, `tsbuildinfo`; setup наследует внешний `DATABASE_URL`) |
| `npm run migrate -- --dry` | NOT_RUN | `--dry` выполняет `CREATE TABLE IF NOT EXISTS schema_migrations` до проверки dry (`migrate.ts:38`) |
| `npm run dev` | NOT_RUN | стартует ingest/pipeline/metrics без флагов (`index.ts:83-85`) |
| `ingest:once --env-check / --probe`, `pipeline:once --check` | NOT_RUN | запуск кода приложения и живые сетевые запросы; вне этапа |
| Подключение к PostgreSQL на :5432 (`psql`) | NOT_RUN | DSN в проекте не задан; чья это БД (WSL/Docker) и рабочая ли она — неизвестно |
| Запрос к LM Studio | NOT_RUN | сервер не запущен (порт 1234 не слушает) |
| Визуальная проверка UI / PWA | NOT_RUN | портал не запускался |
| Сверка с `Customer-Dossier-main.zip` / reviewed-архивом по хешу | NOT_RUN | архивов в рабочей папке нет; есть только отпечатки в пакете |
