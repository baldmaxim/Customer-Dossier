// Вклад разбора моделью по снимкам реестра — снять (02.10.2026, ADR-012 п. 34).
//
// ИИ-допуск у ДОМ.РФ включили ради подсказок к совпадениям, а конвейер разбора брал все тексты источников с
// таким допуском — и разбирал снимки реестра как публикации: 121 запуск, 51 утверждение. По строке «Застройщик
// … входит в группу «Донстрой»» модель заводила компанию «Донстрой» по названию и путала стороны связи.
// Теперь снимки реестра модели не отдаются (modelTextPolicySql), а уже попавшее отсюда снимается тем же
// способом, что и вклад заменённой публикации: доказательство разбора на редакции реестра → superseded,
// поставленные и не начатые запуски → cancelled. Доказательства реестра (origin = registry), решения
// аналитика и доказательства из публикаций не трогаются. Повтор ничего не меняет.

import { withTransaction } from '../db/pool.js';

export const REGISTRY_EXTRACTION_REASON = 'реестр разбирается без модели (ADR-012): вклад разбора снимка реестра снят';

export const withdrawModelExtractionOnRegistry = async (): Promise<{ evidence: number; runs: number }> =>
  withTransaction(async client => {
    const evidence = await client.query(
      `UPDATE evidence e SET status = 'superseded', status_reason = $1, status_changed_at = now()
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE e.revision_id = r.id AND e.origin = 'extraction' AND e.status = 'active'
         AND s.config->>'mode' = 'registry_api'`,
      [REGISTRY_EXTRACTION_REASON],
    );
    const runs = await client.query(
      `UPDATE extraction_runs er SET status = 'cancelled', error = $1, finished_at = now(), lease_owner = NULL, lease_expires_at = NULL
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE er.revision_id = r.id AND er.status = 'queued' AND s.config->>'mode' = 'registry_api'`,
      [REGISTRY_EXTRACTION_REASON],
    );
    return { evidence: evidence.rowCount ?? 0, runs: runs.rowCount ?? 0 };
  });
