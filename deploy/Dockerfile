# syntax=docker/dockerfile:1
#
# Образы серверной выкладки TG_Info (ADR-013). Собираются на машине разработки, не на сервере:
#
#   docker build -f deploy/Dockerfile --target api -t tginfo-api:<sha> .
#   docker build -f deploy/Dockerfile --target web -t tginfo-web:<sha> .
#
# Контекст — корень TG_Info; лишнее отсекает deploy/Dockerfile.dockerignore.

# --- API: tsc → только dist, prod-зависимости и миграции ---
FROM node:24-alpine AS api-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
# Кэш npm между сборками (07.10.2026): при смене lock-файла пакеты не качаются заново целиком.
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --fund=false
COPY backend/tsconfig.json ./
COPY backend/src ./src
# Тесты и тестовые сиды в образ не идут: в бою их запускать некому и незачем.
RUN npm run build \
  && rm -rf dist/__tests__ \
  && find dist -name '*.test.js' -delete -o -name '*.test.js.map' -delete \
  && npm prune --omit=dev

FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=api-build /app/backend/package.json ./
COPY --from=api-build /app/backend/node_modules ./node_modules
COPY --from=api-build /app/backend/dist ./dist
# Раннер ищет миграции как dist/db/../../../docs/migrations.
COPY docs/migrations /app/docs/migrations
# Воркер ДОМ.РФ читает выражение разбора DOM из backend/scripts во время работы. Сам браузер
# в образ не входит (Playwright на Alpine не поддерживает Chromium): DOMRF_BROWSER_ENABLED=false.
COPY backend/scripts ./scripts
# Точка тома tg_photos: пустой именованный том при первом подключении получает владельца из образа —
# без этого каталог принадлежит root, и API под node не может записать картинку.
RUN mkdir -p /data/tg-photos && chown node:node /data/tg-photos
USER node
EXPOSE 4100
CMD ["node", "dist/index.js"]

# --- Интерфейс: сборка Vite + проверка артефакта, раздаёт nginx ---
FROM node:24-alpine AS web-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# Кэш npm между сборками (07.10.2026): при смене lock-файла пакеты не качаются заново целиком.
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --fund=false
COPY frontend/ ./
RUN npm run build && npm run check:build

FROM nginx:1.29-alpine AS web
COPY deploy/nginx/tginfo-web.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
