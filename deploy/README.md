# Выкладка TG_Info на сервер quantor (Selectel)

Решение и границы — [ADR-013](../docs/development/ADR-013-server-deployment.md). Сервер общий с Quantor
(SSH-алиас `quantor`, 2 vCPU / 4 ГБ / 50 ГБ, Ubuntu 24.04); ingress и сертификаты — его `infra-nginx`.
Адреса серверов в репозитории не хранятся. Имя портала ниже — `__DOMAIN__` (например
`radar.meridianai.ru`): оно подставляется в `nginx/tginfo.conf` и `.env` на шаге 5.

```
браузер ─HTTPS─► infra-nginx (/opt/infra/nginx, общий с Quantor)
  __DOMAIN__ → tginfo-web:8080 (статика + /api → tginfo-api:4100)
tginfo-api ─► tginfo-db                          (сеть tginfo 172.30.0.0/24)
tginfo-api ─► 172.30.0.1:1234 ─обратный SSH─► домашний ПК, LM Studio 127.0.0.1:1234
tginfo-api ─► сети Telegram ─awg0 (AmneziaWG)─► nl3 ─► t.me, api.telegram.org
сайты и реестр — напрямую с адреса сервера
```

Новых портов наружу нет: 80/443 уже у `infra-nginx`. Кто что делает: `.env`, токены, DNS, клиент
Amnezia и задача на домашнем ПК — **владелец**; остальное можно поручить агенту, по разрешению на шаг.

## Файлы

| Файл                                                      | Где на сервере                                     |
| --------------------------------------------------------- | -------------------------------------------------- |
| `docker-compose.yml`, `update.sh`, `compose.sh`, `backup.sh` | `/opt/portals/tg-info/`                        |
| `tginfo.env.example` → `.env` (chmod 600, владелец)       | `/opt/portals/tg-info/.env`                        |
| `nginx/tginfo.conf` — после выпуска сертификата           | `/opt/infra/nginx/conf.d/tginfo.conf`              |
| `host/awg0.conf.example` → `awg0.conf` (chmod 600)        | `/etc/amnezia/amneziawg/awg0.conf`                 |
| `host/sshd-llmtunnel.conf`                                | `/etc/ssh/sshd_config.d/tginfo-llmtunnel.conf`     |
| `host/llm-tunnel.ps1`                                     | домашний ПК: `C:\ProgramData\tginfo\llm-tunnel.ps1` |

Образы `tginfo-api` и `tginfo-web` собираются по `Dockerfile` на машине разработки (на сервере не
собираем: память делится с Quantor) и приходят через `docker load`.

## Первая выкладка

### 0. Снимок «до»

```bash
ssh quantor 'docker ps --format "{{.Names}} {{.Status}}"; free -m; df -h /; ss -tlnp; ufw status'
ssh quantor 'cp -a /opt/infra/nginx/conf.d /root/conf.d-backup-$(date +%F)'
```

Вывод сохранить: с ним сверяется проверка «после».

### 1. Telegram через nl3

С Selectel `t.me` и `api.telegram.org` не открываются. Владелец создаёт в приложении Amnezia нового
клиента на сервере nl3 (протокол AmneziaWG) и экспортирует конфигурацию. На quantor:

```bash
ssh quantor 'add-apt-repository -y ppa:amnezia/ppa && apt-get install -y amneziawg'
# awg0.conf — из host/awg0.conf.example и экспорта Amnezia (три правки описаны в шаблоне)
ssh quantor 'install -d -m 700 /etc/amnezia/amneziawg'   # файл кладёт владелец, chmod 600
ssh quantor 'systemctl enable --now awg-quick@awg0'
ssh quantor 'curl -4 -sS -o /dev/null -w "%{http_code}\n" https://t.me/; ip route get 8.8.8.8; ip route get 149.154.167.99'
```

Ожидание: `302`; к 8.8.8.8 — через `eth0`, к 149.154.167.99 — через `awg0`. Quantor не задет: его
трафик в Telegram не ходит.

