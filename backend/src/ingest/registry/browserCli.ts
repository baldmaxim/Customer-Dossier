import { closeDb } from '../../db/pool.js';
import { runDomRfBrowserPass } from './domrfBrowserWorker.js';

try {
  const result = await runDomRfBrowserPass();
  console.log(result ?? 'Ожидающих карточек ДОМ.РФ нет');
  if (result?.outcome.startsWith('ошибка:')) process.exitCode = 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await closeDb();
}
