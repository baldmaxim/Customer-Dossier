#!/usr/bin/env bash
#
# Выпуск TG_Info на сервер одной командой — с машины разработки, где есть Docker и `ssh quantor`
# (Linux или Git Bash на Windows). Порядок и объяснения — deploy/README.md, «Обновление».
#
#   deploy/release.sh          # собрать текущий HEAD и выкатить
#   deploy/release.sh --check  # только проверить, что выпуск возможен (ничего не собирает)
#
# Шаги: дерево чистое и коммит на origin → образы tginfo-api/tginfo-web:<sha> → docker load на
# сервере → свежие compose и скрипты → update.sh <sha> (миграции, перезапуск, проверка) →
# ответ портала снаружи → уборка старых образов (остаются текущий и предыдущий — для отката).
#
# .env на сервере скрипт не трогает. Destructive-миграции update.sh не применяет — выпуск остановится.
set -euo pipefail

HOST="${TGINFO_HOST:-quantor}"
REMOTE_DIR=/opt/portals/tg-info
PUBLIC_URL="${TGINFO_URL:-https://pulse.meridianai.ru}"

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# Образ обязан соответствовать коммиту: незакоммиченное и неотслеживаемое в собираемых каталогах
# попало бы в образ, а тег сказал бы, что это <sha>.
dirty="$(git status --porcelain -- backend frontend docs/migrations deploy)"
if [ -n "$dirty" ]; then
  echo "В собираемых каталогах есть незакоммиченные файлы — сначала коммит:"
  echo "$dirty" | head -20
  exit 1
fi
TAG="$(git rev-parse --short=7 HEAD)"
git fetch -q origin
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "Коммит ${TAG} не на origin/main — сначала push: выпуск должен быть воспроизводим из репозитория."
  exit 1
fi
ssh -o BatchMode=yes "$HOST" "test -f ${REMOTE_DIR}/.env" || { echo "На ${HOST} нет ${REMOTE_DIR}/.env — это первая выкладка, см. README."; exit 1; }
echo "→ выпуск ${TAG} на ${HOST}"
[ "${1:-}" = "--check" ] && { echo "проверка пройдена, ничего не собиралось"; exit 0; }

echo "→ сборка образов"
# Сеть сборки — сеть этой машины: в контейнерах сборки Docker подставляет DNS 8.8.8.8, а он отсюда не
# отвечает — npm ci висел без единого байта; пока слой с зависимостями брался из кэша, этого не было видно.
docker build -q --network=host -f deploy/Dockerfile --target api -t "tginfo-api:${TAG}" .
docker build -q --network=host -f deploy/Dockerfile --target web -t "tginfo-web:${TAG}" .

echo "→ перенос образов"
docker save "tginfo-api:${TAG}" "tginfo-web:${TAG}" | gzip | ssh "$HOST" 'gunzip | docker load'

echo "→ compose и скрипты"
scp -q deploy/docker-compose.yml deploy/Dockerfile.domrf deploy/update.sh deploy/compose.sh deploy/backup.sh deploy/tginfo.env.example \
  "${HOST}:${REMOTE_DIR}/"
ssh "$HOST" "chmod 750 ${REMOTE_DIR}/update.sh ${REMOTE_DIR}/compose.sh ${REMOTE_DIR}/backup.sh"

ssh "$HOST" "${REMOTE_DIR}/update.sh ${TAG}"

echo -n "→ снаружи: "
code="$(curl -sS -o /dev/null -w '%{http_code}' "${PUBLIC_URL}/api/health" || true)"
echo "${PUBLIC_URL}/api/health → ${code}"
[ "$code" = 200 ] || { echo "портал снаружи не отвечает 200 — смотрите ./compose.sh logs api и infra-nginx"; exit 1; }

echo "→ уборка старых образов на сервере (остаются два последних)"
# Поимённо, не prune: на сервере живут образы Quantor. Образ работающего контейнера docker не удалит.
ssh "$HOST" 'for repo in tginfo-api tginfo-web tginfo-domrf; do
  docker images "$repo" --format "{{.Tag}}" | tail -n +3 | xargs -r -I{} docker rmi "$repo:{}" >/dev/null 2>&1 || true
done; docker images --format "{{.Repository}}:{{.Tag}}" | grep ^tginfo-'
# Локально держим только что собранное: на сервере уже есть копия, а откат — предыдущий тег там.
for repo in tginfo-api tginfo-web; do
  docker images "$repo" --format '{{.Tag}}' | grep -vx "$TAG" | xargs -r -I{} docker rmi "$repo:{}" >/dev/null 2>&1 || true
done

echo
echo "выпущено: ${TAG}"
