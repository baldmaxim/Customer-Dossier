import { FC, FormEvent, ReactElement, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { IStatement, ISnapshotView } from '../api/types';
import { GraphPanel } from '../components/GraphPanel';
import { StatementList } from '../components/StatementList';
import { CASE_CHAIN_STATUS_LABELS, CASE_ROLE_STATUS_LABELS, STANCE_LABELS, formatDate, formatDateTime } from '../lib/labels';
import styles from './Dossier.module.css';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** Снимок досье: показывается только хранимое содержание; текущие данные портала сюда не подмешиваются. */
export const SnapshotPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const snapshotId = Number(id);
  const queryClient = useQueryClient();
  const [evidenceId, setEvidenceId] = useState('');
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => api.get<ISnapshotView>(`/api/snapshots/${snapshotId}`),
    enabled: Number.isSafeInteger(snapshotId) && snapshotId > 0,
  });

  const redact = useMutation({
    mutationFn: () => api.post<{ hashBefore: string; hashAfter: string; replayed: boolean }>(`/api/snapshots/${snapshotId}/redactions`, { evidenceId: Number(evidenceId), reason: reason.trim() }),
    onSuccess: () => {
      setEvidenceId('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['snapshot', snapshotId] });
    },
  });

  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) return <p className={styles.meta}>Некорректный адрес снимка.</p>;
  if (query.isLoading) return <p className={styles.meta}>Загрузка…</p>;
  if (query.isError || !query.data) return <p className={styles.error} role="alert">Снимок недоступен: {(query.error as Error | null)?.message ?? 'нет данных'}</p>;

  const { meta, integrity, availability, redactions, payload: p } = query.data;
  const d = p.dossier;
  const exportUrl = (format: 'md' | 'json' | 'html', download = false): string => `${BASE_URL}/api/snapshots/${meta.id}/export.${format}${download ? '?download=1' : ''}`;
  const block = (title: string, items: IStatement[], empty: string, extra?: string): ReactElement => (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {extra && <p className={styles.statusLine}>{extra}</p>}
      <StatementList items={items} empty={empty} showQuotes />
    </section>
  );

  const submitRedaction = (e: FormEvent): void => {
    e.preventDefault();
    redact.mutate();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.meta}>
          <Link to={`/cases/${meta.caseId}`}>Обращение №{meta.caseId}</Link> · снимок №{meta.id} · версия обращения {meta.caseVersion}
        </p>
        <h1 className={styles.title}>{p.case.title}</h1>
        <p className={styles.meta}>
          Создан {formatDateTime(meta.generatedAt)} · знания на {formatDateTime(meta.knowledgeCutoff)} · {p.effective.note}
        </p>
        <p className={styles.meta}>
          {p.company ? `${p.company.legalForm ? `${p.company.legalForm} ` : ''}${p.company.name}${p.company.identifiers.length ? ` (${p.company.identifiers.join(', ')})` : ''}` : `Юрлицо не установлено («${p.case.companyNameClaimed ?? ''}»)`}
          {p.project ? ` · ${p.project.name}${p.project.city ? `, ${p.project.city}` : ''}` : p.case.projectNameClaimed ? ` · объект со слов: ${p.case.projectNameClaimed}` : ''}
          {p.case.scopeBuilding && `, ${p.case.scopeBuilding}`}
        </p>
        <p className={integrity.verified ? styles.meta : styles.error} role={integrity.verified ? undefined : 'alert'}>
          {integrity.verified ? 'Целостность подтверждена' : 'Целостность НЕ подтверждена: хранимое содержание не совпадает с hash'} · {integrity.algorithm} {integrity.storedHash.slice(0, 16)}… — не подпись и не подтверждение истинности
        </p>
        <p className={styles.meta}>
          Версии: {p.versions.template}, {p.versions.signalsRules}, {p.versions.graph}
          {p.versions.signalsCutoff ? ` · срез сигналов ${formatDateTime(p.versions.signalsCutoff)}` : ' · сигналы не рассчитывались'}
          {p.versions.signalsStale && ' (устарел на момент снимка)'}
        </p>
        {availability.withheldSources.length > 0 && (
          <p className={styles.warn} role="status">
            Сейчас скрыто цитат: {availability.withheldEvidence} — допуск источников изменился после создания снимка ({availability.withheldSources.map(s => `${s.sourceKey}: ${s.reason}`).join('; ')}). Проверено {formatDateTime(availability.checkedAt)}.
          </p>
        )}
        <div className={styles.row}>
          <a className={styles.button} href={exportUrl('html')} target="_blank" rel="noopener noreferrer">
            Версия для печати
          </a>
          <a className={styles.button} href={exportUrl('md', true)}>
            Скачать Markdown
          </a>
          <a className={styles.button} href={exportUrl('json', true)}>
            Скачать JSON
          </a>
        </div>
      </header>

      {block('Существенные наблюдения', d.observations, 'Наблюдений нет.')}
      {block('Предмет обращения', d.subject, '')}
      <div className={styles.columns}>
        {block('Роль', [...(d.role.claimed ? [d.role.claimed] : []), ...d.role.contradictions, ...d.role.established, ...d.role.otherBuildings, ...(d.role.context ?? [])], 'Роль не установлена.', CASE_ROLE_STATUS_LABELS[d.role.status] ?? d.role.status)}
        {block('Кто заказывает работы', [...(d.chain.claimed ? [d.chain.claimed] : []), ...d.chain.documented, ...d.chain.subcontracts, ...d.chain.coParticipants, ...(d.chain.context ?? [])], 'Договоров не найдено.', CASE_CHAIN_STATUS_LABELS[d.chain.status] ?? d.chain.status)}
      </div>
      {block('Условия', [...(d.terms.claimed ? [d.terms.claimed] : []), ...d.terms.fromSources], 'Условия в источниках не указаны.')}
      {block('События и контекст объекта', [...d.projectContext.state, ...d.projectContext.events, ...d.companyEvents], 'Событий не найдено.')}
      <section className={styles.section} aria-labelledby="snap-gaps">
        <h2 id="snap-gaps" className={styles.sectionTitle}>Что не установлено</h2>
        <StatementList items={d.uncertainties} empty="Существенных пробелов не выявлено." />
        {d.questions.length > 0 && (
          <ol className={styles.questions}>
            {d.questions.map(q => (
              <li key={q.code}>{q.text}</li>
            ))}
          </ol>
        )}
      </section>

      <GraphPanel frozen={p.graph} />

      <section className={styles.section} aria-labelledby="snap-reviews">
        <h2 id="snap-reviews" className={styles.sectionTitle}>Решения аналитика на момент снимка</h2>
        {p.reviews.length === 0 ? (
          <p className={styles.meta}>Решений не было.</p>
        ) : (
          <ul className={styles.list}>
            {p.reviews.map(r => (
              <li key={r.id} className={styles.listItem}>
                Утверждение #{r.assertionId} (версия {r.assertionVersion}): {r.decision} · {formatDateTime(r.decidedAt)}
                {r.reason && ` — ${r.reason}`}
              </li>
            ))}
          </ul>
        )}
        {p.openQueue.length > 0 && <p className={styles.meta}>Открытые вопросы проверки: {p.openQueue.map(q => `${q.kind} #${q.assertionId}`).join(', ')}</p>}
      </section>

      <section className={styles.section} aria-labelledby="snap-sources">
        <h2 id="snap-sources" className={styles.sectionTitle}>Источники</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">№</th>
                <th scope="col">Источник</th>
                <th scope="col">Редакция</th>
                <th scope="col">Дата</th>
                <th scope="col">Позиция</th>
                <th scope="col">Цитата</th>
              </tr>
            </thead>
            <tbody>
              {p.sources.map(s => (
                <tr key={s.evidenceId}>
                  <td>#{s.evidenceId}</td>
                  <td>
                    {s.sourceTitle}
                    {s.url && (
                      <span className={styles.quoteMeta}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          открыть публикацию
                        </a>
                      </span>
                    )}
                  </td>
                  <td>ред. {s.revisionNo}</td>
                  <td>{formatDate(s.publishedAt)}</td>
                  <td>{STANCE_LABELS[s.stance] ?? s.stance}</td>
                  <td>{s.quote === null ? <span className={styles.hint}>{s.withheldReason ?? 'цитата недоступна'}</span> : `«${s.quote}»`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="snap-limits">
        <h2 id="snap-limits" className={styles.sectionTitle}>Ограничения</h2>
        <ul className={styles.questions}>
          {p.limitations.map(l => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className={styles.meta}>{d.disclaimer}</p>
      </section>

      <section className={styles.section} aria-labelledby="snap-redact">
        <h2 id="snap-redact" className={styles.sectionTitle}>Вымарывание фрагмента</h2>
        <p className={styles.meta}>Только по обязательному требованию: цитата заменяется пометкой, прежний и новый hash записываются в журнал.</p>
        {redactions.length > 0 && (
          <ul className={styles.list}>
            {redactions.map(r => (
              <li key={r.evidenceId} className={styles.listItem}>
                #{r.evidenceId} · {formatDateTime(r.redactedAt)} · {r.actor} — {r.reason}
              </li>
            ))}
          </ul>
        )}
        <form className={styles.form} onSubmit={submitRedaction}>
          <label className={styles.field}>
            Фрагмент
            <select value={evidenceId} onChange={e => setEvidenceId(e.target.value)} required>
              <option value="">выберите</option>
              {p.sources
                .filter(s => !redactions.some(r => r.evidenceId === s.evidenceId))
                .map(s => (
                  <option key={s.evidenceId} value={s.evidenceId}>
                    #{s.evidenceId} · {s.sourceTitle}
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            Основание
            <input value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={2000} required />
          </label>
          <div className={`${styles.row} ${styles.full}`}>
            <button type="submit" className={styles.button} disabled={redact.isPending || !evidenceId || reason.trim().length < 3}>
              Вымарать
            </button>
            {redact.isError && (
              <span className={styles.error} role="alert">
                {(redact.error as Error).message}
              </span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
};