### 2. Образы

На машине разработки, в корне TG_Info:

```bash
TAG=$(git rev-parse --short HEAD)
docker build -f deploy/Dockerfile --target api -t tginfo-api:$TAG .
docker build -f deploy/Dockerfile --target web -t tginfo-web:$TAG .
docker save tginfo-api:$TAG tginfo-web:$TAG | gzip | ssh quantor 'gunzip | docker load'
```

Сборка `web` сама прогоняет `check:build` (service worker не кэширует `/api`, секретов в бандле нет).

### 3. Каталог и `.env`

```bash
ssh quantor 'install -d -m 750 /opt/portals/tg-info/backups'
scp deploy/docker-compose.yml deploy/update.sh deploy/compose.sh deploy/backup.sh \
  deploy/tginfo.env.example quantor:/opt/portals/tg-info/
```

`.env` создаёт и заполняет **владелец на сервере**:

```bash
ssh quantor
cd /opt/portals/tg-info && cp tginfo.env.example .env && chmod 600 .env
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 36   # OPERATOR_TOKEN — его же владелец вводит на экране входа
nano .env                 # PUBLIC_ORIGIN=https://<имя>; фоновые флаги на первом запуске — false
```

Режим входа (`AUTH_MODE=token`), `HOST=0.0.0.0`, `TRUST_PROXY` и строка подключения к базе зашиты в
`docker-compose.yml`: в `.env` их не пишут.

### 4. Стек без фона

База — перенос рабочей или чистая.

**Перенос с домашнего ПК.** Там фон выключен (флаги `false`, API перезапущен), затем:

```bash
# домашний ПК, backend/:
npm run release:check -- --out before-check.json
npm run release:manifest -- --out before-manifest.json
pg_dump -Fc --no-owner -d <база> -f tg_info.dump
# перенос дампа и baseline на сервер, затем на сервере:
cd /opt/portals/tg-info
IMAGE_TAG=<TAG> docker compose -p tginfo up -d db
docker exec -i tginfo-db pg_restore -U tg_info -d tg_info --no-owner --exit-on-error --single-transaction < tg_info.dump
./update.sh <TAG>
```

`update.sh` покажет план миграций и накатит только новые. Сверка — шаг «Проверка».

**Чистая база.** Миграция 009 помечена destructive, и `update.sh` на пустой базе остановится на ней.
На пустой базе удалять нечего:

```bash
cd /opt/portals/tg-info
IMAGE_TAG=<TAG> docker compose -p tginfo up -d db
IMAGE_TAG=<TAG> docker compose -p tginfo --profile tools run --rm migrate node dist/db/migrate.js --dry
IMAGE_TAG=<TAG> docker compose -p tginfo --profile tools run --rm migrate node dist/db/migrate.js --allow-destructive
./update.sh <TAG>
```

Итог — строка `готово: <TAG>`. Дальше ручные команды — через `./compose.sh`.

### 5. Вход снаружи

DNS: A-запись `__DOMAIN__` → адрес quantor (владелец). Проверка: `dig +short __DOMAIN__`.

```bash
# сертификат: сначала пробный запуск
ssh quantor 'cd /opt/infra/nginx && docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot --agree-tos --register-unsafely-without-email \
  --dry-run -d __DOMAIN__'
# прошёл — тот же вызов без --dry-run

sed 's/__DOMAIN__/<имя>/g' deploy/nginx/tginfo.conf > /tmp/tginfo.conf
scp /tmp/tginfo.conf quantor:/opt/infra/nginx/conf.d/tginfo.conf
ssh quantor 'docker exec infra-nginx nginx -t && docker exec infra-nginx nginx -s reload'
```

До этого шага портал уже работает, но снаружи не виден: `infra-nginx` не знает имени.

### 6. Модель

На quantor — пользователь без оболочки и ограниченный ключ:

