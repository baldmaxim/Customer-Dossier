import { FC, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type {
  ICompanyResponse,
  IEventRow,
  IMention,
  IProjectRow,
  IRisk,
  Sentiment,
} from '../api/types';
import { RiskBadge } from '../components/RiskBadge';
import { ROLE_LABELS, STAGE_LABELS, EVENT_LABELS, formatDate, formatMoney } from '../lib/labels';
import styles from './CompanyPage.module.css';

/**
 * Словесный вердикт вместо голых цифр: карточку читает прораб перед решением,
 * а не аналитик. Формулировки осторожные — данные собраны из новостей, а не
 * из реестра, и выдавать их за истину нельзя.
 */
const buildVerdict = (risk: IRisk | null): string => {
  if (!risk || risk.riskLight === 'grey') {
    return 'Данных мало — по открытым источникам судить рано. Проверяйте компанию обычным порядком, портал здесь ничего не подсказывает.';
  }

  const parts: string[] = [];

  if (risk.hardEvents12m > 0) {
    parts.push(`за год упоминались суд, банкротство или отзыв лицензии (${risk.hardEvents12m})`);
  }
  if (risk.delayedProjects > 0) {
    parts.push(`объектов со срывом сроков: ${risk.delayedProjects} из ${risk.projectsTotal}`);
  }
  if (risk.negative90d > 0) {
    parts.push(`негативных упоминаний за 90 дней: ${risk.negative90d} из ${risk.mentions90d}`);
  }
  if (risk.replacedCount > 0) {
    parts.push(`компанию меняли как подрядчика ${risk.replacedCount} раз`);
  }

  if (parts.length === 0) {
    return `Заметных проблем в открытых источниках нет. Активных объектов: ${risk.activeProjects}, упоминаний за 90 дней: ${risk.mentions90d}.`;
  }

  const lead =
    risk.riskLight === 'red'
      ? 'Есть существенные основания насторожиться'
      : 'Есть на что обратить внимание';

  return `${lead}: ${parts.join('; ')}.`;
};

const VERDICT_CLASS: Record<string, string> = {
  green: styles.verdictGreen ?? '',
  yellow: styles.verdictYellow ?? '',
  red: styles.verdictRed ?? '',
};

const SENTIMENT_FILTERS: Array<{ value: Sentiment | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'negative', label: 'Негатив' },
  { value: 'positive', label: 'Позитив' },
];

