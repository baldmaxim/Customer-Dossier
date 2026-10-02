# TG_Info на сервере: выкладка и обслуживание

Портал работает на **https://pulse.meridianai.ru** — сервер `quantor` (Selectel), рядом с Quantor.
Решение и его границы — [ADR-013](../docs/development/ADR-013-server-deployment.md). Первая выкладка —
30.09.2026. Всё, что узнали по дороге, — в разделе [«Грабли»](#грабли): прочитать до любых работ
на сервере.

Содержание: [где что живёт](#где-что-живёт) · [обновление](#обновление-портала) ·
[обслуживание](#обслуживание) · [туннели](#туннели) · [перенос базы](#перенос-базы) ·
[развёртывание с нуля](#развёртывание-с-нуля) · [грабли](#грабли) · [полный откат](#полный-откат)

```
браузер ─HTTPS─► infra-nginx (/opt/infra/nginx, общий с Quantor)
  pulse.meridianai.ru → tginfo-web:8080 (статика + /api → tginfo-api:4100)
tginfo-api ─► tginfo-db                          (сеть tginfo_internal 172.30.0.0/24, мост br-tginfo)
tginfo-api ─► 172.30.0.1:1234 ─обратный SSH─► домашний ПК, LM Studio 127.0.0.1:1234
tginfo-api ─► сети Telegram ─awg0 (AmneziaWG)─► nl3 ─► t.me, api.telegram.org
tginfo-api ─► адреса openrouter.ai ─awg0─► nl3 ─► OpenRouter (модель в облаке, если LLM_PROVIDER=openrouter)
сайты и реестр — напрямую с адреса сервера
```

## Где что живёт

Адреса серверов в репозитории не хранятся: они в `~/.ssh/config` (алиасы `quantor`, `nl3`).

| Что | Где | Замечание |
| --- | --- | --- |
| Сервер | `quantor`: Selectel, Ubuntu 24.04, 2 vCPU / 4 ГБ / 50 ГБ | общий с Quantor |
| Каталог портала | `/opt/portals/tg-info/` | `docker-compose.yml`, `update.sh`, `compose.sh`, `backup.sh`, `RELEASE` |
| Настройки и секреты | `/opt/portals/tg-info/.env` (chmod 600) | пишет **только владелец**; образец — `tginfo.env.example` |
| Текущий выпуск | `/opt/portals/tg-info/RELEASE` | git-sha образов; пишет `update.sh` |
| Контейнеры | `tginfo-db` (postgres:18-alpine), `tginfo-api`, `tginfo-web` | compose-проект `tginfo`, `restart: unless-stopped` |
| База | том `tginfo_db_data` → `/var/lib/postgresql` | имя базы `tg_info`, роль `tg_info` |
| Вход снаружи | `/opt/infra/nginx/conf.d/tginfo.conf` | общий `infra-nginx` Quantor, сеть `infra_web` |
| Сертификат | `/opt/infra/nginx/certbot/conf/live/pulse.meridianai.ru/` | продлевает `infra-certbot` сам |
| Резервные копии | `/opt/portals/tg-info/backups/tg_info-*.dump` | cron `/etc/cron.d/tginfo-backup`, 03:47, 14 дней |
| Туннель Telegram | `/etc/amnezia/amneziawg/awg0.conf`, `awg-quick@awg0` | клиент `amnezia-awg2` на nl3 |
| Туннель модели | пользователь `llmtunnel`, `/etc/ssh/sshd_config.d/tginfo-llmtunnel.conf`, ufw на `br-tginfo` | ключ — с домашнего ПК |
| Домашний ПК | `C:\ProgramData\tginfo\` (ключ, `known_hosts`, `llm-tunnel.ps1`), задача «TG_Info LLM tunnel» | держит туннель к LM Studio |

Режим входа (`AUTH_MODE=password`), `HOST=0.0.0.0`, `TRUST_PROXY` и строка подключения к базе зашиты в
`docker-compose.yml`, в `.env` их нет. Вход — логин и пароль пользователя (ADR-014); пользователи, роли
и журнал входа — в админке, «Пользователи».

## Обновление портала

Одной командой с машины, где есть Docker и `ssh quantor` (Linux или Git Bash на Windows), из корня
`TG_Info`:

```bash
deploy/release.sh --check   # можно ли выпускать: дерево чистое, коммит на origin, .env на сервере есть
deploy/release.sh           # выпустить текущий HEAD
```

Скрипт собирает образы `tginfo-api`/`tginfo-web:<sha>` **на машине разработки** (на сервере не собираем:
память общая с Quantor), переносит их через `docker load`, обновляет compose и скрипты, запускает
`update.sh <sha>` и проверяет `/api/health` снаружи. `update.sh` сначала даёт новой сборке разобрать
настройки сервера (`.env` и значения из compose): не приняла — выкладка останавливается **до** миграций
и замены контейнеров, портал работает на прежнем выпуске. Затем план миграций, новые миграции,
пересоздание контейнеров; `RELEASE` пишется только после чистого старта. На сервере остаются два
последних выпуска.

**Откат** — предыдущий sha (он есть на сервере): `ssh quantor '/opt/portals/tg-info/update.sh <sha>'`.
Миграции вперёд откат образа не отменяет: если выпуск менял схему, откат решается по содержимому миграции.

**Destructive-миграция** (как 009) останавливает `update.sh`: сначала копия базы (`backup.sh`), потом руками
`./compose.sh --profile tools run --rm migrate node dist/db/migrate.js --allow-destructive`, потом снова
`update.sh`.

## Обслуживание

Все команды — на сервере, в `/opt/portals/tg-info/` (`ssh quantor`, `cd /opt/portals/tg-info`).

| Задача | Команда |
| --- | --- |
| Состояние | `./compose.sh ps`, `docker stats --no-stream`, `free -m` |
| Логи API | `./compose.sh logs --tail 100 -f api` |
| Здоровье снаружи | `curl https://pulse.meridianai.ru/api/health` → `{"ok":true,"db":true}` |
| Статистика сбора | `docker exec tginfo-api node dist/ingest/cli.js --stats` |
| Запуски разбора | `docker exec tginfo-api node dist/pipeline/cli.js --runs` / `--errors` |
| Модель видна? | `docker exec tginfo-api node dist/pipeline/cli.js --check` |
| Контрольные числа | `docker exec tginfo-api node dist/release/cli.js` |

`npm run …` из CLAUDE.md внутри образа — это `node dist/<тот же путь>.js`: `ingest:once` →
`dist/ingest/cli.js`, `pipeline:once` → `dist/pipeline/cli.js`, `metrics:refresh` → `dist/metrics/cli.js`,
`release:check` → `dist/release/cli.js`, `release:manifest` → `dist/release/manifestCli.js`.

**Изменить настройку** (флаг, модель, время сессии): владелец правит `.env` → `./update.sh` без аргумента
(пересоздаёт контейнеры с новым окружением на том же выпуске).

**Фоновые задания** включаются по одному, после каждого — логи, `docker stats`, `free -m`:
1. `INGEST_ENABLED=true` — сбор; проверка — `--stats` и здоровье источников в админке.
2. `BOT_ENABLED=true` — форвард-бот (`TG_BOT_TOKEN`, `TG_BOT_ALLOWED_USER_IDS`); проверка — `--bot-check`.
   Бот на домашнем портале при этом выключен: два процесса на одном токене мешают друг другу.
3. `PIPELINE_ENABLED=true`, `HEADLINE_ENABLED=true` — разбор; нужен туннель модели.
4. `METRICS_AUTO_REFRESH=true`.

`DOMRF_BROWSER_ENABLED` в `.env` не включать: у API (Alpine) Chromium нет. Карточки ДОМ.РФ снимает отдельный
контейнер `tginfo-domrf` (этап 20D): образ Playwright с виртуальным экраном, код — из образа API того же выпуска;
`update.sh` собирает его на сервере копированием (`Dockerfile.domrf`, без контекста). Выключить — `./compose.sh stop
domrf`, лог — `./compose.sh logs --tail 50 domrf` (`[domrf] объект …`, `[domrf] застройщик …`).

**Пользователи** — учётную запись новый человек заводит сам: экран входа → «Нет доступа? Отправить
заявку» (логин, имя, пароль). Войти он сможет, когда администратор в админке → «Пользователи» → «Заявки на
доступ» одобрит заявку с ролью (по умолчанию читатель) или отклонит её (ADR-014, дополнение; миграция 033).
Там же: роль (читатель / оператор / администратор), выключить доступ, сбросить пароль; по имени — страница
пользователя: открытые входы, ключи доступа, его журнал входа.

**Ключи доступа (passkey)** — вход без пароля: «Профиль» → «Ключи доступа» → «Добавить ключ доступа» (текущий
пароль, затем Face ID / Touch ID / Windows Hello / телефон), на экране входа — «Войти с ключом доступа». Ключ
привязан к домену из `PUBLIC_ORIGIN` (миграция 034, ADR-014 дополнение 01.10.2026): по IP-адресу и без https
ключей нет, смена домена делает старые ключи бесполезными — их добавляют заново. Потерянный ключ убирает сам
пользователь или администратор на странице пользователя. Сессии в базе: перезапуск API никого не выкидывает. Из консоли — только первый
администратор и восстановление, когда войти некому:

```bash
./compose.sh exec api node dist/auth/cli.js --create-admin <логин> [--name "Имя"]   # пароль печатается один раз
./compose.sh exec api node dist/auth/cli.js --reset-password <логин>   # новый пароль, блокировка снята, входы закрыты
./compose.sh exec api node dist/auth/cli.js --list
```

Выданный пароль пользователь меняет при первом входе — до смены портал данных не отдаёт. Пароль в чат
не присылать. После 10 неудач подряд вход в учётную запись закрыт на 15 минут (сброс пароля снимает).
Заявки ограничены по адресу: 10 за 15 минут в API и зона `tginfo_auth` в `infra-nginx` (общая со входом
паролем и ключом доступа) —
`tginfo.conf` после правки кладётся на сервер руками (`scp` + `nginx -t` + `reload`, раздел о выпуске сертификата).

**Резервная копия вручную**: `./backup.sh` (то же, что cron). Проверка копии:
`docker exec -i tginfo-db pg_restore --list < backups/<файл> | grep -vc '^;'` — число элементов, не 0.

**Восстановить из копии** (затирает текущую базу — только осознанно, после свежей `./backup.sh`):

```bash
./compose.sh stop api
docker exec tginfo-db psql -U tg_info -d postgres -c 'DROP DATABASE tg_info' -c 'CREATE DATABASE tg_info OWNER tg_info'
docker cp backups/<файл>.dump tginfo-db:/tmp/r.dump
docker exec tginfo-db pg_restore -U tg_info -d tg_info --no-owner --no-privileges --exit-on-error --single-transaction /tmp/r.dump
docker exec tginfo-db rm /tmp/r.dump
./update.sh
```

**Перезагрузка сервера**: поднимается само — `awg-quick@awg0`, Docker с `restart: unless-stopped`
(оба портала и `infra-nginx`), sshd; туннель модели домашний ПК переподключает сам. После — проверка
здоровья снаружи и `curl -4 -sS -o /dev/null -w '%{http_code}' https://t.me/` на сервере (302).

**Уборка образов** — только поимённо (`release.sh` делает сам). `docker system prune -a` на сервере
запрещён: заберёт образы Quantor.

## Туннели

### Telegram через nl3 (awg0)

С Selectel `t.me` и `api.telegram.org` не открываются. Через `awg0` к nl3 идут только сети Telegram
(`AllowedIPs`); DNS и маршрут по умолчанию сервера не меняются.

- Проверка: `awg show awg0` (свежий `latest handshake`), `ip route get 149.154.167.99` → `dev awg0`,
  `ip route get 8.8.8.8` → `dev eth0`, `curl -4 https://t.me/` → 302.
- **Замена ключа** (ключ засвечен, клиент удалён): в приложении Amnezia на nl3 — новый клиент AmneziaWG в
  `amnezia-awg2` → экспорт → новый `awg0.conf` по [шаблону](host/awg0.conf.example) (правятся только `DNS`,
  `AllowedIPs`; ключи и параметры обфускации — как в экспорте) → `chmod 600` →
  `systemctl restart awg-quick@awg0` → проверка выше. Экспорт `vpn://…` — base64url от qCompress(JSON),
  текст конфига в `containers[0].awg.last_config → config`.
- Сети Telegram сверять с https://core.telegram.org/resources/cidr.txt (сверено 30.09.2026).
- **OpenRouter** тоже через `awg0`: с адреса Selectel он на любой запрос отвечает `403 Access denied by
  security policy`, с nl3 — нормально. В `AllowedIPs` — адреса `openrouter.ai` по `/32` (30.09.2026:
  `8.47.69.0`, `8.6.112.0` — так отвечает DNS сервера, `104.18.2.115`, `104.18.3.115` — так отвечают другие).
  Проверка: `curl -sS -o /dev/null -w '%{http_code}' https://openrouter.ai/api/v1/key` на сервере → 401
  (без ключа — это норма). Снова 403 — `getent ahostsv4 openrouter.ai` и дописать новые адреса.

### Модель (обратный SSH)

Домашний ПК держит `ssh -N -R 172.30.0.1:1234:127.0.0.1:1234 llmtunnel@quantor`. `172.30.0.1` — шлюз
сети `tginfo_internal`, API ходит туда по `LMSTUDIO_BASE_URL`. Пользователь `llmtunnel` без оболочки,
в `authorized_keys` — только проброс на этот адрес:

```
restrict,port-forwarding,permitlisten="172.30.0.1:1234" ssh-ed25519 AAAA… tginfo-llm-tunnel
```

- Проверка: `ss -tlnp | grep 172.30.0.1:1234` на сервере (туннель есть) и `--check` из таблицы выше.
- Туннеля нет → на домашнем ПК: задача «TG_Info LLM tunnel» запущена? LM Studio с сервером на 1234 и
  моделью `qwen/qwen3-8b`? Ручной запуск той же команды покажет ошибку.
- Модель выключена — портал и сбор работают, разбор ждёт и продолжится сам.
- Настройка домашнего ПК с нуля — [«Развёртывание с нуля», шаг 7](#7-туннель-модели).

## Перенос базы

С домашнего ПК (или между серверами). Порядок — `docs/development/LOCAL_RUNBOOK.md`, раздел 5.

**Источник** (PowerShell на ПК с базой, из корня `TG_Info`, портал остановлен):

```powershell
cd backend
npm run migrate -- --dry                                                    # «нечего применять»
npm run release:check -- --out ..\transfer\before-check.json
npm run release:manifest -- --out ..\transfer\before-manifest.json
# имя базы — из before-check.json, поле database.name (30.09.2026: tg_info_live)
docker exec tg-info-pg sh -c 'pg_dump -U "$POSTGRES_USER" -d tg_info_live -Fc --no-owner -f /tmp/tg_info.dump && pg_restore --list /tmp/tg_info.dump | grep -vc "^;"'
docker cp tg-info-pg:/tmp/tg_info.dump ..\transfer\tg_info.dump
docker exec tg-info-pg rm /tmp/tg_info.dump
npm run release:manifest -- --compare ..\transfer\before-manifest.json      # только BACKGROUND_ENABLED
Get-FileHash ..\transfer\tg_info.dump -Algorithm SHA256
scp ..\transfer\* root@<адрес quantor>:/opt/portals/tg-info/transfer/
```

**Сервер** (база `tg_info` пустая: новый том или `DROP/CREATE`, как в «Восстановить из копии»):

```bash
cd /opt/portals/tg-info
sha256sum transfer/tg_info.dump                                             # = хеш с источника
docker cp transfer/tg_info.dump tginfo-db:/tmp/tg_info.dump
docker exec tginfo-db pg_restore -U tg_info -d tg_info --no-owner --no-privileges --exit-on-error --single-transaction /tmp/tg_info.dump
docker exec tginfo-db rm /tmp/tg_info.dump
docker exec tginfo-db psql -U tg_info -d tg_info -tAc 'select count(*) from schema_migrations'   # = migrations.applied
./update.sh $(cat RELEASE)
docker cp transfer/before-check.json tginfo-api:/tmp/ && docker cp transfer/before-manifest.json tginfo-api:/tmp/
docker exec tginfo-api node dist/release/cli.js --compare /tmp/before-check.json          # совпадает
docker exec tginfo-api node dist/release/manifestCli.js --compare /tmp/before-manifest.json
```

Ожидаемые расхождения манифеста: `CONFIG_MISMATCH` по `HOST` и фоновым флагам, `BACKGROUND_ENABLED` по
`REPROCESS_AUTO_PUBLISH`, `TABLE_CONTENT` по `raw_documents` (пересчитанная `ts`, см. «Грабли»). Всё
остальное обязано совпасть. Сами тексты `raw_documents` сверяются запросом без `ts` — одинаковый на
обеих базах:

```sql
set timezone = 'UTC';
select md5(string_agg(md5(row(id,source_id,source_run_id,external_id,url,title,body,lang,published_at,
  fetched_at,updated_at,content_hash,lead_hash,body_len,duplicate_of_id,forward_from,status,attempts,
  last_error)::text), '' order by id)) from raw_documents;
```

После переноса портал на источнике не запускать: два сборщика по одним каналам удваивают запросы.
`transfer/` на сервере — удалить после сверки.

## Развёртывание с нуля

Если сервер потерян или портал переезжает. Порядок проверен 30.09.2026; кто что делает: `.env`, токены,
DNS, клиент Amnezia и домашний ПК — **владелец**; остальное — агент, по разрешению на шаг.

### 0. Снимок «до»
```bash
ssh quantor 'docker ps --format "{{.Names}} {{.Status}}"; free -m; df -h /; ss -tlnp; ufw status'
ssh quantor 'cp -a /opt/infra/nginx/conf.d /root/conf.d-backup-$(date +%F)'
```

### 1. Туннель Telegram
```bash
# linux-headers-generic: DKMS собирает модуль и под следующее ядро — иначе после перезагрузки awg0 нет
ssh quantor 'add-apt-repository -y ppa:amnezia/ppa && apt-get install -y "linux-headers-$(uname -r)" linux-headers-generic amneziawg'
ssh quantor 'awg --version; dkms status | grep amneziawg'   # 3.1+, модуль под каждое ядро в /boot
# awg0.conf — из экспорта Amnezia по шаблону host/awg0.conf.example, chmod 600
ssh quantor 'systemctl enable --now awg-quick@awg0'
```
Проверка — «Туннели → Telegram».

### 2. Каталог, файлы, `.env`
```bash
ssh quantor 'install -d -m 750 /opt/portals/tg-info/backups && install -d -m 700 /opt/portals/tg-info/transfer'
scp deploy/docker-compose.yml deploy/update.sh deploy/compose.sh deploy/backup.sh deploy/tginfo.env.example quantor:/opt/portals/tg-info/
```
`.env` — владелец, на сервере:
```bash
cd /opt/portals/tg-info && cp tginfo.env.example .env && chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
```
Модель, промпт и параметры разбора — **как у переносимой базы** (раздел `config` в `before-manifest.json`;
образец уже совпадает с базой на 30.09.2026). Фоновые флаги — `false`.

### 3. Образы
```bash
TAG=$(git rev-parse --short=7 HEAD)
docker build -f deploy/Dockerfile --target api -t tginfo-api:$TAG .
docker build -f deploy/Dockerfile --target web -t tginfo-web:$TAG .
docker save tginfo-api:$TAG tginfo-web:$TAG | gzip | ssh quantor 'gunzip | docker load'
```

### 4. База
Перенос — раздел «Перенос базы» (база поднимается `IMAGE_TAG=$TAG docker compose -p tginfo up -d db`, после
восстановления — `./update.sh $TAG`). Чистая база: миграция 009 помечена destructive, на пустой базе
удалять нечего:
```bash
IMAGE_TAG=$TAG docker compose -p tginfo up -d db
IMAGE_TAG=$TAG docker compose -p tginfo --profile tools run --rm migrate node dist/db/migrate.js --allow-destructive
./update.sh $TAG
```
Первый администратор (владелец; пароль печатается один раз в терминал, при первом входе его нужно сменить):
```bash
./compose.sh exec api node dist/auth/cli.js --create-admin <логин> --name "Имя Фамилия"
```
Если в перенесённой базе пользователи уже есть (`--list`), шаг не нужен.

### 5. Имя, сертификат, вход снаружи
DNS: A-запись `pulse.meridianai.ru` → адрес quantor (владелец), проверка `dig +short pulse.meridianai.ru`.
```bash
ssh quantor 'cd /opt/infra/nginx && docker compose run --rm --entrypoint certbot certbot certonly --webroot \
  -w /var/www/certbot --agree-tos --register-unsafely-without-email --dry-run -d pulse.meridianai.ru'
# прошёл — тот же вызов без --dry-run; сразу за ним — vhost (иначе браузер видит чужой сертификат)
scp deploy/nginx/tginfo.conf quantor:/opt/infra/nginx/conf.d/tginfo.conf
ssh quantor 'docker exec infra-nginx nginx -t && docker exec infra-nginx nginx -s reload'
```

### 6. Резервные копии
```bash
ssh quantor 'echo "47 3 * * * root /opt/portals/tg-info/backup.sh" > /etc/cron.d/tginfo-backup && /opt/portals/tg-info/backup.sh'
```

### 7. Туннель модели
Сервер:
```bash
ssh quantor 'useradd -m -s /usr/sbin/nologin llmtunnel; install -d -m 700 -o llmtunnel -g llmtunnel /home/llmtunnel/.ssh'
scp deploy/host/sshd-llmtunnel.conf quantor:/etc/ssh/sshd_config.d/tginfo-llmtunnel.conf
ssh quantor 'sshd -t && systemctl reload ssh'
ssh quantor 'ufw allow in on br-tginfo from 172.30.0.0/24 to 172.30.0.1 port 1234 proto tcp'
```
Домашний ПК, PowerShell от администратора:
```powershell
New-Item -ItemType Directory -Force C:\ProgramData\tginfo | Out-Null
ssh-keygen -t ed25519 -f C:\ProgramData\tginfo\llmtunnel_ed25519 -N '""' -C tginfo-llm-tunnel
icacls C:\ProgramData\tginfo\llmtunnel_ed25519 /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F"
# владелец — SYSTEM: иначе ssh от SYSTEM отвергает ключ как слишком открытый (на русской Windows — «NT AUTHORITY\СИСТЕМА»)
icacls C:\ProgramData\tginfo\llmtunnel_ed25519 /setowner "NT AUTHORITY\SYSTEM"
ssh-keyscan -t ed25519 <адрес quantor> 2>$null | Out-File -Encoding ascii C:\ProgramData\tginfo\known_hosts
ssh-keygen -lf C:\ProgramData\tginfo\known_hosts   # сверить с ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub на сервере
```
Строку из `llmtunnel_ed25519.pub` — в `/home/llmtunnel/.ssh/authorized_keys` на сервере с префиксом
`restrict,port-forwarding,permitlisten="172.30.0.1:1234"` (chmod 600, владелец `llmtunnel`).
`host/llm-tunnel.ps1` — в `C:\ProgramData\tginfo\` (вписать адрес), затем задача:
```powershell
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\tginfo\llm-tunnel.ps1'
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'TG_Info LLM tunnel' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'TG_Info LLM tunnel'
```

### 8. Фон по одному — раздел «Обслуживание».

### Проверка «после»
- `https://pulse.meridianai.ru` — экран входа; `/api/companies` без входа — 401; вход администратора
  работает, выданный пароль просит сменить; читатель не видит «Админку».
- `https://quantor.meridianai.ru/health/ready` — 200: Quantor не задет.
- `ss -tlnp` — наружу только 22, 80, 443; `free -m` — доступно ≥ 500 МБ.
- Перезагрузка сервера — всё поднимается само.

## Грабли

Всё это уже случилось один раз — второй раз не нужно.

1. **Telegram и OpenRouter из России.** С Selectel `t.me` и `api.telegram.org` — таймаут, OpenRouter — `403
   Access denied by security policy` даже без ключа (это не «ключ не принят»). Без `awg0` сбор каналов, бот
   и облачная модель не работают. Прокси в `safeFetch` и клиент модели не добавлять — решается сетью.
2. **AmneziaWG 3.x.** Экспорт из `amnezia-awg2` содержит параметры 3.x (`HeaderProtectionKey`, диапазоны
   `PersistentKeepalive = 25-35` и др.) — нужны `amneziawg-tools` и модуль ядра 3.1+ (PPA amnezia). Без
   `linux-headers-generic` модуль не собирается под новое ядро, и после перезагрузки туннеля нет.
3. **Major-версия PostgreSQL** на сервере = версии переносимой базы (сейчас 18): дамп 18 в 17 не
   восстанавливается. Образ 18 хранит данные в `/var/lib/postgresql/18/docker`, том монтируется на
   `/var/lib/postgresql` — старая точка `/var/lib/postgresql/data` у 18 не работает.
4. **Дампить базу по имени**, а не `POSTGRES_DB` контейнера: в `tg-info-pg` несколько баз, и первый дамп
   оказался старой копией на миграции 023. Контроль — число строк `schema_migrations` после восстановления.
5. **PowerShell 5.1 портит бинарный поток** в `>`/`<`: дамп — только `pg_dump -f` в контейнере и `docker cp`.
6. **Конфигурация разбора входит в идентичность запуска** (`LMSTUDIO_MODEL=qwen/qwen3-8b`,
   `PROMPT_VERSION=p3`, `EXTRACT_*`). Другое значение на сервере — и разобранное дома выглядит чужой
   конфигурацией. Брать из `config` в `before-manifest.json`.
7. **`raw_documents.ts` пересчитывается при восстановлении** (`to_tsvector`, зависит от локали базы: дома
   libc, на сервере ICU `ru-RU`). Манифест показывает `TABLE_CONTENT` по `raw_documents` — это ожидаемо,
   тексты сверяются запросом без `ts`. В коде `ts` не используется (поиск — `ILIKE`).
8. **Сертификат без vhost.** Пока `tginfo.conf` не положен, `infra-nginx` отвечает на `pulse` сертификатом
   Quantor — браузер показывает «Угроза безопасности», а за предупреждением открывается Quantor. vhost —
   сразу после сертификата.
9. **`nginx -t` перед каждым reload**: `infra-nginx` общий, ошибка в одном файле роняет вход обоим порталам.
10. **Chromium нет в образе API** (Alpine): браузерный сбор ДОМ.РФ — в своём контейнере `tginfo-domrf`. Сайт отвечает
    программе страницей проверки Servicepipe, фоновому Chromium — 403; Chromium с окном на Xvfb с адреса Selectel
    проходит (проба 01.10.2026). `xvfb-run` в контейнере зависает в ожидании сигнала от Xvfb — Xvfb запускается сам,
    `DISPLAY=:99`. От root Chromium стартует только с `--no-sandbox` (его ставит код). Образ Playwright — 3,5 ГБ,
    один раз; дальше выпуски копируют в него только код.
11. **Ключ туннеля для задачи от SYSTEM**: владелец файла ключа — SYSTEM, доступ — только SYSTEM и
    администраторы. Иначе OpenSSH на Windows пишет «too open» и туннель молча не поднимается.
12. **Блок `Match` в `sshd_config.d`** закрывается `Match all`: файл подключается в начале `sshd_config`, и
    без сброса блок забрал бы основные настройки. Перед reload — `sshd -t`.
13. **Смена настроек в коде** (снятый режим входа, новый обязательный ключ) ломает старт на сервере, если
    не поправить `.env`/`docker-compose.yml` тем же выпуском. `update.sh` ловит это до замены контейнеров;
    правка `deploy/` — в том же коммите, что и код.
14. **Секреты в чат не присылать**: экспорт Amnezia, `.env`, закрытые ключи. Случилось — перевыпустить
    (клиент Amnezia; пароль пользователя — `--reset-password`).
15. **Агенту в авто-режиме** выпуск сертификата и удаление базы требуют явного «разрешаю» владельца.
16. **Контур.Фокус (ADR-015)** — российский сервис: ходит с Selectel напрямую, через `awg0` его не направлять
    (в `AllowedIPs` адреса `focus-api.kontur.ru` не добавлять). Ключ — админка → Источники → Сайты → Контур.Фокус
    (в .env не обязателен). После миграции 040 и ключа: `docker exec tginfo-api node dist/focus/cli.js --probe <ИНН>` —
    имена полей ответа и строки карточки (два запроса тарифа, снимков не пишет). Без ключа фон ничего не делает.

## Полный откат

Удалить `/opt/infra/nginx/conf.d/tginfo.conf` → `nginx -t` → `nginx -s reload`; `./compose.sh down` (том
базы остаётся); `systemctl disable --now awg-quick@awg0`; удалить `/etc/cron.d/tginfo-backup`; на домашнем
ПК — прежний `start-portal.ps1` (база там цела).
