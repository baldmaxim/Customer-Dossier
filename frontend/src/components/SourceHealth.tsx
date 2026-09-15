import { FC } from 'react';

import type { ISiteProbeReport, ISourceRow } from '../api/types';
import { COMPLETENESS_LABELS, COVERAGE_STOP_LABELS, RUN_OUTCOME_LABELS, SOURCE_HEALTH_LABELS, formatDateTime } from '../lib/labels';
import styles from './SourceHealth.module.css';

const HEALTH_CLASS: Record<string, string> = {
  ok: styles.ok ?? '',
  parser_degraded: styles.warn ?? '',
  rate_limited: styles.warn ?? '',
  blocked: styles.bad ?? '',
  error: styles.bad ?? '',
  config_invalid: styles.bad ?? '',
  identity_uncertain: styles.warn ?? '',
};

/** Здоровье источника и итог последнего запуска: числа и причина словами. */
export const SourceHealthCell: FC<{ source: ISourceRow }> = ({ source }) => {
  const health = source.health ?? 'unknown';
  const stop = typeof source.lastCoverage?.stopReason === 'string' ? source.lastCoverage.stopReason : null;
  return (
    <div className={styles.cell}>
      <span className={`${styles.badge} ${HEALTH_CLASS[health] ?? ''}`}>{SOURCE_HEALTH_LABELS[health] ?? health}</span>
      {source.healthReason && <span className={styles.reason}>{source.healthReason}</span>}
      {source.lastOutcome && (
        <span className={styles.meta}>
          {RUN_OUTCOME_LABELS[source.lastOutcome] ?? source.lastOutcome}: найдено {source.lastFound ?? 0}, сохранено{' '}
          {source.lastSaved ?? 0}, изменено {source.lastChanged ?? 0}, пропущено {source.lastSkipped ?? 0}, ошибок{' '}
          {source.lastFailed ?? 0}
          {source.lastPages ? `, страниц ${source.lastPages}` : ''}
        </span>
      )}
      {!source.lastOutcome && source.lastRunAt && (
        <span className={styles.meta}>
          запуск {formatDateTime(source.lastRunAt)}: новых {source.lastItemsNew ?? 0} из {source.lastItemsSeen ?? 0}
        </span>
      )}
      {!source.lastOutcome && source.lastError && <span className={styles.reason}>{source.lastError}</span>}
      {stop && <span className={styles.meta}>покрытие: {COVERAGE_STOP_LABELS[stop] ?? stop}</span>}
      <span className={styles.meta}>
        попытка {formatDateTime(source.lastAttemptAt ?? null) || '—'} · успех {formatDateTime(source.lastOkAt) || '—'}
        {source.parserVersion ? ` · ${source.parserVersion}` : ''}
        {source.lastDurationMs ? ` · ${Math.round(source.lastDurationMs / 100) / 10} с` : ''}
      </span>
      {source.retryAfterAt && <span className={styles.meta}>повтор не раньше {formatDateTime(source.retryAfterAt)}</span>}
    </div>
  );
};

/** Результат пробы: ничего не сохранено, опрос не включён. */
export const SiteProbeResult: FC<{ report: ISiteProbeReport; onClose: () => void }> = ({ report, onClose }) => (
  <div className={styles.probe}>
    <div className={styles.probeHead}>
      <strong>
        Проба: {RUN_OUTCOME_LABELS[report.outcome] ?? report.outcome} · {SOURCE_HEALTH_LABELS[report.health] ?? report.health}
      </strong>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </div>
    <p className={styles.meta}>
      Ничего не сохранено. HTTP {report.httpStatus ?? '—'}, страниц {report.pagesFetched}, найдено {report.counts.found}, ошибок{' '}
      {report.counts.failed}, парсер {report.parserVersion}
    </p>
    {report.healthReason && <p className={styles.reason}>{report.healthReason}</p>}
    <p className={styles.meta}>Селекторы: {Object.entries(report.layoutStats).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</p>
    {report.samples.map(s => (
      <div key={s.url} className={styles.sample}>
        <span className={styles.sampleTitle}>{s.title || s.url}</span>
        <span className={styles.meta}>
          {COMPLETENESS_LABELS[s.completeness as keyof typeof COMPLETENESS_LABELS] ?? s.completeness} · {s.reason}
        </span>
        <span className={styles.preview}>{s.preview}</span>
      </div>
    ))}
    {report.errors.map(e => (
      <p key={e} className={styles.reason}>
        {e}
      </p>
    ))}
  </div>
);