export const CompanyPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const [sentiment, setSentiment] = useState<Sentiment | 'all'>('all');

  const companyQuery = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.get<ICompanyResponse>(`/api/companies/${companyId}`),
    enabled: Number.isFinite(companyId),
  });

  const projectsQuery = useQuery({
    queryKey: ['company', companyId, 'projects'],
    queryFn: () => api.get<{ items: IProjectRow[] }>(`/api/companies/${companyId}/projects`),
    enabled: Number.isFinite(companyId),
  });

  const eventsQuery = useQuery({
    queryKey: ['company', companyId, 'events'],
    queryFn: () => api.get<{ items: IEventRow[] }>(`/api/companies/${companyId}/events`),
    enabled: Number.isFinite(companyId),
  });

  const similarQuery = useQuery({
    queryKey: ['company', companyId, 'similar'],
    queryFn: () =>
      api.get<{ items: Array<{ id: number; name: string; city: string | null }> }>(
        `/api/companies/${companyId}/similar`,
      ),
    enabled: Number.isFinite(companyId),
  });

  const mentionsQuery = useInfiniteQuery({
    queryKey: ['company', companyId, 'mentions', sentiment],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      if (sentiment !== 'all') params.set('sentiment', sentiment);
      return api.get<{ items: IMention[]; nextCursor: string | null }>(
        `/api/companies/${companyId}/mentions?${params}`,
      );
    },
    getNextPageParam: last => last.nextCursor,
    enabled: Number.isFinite(companyId),
  });

  if (!Number.isFinite(companyId)) return <p>Некорректный адрес карточки.</p>;
  if (companyQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (companyQuery.isError) return <p className={styles.empty}>Компания не найдена.</p>;

  const data = companyQuery.data;
  // Компания была слита с другой — ведём на живую карточку, а не показываем пустоту.
  if (data?.mergedInto) return <Navigate to={`/company/${data.mergedInto}`} replace />;
  if (!data?.company) return <p className={styles.empty}>Компания не найдена.</p>;

  const { company, risk, aliases } = data;
  const projects = projectsQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];
  const similar = similarQuery.data?.items ?? [];
  const mentions = mentionsQuery.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h1>{company.name}</h1>
          <div className={styles.subtitle}>
            {[company.legalForm, company.city, company.bin ? `БИН ${company.bin}` : null]
              .filter(Boolean)
              .join(' · ') || 'Реквизиты не установлены'}
          </div>
        </div>
        <RiskBadge light={risk?.riskLight ?? 'grey'} score={risk?.riskScore} large />
      </div>

      <div
        className={`${styles.verdict} ${risk ? (VERDICT_CLASS[risk.riskLight] ?? '') : ''}`}
        role="status"
      >
        <p className={styles.verdictText}>{buildVerdict(risk)}</p>
      </div>

      {similar.length > 0 && (
        <div className={styles.similar}>
          Похожие компании — возможно, это дубли:{' '}
          {similar.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link to={`/company/${s.id}`}>{s.name}</Link>
              {s.city ? ` (${s.city})` : ''}
            </span>
          ))}
          . Слияние — в админке.
        </div>
      )}

      {risk && (
        <div className={styles.grid}>
          <Stat value={risk.projectsTotal} label="Всего объектов" />
          <Stat value={risk.activeProjects} label="Активных" />
          <Stat value={risk.doneProjects} label="Сдано" />
          <Stat value={risk.delayedProjects} label="Со срывом срока" bad={risk.delayedProjects > 0} />
          <Stat
            value={risk.avgDelayDays === null ? '—' : `${Math.round(risk.avgDelayDays)} дн`}
            label="Средняя задержка"
            bad={(risk.avgDelayDays ?? 0) > 30}
          />
          <Stat value={risk.mentions90d} label="Упоминаний за 90 дн" />
          <Stat value={risk.negative90d} label="Из них негативных" bad={risk.negative90d > 0} />
          <Stat value={risk.hardEvents12m} label="Суды и банкротства" bad={risk.hardEvents12m > 0} />
        </div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Объекты</h2>
          <span className={styles.subtitle}>{projects.length}</span>
        </div>
        {projects.length === 0 ? (
          <p className={styles.empty}>Объекты не найдены.</p>
        ) : (
          projects.map(p => (
            <div key={`${p.id}-${p.role}`} className={styles.card}>
              <div className={styles.projectHead}>
                <span className={styles.projectName}>{p.name}</span>
                <span className={`${styles.tag} ${styles.tagRole}`}>{ROLE_LABELS[p.role]}</span>
                <span className={styles.tag}>{STAGE_LABELS[p.stage] ?? p.stage}</span>
                {p.city && <span className={styles.tag}>{p.city}</span>}
                {p.plannedCompletion && (
                  <span className={styles.tag}>план {formatDate(p.plannedCompletion)}</span>
                )}
              </div>
              {p.counterparties && p.counterparties.length > 0 && (
                <div className={styles.counterparties}>
                  Также на объекте:{' '}
                  {p.counterparties.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ', '}
                      <Link to={`/company/${c.id}`}>{c.name}</Link> ({ROLE_LABELS[c.role]})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {events.length > 0 && (
        <section className={styles.section}>
          <h2>События</h2>
          <div className={styles.card}>
            {events.map(e => (
              <div key={e.id} className={styles.eventRow}>
                <span className={`${styles.eventType} ${e.severity >= 2 ? styles.eventSevere : ''}`}>
                  {EVENT_LABELS[e.type] ?? e.type}
                </span>
                <span className={styles.tag}>{formatDate(e.occurredOn) || 'дата неизвестна'}</span>
                {e.projectName && <span className={styles.tag}>{e.projectName}</span>}
                {e.amountKzt !== null && (
                  <span className={styles.tag}>{formatMoney(e.amountKzt)}</span>
                )}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer noopener">
                    источник
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Упоминания</h2>
          <div className={styles.filters}>
            {SENTIMENT_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                className={`${styles.filterButton} ${
                  sentiment === f.value ? styles.filterButtonActive : ''
                }`}
                onClick={() => setSentiment(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {mentions.length === 0 ? (
          <p className={styles.empty}>
            {mentionsQuery.isLoading ? 'Загрузка…' : 'Упоминаний нет.'}
          </p>
        ) : (
          mentions.map(m => (
            <article
              key={m.id}
              className={`${styles.mention} ${
                m.sentiment === 'negative'
                  ? styles.mentionNegative
                  : m.sentiment === 'positive'
                    ? styles.mentionPositive
                    : ''
              }`}
            >
              <p className={styles.quote}>«{m.quote}»</p>
              <div className={styles.mentionMeta}>
                <span>{formatDate(m.publishedAt)}</span>
                <span>{m.sourceTitle}</span>
                {m.role && <span>{ROLE_LABELS[m.role]}</span>}
                {!m.quoteVerified && (
                  <span className={styles.unverified} title="Цитата не найдена в тексте дословно">
                    цитата не сверена
                  </span>
                )}
                {m.url && (
                  <a href={m.url} target="_blank" rel="noreferrer noopener">
                    оригинал
                  </a>
                )}
              </div>
            </article>
          ))
        )}

        {mentionsQuery.hasNextPage && (
          <button
            type="button"
            className={styles.moreButton}
            onClick={() => void mentionsQuery.fetchNextPage()}
            disabled={mentionsQuery.isFetchingNextPage}
          >
            {mentionsQuery.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
          </button>
        )}
      </section>

      {aliases.length > 1 && (
        <section className={styles.section}>
          <h3>Варианты написания</h3>
          <p className={styles.subtitle}>{aliases.map(a => a.alias).join(' · ')}</p>
        </section>
      )}
    </>
  );
};

const Stat: FC<{ value: number | string; label: string; bad?: boolean }> = ({
  value,
  label,
  bad = false,
}) => (
  <div className={styles.stat}>
    <div className={`${styles.statValue} ${bad ? styles.statValueBad : ''}`}>{value}</div>
    <div className={styles.statLabel}>{label}</div>
  </div>
);
