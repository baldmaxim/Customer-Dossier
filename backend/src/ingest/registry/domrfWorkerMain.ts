// Отдельный процесс браузерного сбора ДОМ.РФ (этап 20D) — контейнер tginfo-domrf на сервере.
//
// API собран на Alpine, где Chromium нет, а сайт пускает только браузер с окном. Этот процесс живёт
// в образе Playwright с виртуальным экраном Xvfb (deploy/Dockerfile.domrf) и делает только одно:
// карточки объектов из очереди и страницы их застройщиков и групп. Ни HTTP, ни других заданий.

import { env } from '../../config/env.js';
import { checkDbConnection, closeDb } from '../../db/pool.js';
import { startDomRfBrowserWorker } from './domrfBrowserWorker.js';

const main = async (): Promise<void> => {
  if (!(await checkDbConnection())) throw new Error('нет соединения с БД — проверьте DATABASE_URL');
  const controller = new AbortController();
  const shutdown = (sig: string): void => {
    console.log(`[domrf] ${sig}, останавливаюсь`);
    controller.abort();
    void closeDb().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (!env.DOMRF_BROWSER_ENABLED) {
    // Выключен — процесс ждёт, а не падает: иначе restart: unless-stopped крутил бы перезапуски.
    console.log('[domrf] DOMRF_BROWSER_ENABLED=false — браузерный сбор выключен');
    setInterval(() => undefined, 3_600_000);
    return;
  }
  startDomRfBrowserWorker(controller.signal);
  console.log('[domrf] браузерный сбор ДОМ.РФ запущен: карточки из очереди, страницы застройщиков и групп, затем поиск компаний портала');
};

main().catch(err => {
  console.error('[domrf] не запустился:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
