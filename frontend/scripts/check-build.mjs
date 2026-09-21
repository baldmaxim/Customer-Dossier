// Статическая проверка собранного фронтенда (закрытие приёмки 09): запускается после `npm run build`.
//
//   npm run check:build
//
// 1. Service worker не кэширует /api: нет runtime-маршрутов и стратегий кэширования, /api в denylist
//    офлайн-оболочки, приложение удаляет старые кэши `api` при старте и выходе.
// 2. В бандле нет значений секретов: вымышленные маркеры из TG_INFO_SECRET_MARKERS (через запятую,
//    подставляются в окружение сборки), строки подключения с учётными данными и токены бота. Имена
//    переменных секретом не являются и не запрещены.
//
// Это проверка артефакта сборки, а не браузера: поведение живого service worker проверяет пользователь.
// Значения маркеров не печатаются.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const failures = [];
const fail = message => failures.push(message);

if (!fs.existsSync(DIST)) {
  console.error('[check:build] нет dist/ — сначала npm run build');
  process.exit(1);
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const textFiles = walk(DIST).filter(f => /\.(js|mjs|css|html|json|webmanifest|map|txt)$/i.test(f));

// 1. Service worker
const sw = path.join(DIST, 'sw.js');
if (!fs.existsSync(sw)) {
  fail('нет dist/sw.js');
} else {
  const code = fs.readFileSync(sw, 'utf8');
  // Разрешён единственный маршрут — офлайн-оболочка навигации (NavigationRoute) с /api в denylist.
  const routes = code.match(/registerRoute\(/g)?.length ?? 0;
  const navigation = code.match(/registerRoute\(new \w+\.NavigationRoute\(/g)?.length ?? 0;
  if (routes !== navigation) fail('sw.js регистрирует runtime-маршруты помимо навигационной оболочки (кэширование ответов)');
  for (const strategy of ['NetworkFirst', 'CacheFirst', 'StaleWhileRevalidate', 'NetworkOnly']) {
    if (code.includes(strategy)) fail(`sw.js содержит стратегию ${strategy}`);
  }
  if (!code.includes('\\/api\\/')) fail('в sw.js нет /api в denylist офлайн-оболочки');
  const precacheApi = /url:\s*["'][^"']*\/?api\//.test(code);
  if (precacheApi) fail('в precache попал адрес /api/');
}
const purge = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'cachePurge.ts'), 'utf8');
if (!/['"]api['"]/.test(purge)) fail('cachePurge.ts не удаляет старый кэш api');
// Вход снят, выхода больше нет — остаётся очистка при старте: старые кэши `api`
// от прежних версий не должны переживать обновление.
{
  const file = 'src/main.tsx';
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full) || !fs.readFileSync(full, 'utf8').includes('purgeSensitiveCaches')) fail(`очистка кэшей при старте не вызывается (${file})`);
}

// 2. Секреты в бандле
const markers = (process.env.TG_INFO_SECRET_MARKERS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s"'`]*@/i, 'строка подключения к PostgreSQL с учётными данными'],
  [/\bbot\d{6,}:[A-Za-z0-9_-]{30,}/, 'токен Telegram-бота'],
];
for (const file of textFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  markers.forEach((marker, i) => {
    if (content.includes(marker)) fail(`${rel}: найден секрет-маркер №${i + 1}`);
  });
  for (const [re, what] of PATTERNS) if (re.test(content)) fail(`${rel}: ${what}`);
}

console.log(`[check:build] файлов проверено ${textFiles.length}, маркеров ${markers.length}`);
if (markers.length === 0) console.log('[check:build] маркеры не заданы (TG_INFO_SECRET_MARKERS): проверены только шаблоны');
if (failures.length > 0) {
  for (const f of failures) console.error(`[check:build] ОШИБКА: ${f}`);
  process.exit(1);
}
console.log('[check:build] ok: /api не кэшируется service worker, секретов в бандле не найдено');
