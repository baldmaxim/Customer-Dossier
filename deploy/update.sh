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
# Порядок: образы на месте → база → план миграций → миграции (destructive — отказ) →
# перезапуск → проверка, что оба контейнера из одной сборки и API отвечает.
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

"${COMPOSE[@]}" up -d db

echo "→ план миграций"
"${COMPOSE[@]}" --profile tools run --rm migrate node dist/db/migrate.js --dry
echo "→ миграции"
# Destructive-миграция здесь останавливает выкладку: её применяют руками после копии базы.
"${COMPOSE[@]}" --profile tools run --rm migrate

"${COMPOSE[@]}" up -d --force-recreate api web

echo "→ из чего собраны контейнеры:"
fail=0
for name in api web; do
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
