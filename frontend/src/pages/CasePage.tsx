import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { ICaseDossier, ICaseInput, ICaseRow } from '../api/types';
import { CaseForm } from '../components/CaseForm';
import { StatementList } from '../components/StatementList';
import { CASE_CHAIN_STATUS_LABELS, CASE_ROLE_STATUS_LABELS, formatDateTime } from '../lib/labels';
import styles from './Dossier.module.css';

interface ICaseResponse {
  case: ICaseRow;
  history: Array<{ version: number; actor: string; recordedAt: string }>;
}

/**
 * Досье обращения: резюме наблюдений → предмет → роль и цепочка → контекст объекта → неопределённости и вопросы.
 * Строится из сохранённых данных при каждом открытии, без модели; дата актуальности видна.
 */
export const CasePage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const caseId = Number(id);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const caseQuery = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => api.get<ICaseResponse>(`/api/cases/${caseId}`),
    enabled: Number.isSafeInteger(caseId) && caseId > 0,
  });
  const dossierQuery = useQuery({
    queryKey: ['case', caseId, 'dossier'],
    queryFn: () => api.get<ICaseDossier>(`/api/cases/${caseId}/dossier`),
    enabled: Number.isSafeInteger(caseId) && caseId > 0,
  });

  const update = useMutation({
    mutationFn: (input: ICaseInput) => api.put<{ case: ICaseRow }>(`/api/cases/${caseId}`, { ...input, expectedVersion: caseQuery.data?.case.version }),
    onSuccess: () => {
      setEditing(false);
      setNotice('Обращение сохранено.');
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        setNotice('Обращение изменено в другой вкладке. Данные обновлены — внесите правки заново.');
        void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      }
    },
  });

  if (!Number.isSafeInteger(caseId) || caseId <= 0) return <p className={styles.meta}>Некорректный адрес обращения.</p>;
  if (caseQuery.isLoading) return <p className={styles.meta}>Загрузка…</p>;
  // Ошибка API не подменяется прежними данными: показываем ошибку, а не устаревшее досье.
  if (caseQuery.isError) return <p className={styles.error} role="alert">Обращение недоступно: {(caseQuery.error as Error).message}</p>;
  const row = caseQuery.data!.case;
  const dossier = dossierQuery.data;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.meta}>
          <Link to="/cases">Обращения</Link> · №{row.id} · версия {row.version} · {row.status === 'open' ? 'открыто' : 'закрыто'}
        </p>
        <h1 className={styles.title}>{row.title}</h1>
        <p className={styles.meta}>
          {row.companyId ? <Link to={`/company/${row.companyId}`}>{row.companyName}</Link> : `Юрлицо не установлено («${row.companyNameClaimed}»)`}
          {row.projectId ? (
            <>
              {' · '}
              <Link to={`/projects/${row.projectId}`}>{row.projectName}</Link>
            </>
          ) : (
            row.projectNameClaimed && ` · объект со слов: ${row.projectNameClaimed}`
          )}
          {row.scopeBuilding && `, ${row.scopeBuilding}`}
        </p>
        {dossier && (
          <p className={dossier.freshness.stale ? styles.warn : styles.meta}>
            Собрано {formatDateTime(dossier.generatedAt)}
            {dossier.freshness.latestEvidenceAt && ` · последняя публикация в основаниях: ${formatDateTime(dossier.freshness.latestEvidenceAt)}`}
            {dossier.freshness.signalsCutoff ? ` · срез сигналов ${formatDateTime(dossier.freshness.signalsCutoff)}` : ' · сигналы не рассчитывались'}
            {dossier.freshness.stale && ` · устарело: ${dossier.freshness.staleReasons.join('; ')}`}
          </p>
        )}
        <div className={styles.row}>
          <button type="button" className={styles.button} onClick={() => setEditing(!editing)} aria-expanded={editing}>
            {editing ? 'Отменить правку' : 'Изменить обращение'}
          </button>
        </div>
        {notice && (
          <p className={styles.meta} role="status">
            {notice}
          </p>
        )}
      </header>

      {editing && (
        <section className={styles.section} aria-label="Изменение обращения">
          <CaseForm
            key={row.version}
            initial={row}
            pending={update.isPending}
            error={update.error && !(update.error instanceof ApiError && update.error.status === 409) ? update.error.message : null}
            submitLabel="Сохранить изменения"
            onSubmit={input => update.mutate(input)}
          />
        </section>
      )}

      {dossierQuery.isLoading && <p className={styles.meta}>Собираю досье…</p>}
      {dossierQuery.isError && (
        <p className={styles.error} role="alert">
          Досье недоступно: {(dossierQuery.error as Error).message}
        </p>
      )}

      {dossier && !dossierQuery.isError && (
        <>
          <section className={styles.section} aria-labelledby="obs">
            <h2 id="obs" className={styles.sectionTitle}>Главное по источникам</h2>
            <StatementList items={dossier.observations} showQuotes />
          </section>

          <section className={styles.section} aria-labelledby="subject">
            <h2 id="subject" className={styles.sectionTitle}>Предмет обращения</h2>
            <StatementList items={dossier.subject} />
          </section>

          <div className={styles.columns}>
            <section className={styles.section} aria-labelledby="role">
              <h2 id="role" className={styles.sectionTitle}>Роль</h2>
              <p className={styles.statusLine}>Установленная роль: {CASE_ROLE_STATUS_LABELS[dossier.role.status] ?? dossier.role.status}</p>
              <StatementList items={dossier.role.claimed ? [dossier.role.claimed] : []} />
              <StatementList items={[...dossier.role.contradictions, ...dossier.role.established, ...dossier.role.otherBuildings]} />
            </section>
            <section className={styles.section} aria-labelledby="chain">
              <h2 id="chain" className={styles.sectionTitle}>Кто заказывает работы</h2>
              <p className={styles.statusLine}>{CASE_CHAIN_STATUS_LABELS[dossier.chain.status] ?? dossier.chain.status}</p>
              <StatementList items={dossier.chain.claimed ? [dossier.chain.claimed] : []} />
              <StatementList items={[...dossier.chain.documented, ...dossier.chain.subcontracts]} empty="Документированных договоров с участием компании по этому объекту в выборке нет." />
              {dossier.chain.coParticipants.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>Совместное участие на объекте (не договор)</h3>
                  <StatementList items={dossier.chain.coParticipants} />
                </>
              )}
            </section>
          </div>

          <section className={styles.section} aria-labelledby="terms">
            <h2 id="terms" className={styles.sectionTitle}>Условия</h2>
            <StatementList items={[...(dossier.terms.claimed ? [dossier.terms.claimed] : []), ...dossier.terms.fromSources]} empty="Условия в источниках не указаны." />
          </section>

          <section className={styles.section} aria-labelledby="context">
            <h2 id="context" className={styles.sectionTitle}>Контекст объекта и события компании</h2>
            <StatementList items={[...dossier.projectContext.state, ...dossier.projectContext.events, ...dossier.companyEvents]} empty="Событий в выборке не найдено." />
          </section>

          <section className={styles.section} aria-labelledby="gaps">
            <h2 id="gaps" className={styles.sectionTitle}>Что не установлено</h2>
            <StatementList items={dossier.uncertainties} empty="Существенных пробелов по собранным данным не выявлено." />
            {dossier.questions.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Вопросы контрагенту</h3>
                <ol className={styles.questions}>
                  {dossier.questions.map(q => (
                    <li key={q.code}>{q.text}</li>
                  ))}
                </ol>
              </>
            )}
            <p className={styles.meta}>{dossier.disclaimer}</p>
          </section>
        </>
      )}

      <section className={styles.section} aria-labelledby="history">
        <h2 id="history" className={styles.sectionTitle}>История обращения</h2>
        <ul className={styles.list}>
          {caseQuery.data!.history.map(h => (
            <li key={h.version} className={styles.listItem}>
              Версия {h.version} · {h.actor} · {formatDateTime(h.recordedAt)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
