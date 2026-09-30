// Локальная проверка снимка браузерной страницы: без БД и запросов к источнику.
import fs from 'node:fs';

import { mapDomRfBrowserCapture } from './browserCapture.js';
import { renderRecord } from './render.js';

const file = process.argv[2];
if (!file) {
  console.error('Использование: npm run registry:preview -- <снимок.json>');
  process.exitCode = 1;
} else {
  try {
    const record = mapDomRfBrowserCapture(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
    console.log(renderRecord(record));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