```bash
ssh quantor 'useradd -m -s /usr/sbin/nologin llmtunnel && install -d -m 700 -o llmtunnel /home/llmtunnel/.ssh'
scp deploy/host/sshd-llmtunnel.conf quantor:/etc/ssh/sshd_config.d/tginfo-llmtunnel.conf
ssh quantor 'sshd -t && systemctl reload ssh'
ssh quantor 'ufw allow in on br-tginfo from 172.30.0.0/24 to 172.30.0.1 port 1234 proto tcp'
```

Домашний ПК (владелец): ключ `ssh-keygen -t ed25519 -f C:\ProgramData\tginfo\llmtunnel_ed25519 -N ""`,
публичная часть — в `/home/llmtunnel/.ssh/authorized_keys` с префиксом из `host/sshd-llmtunnel.conf`;
`known_hosts` quantor — в `C:\ProgramData\tginfo\known_hosts`. `host/llm-tunnel.ps1` (вписать адрес) —
задача планировщика «При запуске системы» от SYSTEM, **ExecutionTimeLimit = PT0S**, перезапуск при сбое.

Проверка: `ssh quantor 'docker exec tginfo-api node dist/pipeline/cli.js --check'` — модель видна.
ПК выключен — портал и сбор работают, разбор ждёт.

### 7. Фон по одному

После каждого флага: правка `.env` → `./update.sh` → `./compose.sh logs --tail 50 api`,
`docker stats --no-stream`, `free -m`.

1. `INGEST_ENABLED=true` → `docker exec tginfo-api node dist/ingest/cli.js --stats`, здоровье источников в админке.
2. `BOT_ENABLED=true` → `docker exec tginfo-api node dist/ingest/cli.js --bot-check`.
3. `PIPELINE_ENABLED=true`, `HEADLINE_ENABLED=true` → в админке появляются разобранные редакции.
4. `METRICS_AUTO_REFRESH=true`.

Живой запрос к источнику — только при подтверждённом допуске (`ingest/policy.ts`); `--probe` —
только по допущенному каналу. Сбор на домашнем портале после переноса не включать: два сборщика по
одним каналам удваивают запросы к источникам.

### 8. Резервные копии

```bash
ssh quantor 'cat > /etc/cron.d/tginfo-backup <<"EOF"
47 3 * * * root /opt/portals/tg-info/backup.sh
EOF'
```

Quantor копируется в 03:17 — по времени не пересекаются.

## Проверка

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<имя>/api/companies        # 401 без входа
curl -sS https://quantor.meridianai.ru/health/ready                           # Quantor жив, 200
ssh quantor 'ss -tlnp; ufw status; free -m'   # новых 0.0.0.0 нет; доступно ≥ 500 МБ
```

Снаружи 5432, 4100 и 1234 закрыты. В браузере: вход по токену, поиск, карточка компании, выход;
телефон — установка PWA. Перезагрузка quantor: `awg0`, оба стека и туннель модели поднимаются сами.

Перенос базы: на сервере `docker exec tginfo-api node dist/release/cli.js --compare before-check.json` и
`node dist/release/manifestCli.js --compare before-manifest.json` (файлы — в контейнер через `docker cp`).
Ожидаемое расхождение — только `CONFIG_MISMATCH` по `HOST` (127.0.0.1 → 0.0.0.0) и флагам, которые
отличаются намеренно; всё остальное обязано совпасть.

## Обновление и откат

```bash
./update.sh <новый TAG>        # после docker load новых образов
./update.sh <предыдущий TAG>   # откат: предыдущие образы на сервере не удаляются
```

Миграции вперёд откат образа не отменяет. Уборка образов — поимённо, не `docker system prune -a`:
на сервере живут образы Quantor.

Полный откат: удалить `/opt/infra/nginx/conf.d/tginfo.conf` → `nginx -t` → `nginx -s reload`;
`./compose.sh down` (том базы остаётся); `systemctl disable --now awg-quick@awg0`; на домашнем ПК —
прежний `start-portal.ps1`.
