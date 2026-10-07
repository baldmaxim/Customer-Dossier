#!/usr/bin/env bash
#
# Обновление TG_Info на сервере (ADR-013).
#
#   ./update.sh <git-sha>   # выкатить образы tginfo-api/tginfo-web:<git-sha> (так же делается откат)
#   ./update.sh             # перевыкатить текущий выпуск из файла RELEASE
#
# Образы собираются на машине разработки и приходят через `docker load` (deploy/README.md):
# на сервере ничего не собирается. Тег выпуска — в RELEASE, .env скрипт не меняет.
#
# Порядок: образы на месте → новая сборка принимает настройки сервера → база → план миграций →
# миграции (destructive — отказ) → перезапуск → оба контейнера из одной сборки и API отвечает.
set -euo pipefail

cd "$(dirname "$0")"

TAG="${1:-$(cat RELEASE 2>/dev/null || true)}"
[ -n "$TAG" ] || { echo "Укажите выпуск: ./update.sh <git-sha>"; exit 1; }
export IMAGE_TAG="$TAG"

COMPOSE=(docker compose -p tginfo)

echo "→ выкатывается ${TAG}"
for image in tginfo-api tginfo-web; do
  docker image inspect "${image}:${TAG}" >/dev/null 2>&1 || { echo "нет образа ${image}:${TAG} — сначала docker load"; exit 1; }
done

echo -n "→ настройки сервера для новой сборки: "
# Новый код разбирает .env и зашитые в compose значения ДО миграций и замены контейнеров:
# несовместимая настройка (снятый режим входа, новый обязательный ключ) останавливает выкладку
# здесь, а не роняет работающий портал. Базе и сети проверка не нужна (--no-deps).
preflight_log="$(mktemp)"
if "${COMPOSE[@]}" run --rm --no-deps api node --input-type=module \
     -e 'await import("./dist/config/env.js")' >"$preflight_log" 2>&1; then
  echo "приняты"
  rm -f "$preflight_log"
else
  echo "НЕ приняты"
  # Сообщения EnvValueError составлены без значений: секреты из .env сюда не попадают.
  grep -m 3 -E '^[A-Za-z]*Error' "$preflight_log" || tail -n 3 "$preflight_log"
  rm -f "$preflight_log"
  echo "ВЫКЛАДКА ОСТАНОВЛЕНА до изменений: портал работает на прежнем выпуске. Поправьте .env или"
  echo "docker-compose.yml под новую сборку (deploy/README.md) и повторите."
  exit 1
fi

"${COMPOSE[@]}" up -d db

# Статистика запросов (07.10.2026): расширение — в своей схеме, чтобы release:check не считал его представления
# таблицами портала. Повтор безвреден; сбой не останавливает выкладку — без статистики портал работает.
for _ in $(seq 1 60); do "${COMPOSE[@]}" exec -T db pg_isready -U tg_info -d tg_info >/dev/null 2>&1 && break; sleep 1; done
"${COMPOSE[@]}" exec -T db psql -q -U tg_info -d tg_info -c 'CREATE SCHEMA IF NOT EXISTS monitoring' \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA monitoring' >/dev/null \
  || echo "предупреждение: pg_stat_statements не включён (статистика запросов недоступна, выкладка продолжается)"

echo "→ план миграций"
"${COMPOSE[@]}" --profile tools run --rm migrate node dist/db/migrate.js --dry
echo "→ миграции"
# Destructive-миграция здесь останавливает выкладку: её применяют руками после копии базы.
"${COMPOSE[@]}" --profile tools run --rm migrate

# Браузерный сбор ДОМ.РФ (этап 20D): образ собирается здесь из уже загруженных tginfo-api и Playwright —
# только копирование, без контекста. Выпуск до 20D (откат) такого кода не содержит — сервис тогда стоит.
domrf_services=()
if docker run --rm --entrypoint test "tginfo-api:${TAG}" -f dist/ingest/registry/domrfWorkerMain.js; then
  echo "→ образ браузерного сбора ДОМ.РФ"
  docker build -q -t "tginfo-domrf:${TAG}" --build-arg "API_IMAGE=tginfo-api:${TAG}" - < Dockerfile.domrf >/dev/null
  domrf_services=(domrf)
else
  "${COMPOSE[@]}" rm -sf domrf >/dev/null 2>&1 || true
fi

"${COMPOSE[@]}" up -d --force-recreate api web "${domrf_services[@]}"

echo "→ из чего собраны контейнеры:"
fail=0
for name in api web "${domrf_services[@]}"; do
  want="tginfo-${name}:${TAG}"
  got="$(docker inspect "tginfo-${name}" --format '{{.Config.Image}}')"
  printf '   %-12s %s\n' "tginfo-${name}" "$got"
  [ "$got" = "$want" ] || { echo "   ✗ ожидался $want"; fail=1; }
done

echo -n "→ API: "
state="нет ответа"
for _ in $(seq 1 30); do
  if docker exec tginfo-api wget -q -O /dev/null http://127.0.0.1:4100/api/health 2>/dev/null; then
    state="отвечает"
    break
  fi
  sleep 2
done
echo "$state"
[ "$state" = отвечает ] || fail=1

[ "$fail" = 0 ] || { echo; echo "ВЫКЛАДКА НЕ ЧИСТАЯ — смотрите выше; RELEASE не изменён"; exit 1; }
echo "$TAG" > RELEASE
echo
echo "готово: ${TAG}"
