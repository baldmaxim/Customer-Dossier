// Подробности состояния источника и результат проверки сайта — для разбора сбоя, а не для
// ежедневного взгляда: в строке таблицы источника стоит одна отметка словами, всё это — под
// «Подробнее». Тоны — единый словарь statusTone: «выключен» и «ещё не собирался» не красные.

import { FC } from 'react';

import type { ISiteProbeReport, ISourceRow } from '../api/types';
import { formatCount, formatDuration } from '../lib/format';
import {
  COMPLETENESS_LABELS,
  COVERAGE_STOP_LABELS,
  RUN_OUTCOME_LABELS,
  SOURCE_HEALTH_LABELS,
  SOURCE_HEALTH_STATE_LABELS,
  formatDateTime,
} from '../lib/labels';
import { SOURCE_HEALTH_STATE_TONE, SOURCE_HEALTH_TONE, toneOf } from '../lib/statusTone';
import { Badge } from './ui/Badge';
import { Cluster } from './ui/Cluster';
import { DescriptionList, type IDescriptionItem } from './ui/DescriptionList';
import { Stack } from './ui/Stack';
import styles from './SourceHealth.module.css';

/** Итог последнего прохода числами: «найдено 20, сохранено 3, …». */
const passCounts = (s: ISourceRow): string =>
  [
    `найдено ${formatCount(s.lastFound ?? 0)}`,
    `сохранено ${formatCount(s.lastSaved ?? 0)}`,
    `изменено ${formatCount(s.lastChanged ?? 0)}`,
    `пропущено ${formatCount(s.lastSkipped ?? 0)}`,
    `ошибок ${formatCount(s.lastFailed ?? 0)}`,
    ...(s.lastPages ? [`страниц ${formatCount(s.lastPages)}`] : []),
  ].join(', ');

const lastPass = (s: ISourceRow): string | null => {
  if (s.lastOutcome) return `${RUN_OUTCOME_LABELS[s.lastOutcome] ?? s.lastOutcome}: ${passCounts(s)}`;
  if (s.lastRunAt)
    return `${formatDateTime(s.lastRunAt)}: новых ${formatCount(s.lastItemsNew ?? 0)} из ${formatCount(s.lastItemsSeen ?? 0)}`;
  return null;
};

/** Состояние источника подробно: что с ним, где остановился сбор, когда была попытка. */
export const SourceHealthCell: FC<{ source: ISourceRow }> = ({ source }) => {
  const health = source.health ?? 'unknown';
  const stop = typeof source.lastCoverage?.stopReason === 'string' ? source.lastCoverage.stopReason : null;
  const state = source.healthState;
  const pass = lastPass(source);

  const items: IDescriptionItem[] = [
    ...(state
      ? [
          {
            label: 'Состояние',
            value: (
              <Stack gap={1}>
                <span>
                  <Badge tone={toneOf(SOURCE_HEALTH_STATE_TONE, state.state)}>
                    {SOURCE_HEALTH_STATE_LABELS[state.state] ?? state.state}
                  </Badge>
                </span>
                <span>{state.reason}</span>
                {state.coverage.gaps.map(gap => (
                  <span key={gap} className={styles.muted}>
                    пропуск в постах: {gap}
                  </span>
                ))}
              </Stack>
            ),
          },
          // Сколько всего постов у источника, портал не знает никогда — это сказано, а не умолчано.
          { label: 'История источника', value: `полнота неизвестна · разбор ${state.aiAllowed ? 'включён' : 'выключен'}` },
        ]
      : []),
    {
      label: 'Сборщик',
      value: (
        <Stack gap={1}>
          <span>
            <Badge tone={toneOf(SOURCE_HEALTH_TONE, health)}>{SOURCE_HEALTH_LABELS[health] ?? health}</Badge>
          </span>
          {source.healthReason && <span>{source.healthReason}</span>}
        </Stack>
      ),
    },
    ...(pass ? [{ label: 'Последний проход', value: pass }] : []),
    ...(!source.lastOutcome && source.lastError ? [{ label: 'Ошибка', value: source.lastError }] : []),
    ...(stop ? [{ label: 'Где остановился сбор', value: COVERAGE_STOP_LABELS[stop] ?? stop }] : []),
    {
      label: 'Попытка и успех',
      value: `попытка ${formatDateTime(source.lastAttemptAt ?? null) || '—'} · успех ${formatDateTime(source.lastOkAt) || '—'}${
        source.lastDurationMs ? ` · ${formatDuration(source.lastDurationMs)}` : ''
      }`,
    },
    ...(source.retryAfterAt ? [{ label: 'Повтор не раньше', value: formatDateTime(source.retryAfterAt) }] : []),
    ...(source.lagSeconds !== undefined
      ? [
          {
            label: 'С последнего успеха',
            value: source.lagSeconds === null ? 'успешных сборов не было' : `${formatCount(Math.round(source.lagSeconds / 3600))} ч`,
          },
        ]
      : []),
    ...(source.items !== undefined
      ? [
          {
            label: 'Публикаций',
            value: `${formatCount(source.items)}, с неполным текстом ${formatCount(source.incompleteItems ?? 0)}`,
          },
        ]
      : []),
  ];

  return <DescriptionList items={items} layout="stacked" dense />;
};

/** Проверка сайта: одна страница, до трёх записей, ничего не сохранено и опрос не включён. */
export const SiteProbeResult: FC<{ report: ISiteProbeReport }> = ({ report }) => (
  <Stack gap={3}>
    <Cluster gap={2}>
      <Badge tone={toneOf(SOURCE_HEALTH_TONE, report.health)}>{SOURCE_HEALTH_LABELS[report.health] ?? report.health}</Badge>
      <span className={styles.muted}>{RUN_OUTCOME_LABELS[report.outcome] ?? report.outcome}</span>
    </Cluster>
    <p className={styles.text}>
      Ничего не сохранено. Найдено записей: {formatCount(report.counts.found)}, ошибок: {formatCount(report.counts.failed)}.
    </p>
    {report.healthReason && <p className={styles.text}>{report.healthReason}</p>}
    {report.samples.length > 0 && (
      <ul className={styles.samples}>
        {report.samples.map(s => (
          <li key={s.url} className={styles.sample}>
            <a href={s.url} target="_blank" rel="noreferrer noopener" className={styles.sampleTitle}>
              {s.title || s.url}
            </a>
            <span className={styles.muted}>
              {COMPLETENESS_LABELS[s.completeness as keyof typeof COMPLETENESS_LABELS] ?? s.completeness} · {s.reason}
            </span>
            <span className={styles.preview}>{s.preview}</span>
          </li>
        ))}
      </ul>
    )}
    {report.errors.map(e => (
      <p key={e} className={styles.error}>
        {e}
      </p>
    ))}
  </Stack>
);
