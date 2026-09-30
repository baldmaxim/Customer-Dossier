// «Технические подробности» разбора: для восстановления после сбоя и разговора с тем, кто
// правит сервер. Номера, модель, схема, отпечаток, токены, аренда, части текста и смещения
// цитат — здесь, а не в заголовке страницы.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IRunDetail } from '../../api/types';
import { formatCount, formatDuration } from '../../lib/format';
import { CHUNK_OUTCOME_LABELS, CHUNK_STATUS_LABELS, RUN_STATUS_LABELS, formatDateTime } from '../../lib/labels';
import { Cluster } from '../ui/Cluster';
import { DescriptionList, type IDescriptionItem } from '../ui/DescriptionList';
import { Heading } from '../ui/Heading';
import { Stack } from '../ui/Stack';
import styles from './RunTech.module.css';

const runLink = (id: number, status: string): ReactNode => (
  <Link key={id} to={`/admin/process/${id}`} viewTransition>
    разбор №{id} ({RUN_STATUS_LABELS[status] ?? status})
  </Link>
);

const orDash = (value: string | null | undefined): string => (value ? value : '—');

export const RunTechDetails: FC<{ run: IRunDetail }> = ({ run: r }) => {
  const items: IDescriptionItem[] = [
    { label: 'Номер разбора', value: formatCount(r.id) },
    { label: 'Публикация', value: `№${r.sourceItemId}` },
    {
      label: 'Версия текста',
      value: `№${r.revision.no}, ${formatCount(r.revision.bodyChars)} символов${
        r.latestRevision && r.latestRevision.no > r.revision.no ? ` (последняя — №${r.latestRevision.no})` : ''
      }`,
    },
    { label: 'Модель', value: <span className={styles.mono}>{r.model ?? 'неизвестна'}</span> },
    { label: 'Провайдер', value: orDash(r.identity.provider) },
    {
      label: 'Схема и промпт',
      value: <span className={styles.mono}>{`${r.schemaVersion ?? 'схема неизвестна'} · ${r.promptVersion ?? 'промпт неизвестен'}`}</span>,
    },
    {
      label: 'Отпечаток конфигурации',
      value: (
        <Stack gap={1}>
          <span className={styles.mono}>{r.fingerprint}</span>
          {r.identity.historical && <span className={styles.muted}>конфигурация до этапа 11</span>}
          {!r.identity.candidateBuildCurrent && (
            <span className={styles.muted}>проверка найденного прежней версии ({orDash(r.identity.candidateBuildVersion)})</span>
          )}
        </Stack>
      ),
    },
    { label: 'Поставлен', value: `${formatDateTime(r.createdAt)} (${r.requestedBy})` },
    { label: 'Начат', value: orDash(formatDateTime(r.startedAt)) },
    { label: 'Завершён', value: orDash(formatDateTime(r.finishedAt)) },
    {
      label: 'Ответы модели',
      value: `${formatCount(r.usage.responses)} · токены ${
        r.usage.tokensIn === null ? 'неизвестны' : `${formatCount(r.usage.tokensIn)} / ${formatCount(r.usage.tokensOut)}`
      } · время ${formatDuration(r.usage.latencyMs)}`,
    },
    {
      label: 'Аренда',
      value: r.lease.owner
        ? `${r.lease.owner} до ${formatDateTime(r.lease.expiresAt)}, взят ${formatCount(r.lease.claimCount)} раз`
        : 'нет',
    },
    {
      label: 'Покрытие текста',
      value: `частей ${formatCount(r.coverage.chunksOk)} из ${formatCount(r.coverage.chunks)} · символов ${formatCount(r.coverage.coveredChars)} из ${formatCount(r.coverage.totalChars)}`,
    },
    {
      label: 'Повторы',
      value:
        r.lineage.previous.length === 0 && r.lineage.retries.length === 0 ? (
          'первая попытка'
        ) : (
          <Cluster gap={[1, 3]}>
            {r.lineage.previous.length > 0 && <span>прежние: {r.lineage.previous.map(p => runLink(p.id, p.status))}</span>}
            {r.lineage.retries.length > 0 && <span>следующие: {r.lineage.retries.map(p => runLink(p.id, p.status))}</span>}
          </Cluster>
        ),
    },
    {
      label: 'В карточках сейчас',
      value:
        r.publication.activeSetId === null
          ? 'ничего'
          : `найденное №${r.publication.activeSetId} (разбор №${r.publication.activeRunId ?? '—'}, версия текста №${r.publication.activeRevisionNo ?? '—'}), версия публикации ${r.publication.version}`,
    },
  ];

  return (
    <Stack gap={5}>
      <DescriptionList items={items} dense />

      <Stack gap={2}>
        <Heading className={styles.subhead}>Части текста</Heading>
        {r.chunks.length === 0 ? (
          <p className={styles.muted}>Частей нет: разбор не начинался или текст не поместился в лимит частей.</p>
        ) : (
          <ol className={styles.list}>
            {r.chunks.map(c => (
              <li key={c.index} className={styles.item}>
                <span>
                  Часть {c.index + 1}, символы {formatCount(c.rangeStart)}–{formatCount(c.rangeEnd)}:{' '}
                  {CHUNK_STATUS_LABELS[c.status] ?? c.status} · попыток {c.attempts}
                </span>
                {c.lastError && <span className={styles.warn}>{c.lastError}</span>}
                {c.responses.map(x => (
                  <span key={x.attemptNo} className={styles.muted}>
                    попытка {x.attemptNo}: {CHUNK_OUTCOME_LABELS[x.outcome] ?? x.outcome}
                    {x.error ? ` — ${x.error}` : ''} · {formatDuration(x.latencyMs)} · {formatDateTime(x.createdAt)}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </Stack>

      {r.candidates.length > 0 && (
        <Stack gap={2}>
          <Heading className={styles.subhead}>Цитаты найденного в тексте</Heading>
          <ul className={styles.list}>
            {r.candidates.map(c => (
              <li key={c.id} className={styles.item}>
                <span>
                  №{c.id} · {c.grounded ? 'цитата найдена' : 'цитаты нет'}
                  {c.confidence !== null ? ` · уверенность модели ${Math.round(c.confidence * 100)} %` : ''}
                </span>
                {c.evidence.map(e => (
                  <span key={`${e.spanStart}-${e.spanEnd}-${e.stance}`} className={styles.muted}>
                    символы {formatCount(e.spanStart)}–{formatCount(e.spanEnd)}, часть {e.chunkId},{' '}
                    {e.stance === 'contradicts' ? 'опровергает' : e.stance === 'mentions' ? 'упоминает' : 'подтверждает'}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Stack>
      )}
    </Stack>
  );
};
