import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { IProjectDossier } from '../api/types';
import { GraphPanel } from '../components/GraphPanel';
import { StatementList } from '../components/StatementList';
import { ASSERTION_ROLE_LABELS, CONTEXT_STATE_LABELS, IN_PERIOD_LABELS, PRECISION_LABELS, PROJECT_LEVEL_LABELS, formatDate } from '../lib/labels';
import styles from './Dossier.module.css';

/** Досье объекта: иерархия, состояние с датой, участники в выбранный период, договоры отдельно от совместного участия. */
export const ProjectPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyInPeriod, setOnlyInPeriod] = useState(false);

  const query = useQuery({
    queryKey: ['project', projectId, 'dossier', from, to],
    queryFn: () => {
      const search = new URLSearchParams();
      if (from) search.set('from', from);
      if (to) search.set('to', to);
      return api.get<IProjectDossier>(`/api/projects/${projectId}/dossier?${search}`);
    },
    enabled: Number.isSafeInteger(projectId) && projectId > 0,
  });

  if (!Number.isSafeInteger(projectId) || projectId <= 0) return <p className={styles.meta}>Некорректный адрес объекта.</p>;
  if (query.isLoading) return <p className={styles.meta}>Загрузка…</p>;
  if (query.isError || !query.data) return <p className={styles.error} role="alert">Объект недоступен: {(query.error as Error | null)?.message ?? 'нет данных'}</p>;
  const d = query.data;
  if (d.project.mergedIntoId) return <Navigate to={`/projects/${d.project.mergedIntoId}`} replace />;
  const periodSelected = Boolean(from || to);
  const participants = onlyInPeriod && periodSelected ? d.participants.filter(p => p.inPeriod === 'overlaps') : d.participants;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.meta}>
          {PROJECT_LEVEL_LABELS[d.project.level] ?? d.project.level}
          {d.project.levelLabel && ` ${d.project.levelLabel}`}
          {d.project.parent && (
            <>
              {' · входит в '}
              <Link to={`/projects/${d.project.parent.id}`}>{d.project.parent.name}</Link>
            </>
          )}
        </p>
        <h1 className={styles.title}>{d.project.name}</h1>
        <p className={styles.meta}>{d.project.city ?? 'город в источниках не указан'}</p>
        {d.project.children.length > 0 && (
          <p className={styles.meta}>
            Очереди и корпуса:{' '}
            {d.project.children.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Link to={`/projects/${c.id}`}>{c.levelLabel ? `${PROJECT_LEVEL_LABELS[c.level] ?? c.level} ${c.levelLabel}` : c.name}</Link>
              </span>
            ))}
          </p>
        )}
      </header>

      <section className={styles.section} aria-labelledby="state">
        <h2 id="state" className={styles.sectionTitle}>Состояние по действительной дате</h2>
        {d.state.current.length === 0 ? (
          <p className={styles.meta}>Состояние с датой в источниках не установлено.</p>
        ) : (
          <ul className={styles.list}>
            {d.state.current.map(s => (
              <li key={`${s.building ?? ''}${s.validFrom}`} className={styles.listItem}>
                {s.building ? `${s.building}: ` : ''}
                {CONTEXT_STATE_LABELS[s.state] ?? s.state} с {formatDate(s.validFrom)}
                {s.periodPrecision !== 'day' && ` (${PRECISION_LABELS[s.periodPrecision] ?? s.periodPrecision})`}
              </li>
            ))}
          </ul>
        )}
        {d.state.history.length > 1 && (
          <p className={styles.meta}>
            История: {d.state.history.map(h => `${CONTEXT_STATE_LABELS[h.state] ?? h.state} ${formatDate(h.validFrom)}`).join(' → ')}
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="participants">
        <h2 id="participants" className={styles.sectionTitle}>Участники</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Период с</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>по</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={onlyInPeriod} disabled={!periodSelected} onChange={e => setOnlyInPeriod(e.target.checked)} /> только пересекающиеся с периодом
          </label>
        </div>
        {participants.length === 0 ? (
          <p className={styles.meta}>Участники в выборке не найдены.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Компания</th>
                  <th>Роль</th>
                  <th>Корпус</th>
                  <th>Работы</th>
                  <th>Период</th>
                  {periodSelected && <th>Выбранный период</th>}
                </tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <tr key={p.statement.assertionIds.join(',')}>
                    <td>
                      <Link to={`/company/${p.companyId}`}>{p.companyName}</Link>
                    </td>
                    <td>{ASSERTION_ROLE_LABELS[p.role ?? ''] ?? p.role}</td>
                    <td>{p.building ?? '—'}</td>
                    <td>{p.workPackage ?? 'не указаны'}</td>
                    <td>{p.validFrom ? `с ${formatDate(p.validFrom)}${p.validTo ? ` по ${formatDate(p.validTo)}` : ''}` : 'не указан'}</td>
                    {periodSelected && <td>{IN_PERIOD_LABELS[p.inPeriod]}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className={styles.sectionTitle}>Основания участия</h3>
        <StatementList items={participants.map(p => p.statement)} />
        {d.notCounted.length > 0 && (
          <>
            <h3 className={styles.sectionTitle}>Не учтено как участие (отрицание, план, слух)</h3>
            <StatementList items={d.notCounted} />
          </>
        )}
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="contracts">
          <h2 id="contracts" className={styles.sectionTitle}>Документированные договоры</h2>
          <StatementList items={d.contracts} empty="Договоров по этому объекту в выборке нет." />
          <p className={styles.meta}>{d.coParticipationNote}</p>
        </section>
        <section className={styles.section} aria-labelledby="events">
          <h2 id="events" className={styles.sectionTitle}>События объекта</h2>
          <StatementList items={d.events} empty="Событий в выборке не найдено." />
        </section>
      </div>

      <GraphPanel projectId={projectId} />

    </div>
  );
};
