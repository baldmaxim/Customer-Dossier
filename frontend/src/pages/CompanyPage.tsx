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
import {
  ROLE_LABELS,
  STAGE_LABELS,
  EVENT_LABELS,
  SENTIMENT_LABELS,
  formatDate,
  formatMoney,
} from '../lib/labels';
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

/** Цветная полоса на карточке вердикта — тот же светофор, что и в бейдже. */
const HERO_CLASS: Record<string, string> = {
  grey: styles.heroGrey ?? '',
  green: styles.heroGreen ?? '',
  yellow: styles.heroYellow ?? '',
  red: styles.heroRed ?? '',
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

  if (!Number.isFinite(companyId)) return <p className={styles.empty}>Некорректный адрес карточки.</p>;
  if (companyQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (companyQuery.isError) return <p className={styles.empty}>Компания не найдена.</p>;

  const data = companyQuery.data;
  // Компания была слита с другой — ведём на живую карточку, а не показываем пустоту.
  if (data?.mergedInto) return <Navigate to={`/company/${data.mergedInto}`} replace />;
  if (!data?.company) return <p className={styles.empty}>Компания не найдена.</p>;

  const { company, risk, aliases } = data;
  const light = risk?.riskLight ?? 'grey';
  const projects = projectsQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];
  const similar = similarQuery.data?.items ?? [];
  const mentions = mentionsQuery.data?.pages.flatMap(p => p.items) ?? [];
  const facts = [company.legalForm, company.city, company.bin ? `БИН ${company.bin}` : null].filter(
    (value): value is string => Boolean(value),
  );

  return (
    <>
      {/* Шапка карточки. Вердикт и светофор должны читаться до прокрутки. */}
      <header className={`${styles.hero} ${HERO_CLASS[light] ?? ''}`}>
        <div className={styles.heroTop}>
          <div className={styles.heroTitle}>
            <h1 className={styles.name}>{company.name}</h1>
            <div className={styles.facts}>
              {facts.length > 0 ? (
                facts.map(fact => (
                  <span key={fact} className={styles.fact}>
                    {fact}
                  </span>
                ))
              ) : (
                <span className={styles.factMuted}>Реквизиты не установлены</span>
              )}
            </div>
          </div>
          <RiskBadge light={light} score={risk?.riskScore} large />
        </div>

        <p className={styles.verdict} role="status">
          {buildVerdict(risk)}
        </p>

        {risk?.lastMentionAt && (
          <p className={styles.heroFoot}>
            Последнее упоминание — {formatDate(risk.lastMentionAt)}
          </p>
        )}
      </header>

      {similar.length > 0 && (
        <div className={styles.callout}>
          <span className={styles.calloutTitle}>Похожие компании — возможно, это дубли</span>{' '}
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
          <Stat
            value={risk.delayedProjects}
            label="Со срывом срока"
            bad={risk.delayedProjects > 0}
          />
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
          <span className={styles.count}>{projects.length}</span>
        </div>
        {projects.length === 0 ? (
          <p className={styles.empty}>Объекты не найдены.</p>
        ) : (
          <div className={styles.stack}>
            {projects.map(p => (
              <article key={`${p.id}-${p.role}`} className={styles.card}>
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
              </article>
            ))}
          </div>
        )}
      </section>

      {events.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>События</h2>
            <span className={styles.count}>{events.length}</span>
          </div>
          <ol className={styles.timeline}>
            {events.map(e => (
              <li
                key={e.id}
                className={`${styles.event} ${e.severity >= 2 ? styles.eventSevere : ''}`}
              >
                <div className={styles.eventHead}>
                  <span className={styles.eventType}>{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className={styles.eventDate}>
                    {formatDate(e.occurredOn) || 'дата неизвестна'}
                  </span>
                </div>
                <div className={styles.eventMeta}>
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
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Упоминания</h2>
          <div className={styles.segmented} role="group" aria-label="Тональность упоминаний">
            {SENTIMENT_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                aria-pressed={sentiment === f.value}
                className={`${styles.segment} ${
                  sentiment === f.value ? styles.segmentActive : ''
                }`}
                onClick={() => setSentiment(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {mentions.length === 0 ? (
          <p className={styles.empty}>{mentionsQuery.isLoading ? 'Загрузка…' : 'Упоминаний нет.'}</p>
        ) : (
          <div className={styles.stack}>
            {mentions.map(m => (
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
                <p className={styles.quote}>{m.quote}</p>
                <div className={styles.mentionMeta}>
                  {/* Тональность подписана словом: одной полосы у края мало. */}
                  <span
                    className={`${styles.sentiment} ${
                      m.sentiment === 'negative'
                        ? styles.sentimentNegative
                        : m.sentiment === 'positive'
                          ? styles.sentimentPositive
                          : ''
                    }`}
                  >
                    {SENTIMENT_LABELS[m.sentiment]}
                  </span>
                  <span>{formatDate(m.publishedAt)}</span>
                  <span className={styles.source}>{m.sourceTitle}</span>
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
            ))}
          </div>
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
          <h3 className={styles.aliasTitle}>Варианты написания</h3>
          <div className={styles.aliases}>
            {aliases.map(a => (
              <span key={a.alias} className={styles.tag}>
                {a.alias}
              </span>
            ))}
          </div>
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
  <div className={`${styles.stat} ${bad ? styles.statBad : ''}`}>
    <div className={styles.statValue}>{value}</div>
    <div className={styles.statLabel}>{label}</div>
  </div>
);
