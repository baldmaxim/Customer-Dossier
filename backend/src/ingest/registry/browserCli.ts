import { closeDb } from '../../db/pool.js';
import { runDomRfBrowserPass } from './domrfBrowserWorker.js';

try {
  const results = await runDomRfBrowserPass();
  if (results.length === 0) console.log('Ожидающих карточек и поисков ДОМ.РФ нет');
  for (const result of results) console.log(result);
  if (results.some(result => result.outcome.startsWith('ошибка:'))) process.exitCode = 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await closeDb();
}
