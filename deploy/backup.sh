#!/usr/bin/env bash
#
# Ежедневная копия базы TG_Info: pg_dump -Fc рядом с порталом, хранится 14 дней.
# Ставится в cron на сервере — см. deploy/README.md. База копируется целиком: редакции,
# доказательства, решения аналитика и снимки связаны между собой и по отдельности
# не восстанавливаются (docs/development/LOCAL_RUNBOOK.md).
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)/backups"
mkdir -p "$dir"
file="$dir/tg_info-$(date +%Y%m%d-%H%M).dump"

docker exec tginfo-db pg_dump -U tg_info -Fc --no-owner tg_info > "$file.part"
mv "$file.part" "$file"
find "$dir" -name 'tg_info-*.dump' -mtime +14 -delete
