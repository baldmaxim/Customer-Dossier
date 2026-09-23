// Карточка компании: три вкладки на три вопроса.
//
//   «Обзор»      — что с компанией сейчас: сводка и с кем работает, рядом, без прокрутки;
//   «Публикации» — что о ней пишут: список слева, сам пост справа в виде Telegram;
//   «Подробно»   — откуда это известно: сигналы с правилами, досье, объекты, события, схема.
//
// Раньше лента публикаций стояла в обзоре под сводкой, и половина экрана справа пустовала,
// а чтобы прочитать пост, приходилось уходить на отдельную страницу со служебным разбором.
// Доказательная часть никуда не делась — ни одно число не изменилось, изменился порядок.

import { FC, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanyResponse, IEventRow, IMention, IProjectRow, IPublicationRow, Sentiment } from '../api/types';
import { RegistryPanel } from '../components/RegistryPanel';
import { CompanyBrief } from '../components/CompanyBrief';
import { CompanyPartners } from '../components/CompanyPartners';
import { CompanySignals } from '../components/CompanySignals';
import { CompanySummary } from '../components/CompanySummary';
import { GraphPanel } from '../components/GraphPanel';
import { PublicationBrowser, type IPublicationListItem } from '../components/PublicationBrowser';
import { Segmented } from '../components/ui/Segmented';
import { ROLE_LABELS, STAGE_LABELS, EVENT_LABELS, SENTIMENT_LABELS, formatDate, formatMoney } from '../lib/labels';
import { ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, RELATION_LABELS } from '../lib/labels';
import { factText } from '../lib/publicationFacts';
import styles from './CompanyPage.module.css';

const SENTIMENT_FILTERS: Array<{ value: Sentiment | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'negative', label: 'Негатив' },
  { value: 'positive', label: 'Позитив' },
];

type View = 'overview' | 'publications' | 'details';

const VIEWS: ReadonlyArray<{ value: View; label: string; hint?: string }> = [
  { value: 'overview', label: 'Обзор', hint: 'сводка и контрагенты' },
  { value: 'publications', label: 'Публикации', hint: 'что о компании пишут: список и сам пост' },
  { value: 'details', label: 'Подробно', hint: 'сигналы с правилами, доказательства, объекты, события и схема связей' },
];

/** Чистое «упомянута» ничего не говорит о компании — в строке списка оно шум. */
const SILENT_PREDICATES = new Set(['company_mentioned', 'project_mentioned']);

const toListItem = (row: IPublicationRow): IPublicationListItem => ({
  key: row.itemId,
  revisionId: row.revisionId,
  title: row.title,
  topic: row.topic,
  publishedAt: row.publishedAt,
  observedAt: row.observedAt,
  sourceTitle: row.sourceTitle,
  sourceKey: row.sourceKey,
  sourceKind: row.sourceKind,
  url: row.url,
  snippet: row.snippet,
  facts: row.facts.filter(f => !SILENT_PREDICATES.has(f.predicate)).map(factText),
});

export const CompanyPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const [view, setView] = useState<View>('overview');
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

  // Публикации грузятся, когда их открыли: обзор не ждёт ленту.
  const publicationsQuery = useInfiniteQuery({
    queryKey: ['company', companyId, 'publications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IPublicationRow[]; nextCursor: string | null }>(
        `/api/companies/${companyId}/publications?${params}`,
      );
    },
    getNextPageParam: last => last.nextCursor,
    enabled: Number.isFinite(companyId) && view === 'publications',
  });

  // Старая лента упоминаний — только во вкладке «Подробно»: тянуть legacy-таблицу заранее незачем.
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
    enabled: Number.isFinite(companyId) && view === 'details',
  });

  if (!Number.isFinite(companyId)) return <p className={styles.empty}>Некорректный адрес карточки.</p>;
  if (companyQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (companyQuery.isError) return <p className={styles.empty}>Компания не найдена.</p>;

  const data = companyQuery.data;
  // Компания была слита с другой — ведём на живую карточку, а не показываем пустоту.
  if (data?.mergedInto) return <Navigate to={`/company/${data.mergedInto}`} replace />;
  if (!data?.company) return <p className={styles.empty}>Компания не найдена.</p>;

  const { company, aliases, identifiers = [], relations = [], registry } = data;
  const projects = projectsQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];
  const similar = similarQuery.data?.items ?? [];
  const mentions = mentionsQuery.data?.pages.flatMap(p => p.items) ?? [];
  // Реквизиты по типу из реестра (этап 04); старая проекция tax_id — только если реестр пуст.
  const identifierFacts =
    identifiers.length > 0
      ? identifiers.map(i => `${IDENTIFIER_TYPE_LABELS[i.type] ?? i.type} ${i.value}`)
      : company.taxId
        ? [`ИНН/ОГРН ${company.taxId}`]
        : [];
  const facts = [
    company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null,
    company.legalForm,
    company.city,
    ...identifierFacts,
    ...relations.map(
      r => `${RELATION_LABELS[r.relationType]?.[r.direction] ?? r.relationType} «${r.otherCompanyName}»${r.status === 'candidate' ? ' (не подтверждено)' : ''}`,
    ),
  ].filter((value): value is string => Boolean(value));

  return (
    <>
      {/* Верхняя строка: кто это — компактно слева, рядом вкладки и (если есть) похожие компании.
          Раньше шапка шла во всю ширину, а вкладки и плашка — отдельными строками: на экране
          читалки публикаций это три строки высоты, отнятые у списка. Итоговой оценки нет (этап 07). */}
      <div className={styles.top}>
        <header className={styles.hero}>
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
          </div>
        </header>
        <div className={styles.heroSwitch}>
          <Segmented label="Вид карточки" items={VIEWS} value={view} onChange={setView} size="md" />
        </div>
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
      </div>

      {view === 'overview' && (
        // Сводка и контрагенты рядом: оба блока короткие, и в одну колонку справа пустовало.
        <div className={styles.overview}>
          <CompanyBrief companyId={companyId} facts={facts} projects={projects} events={events} />
          <CompanyPartners companyId={companyId} />
        </div>
      )}

      {view === 'publications' && (
        <PublicationBrowser
          items={(publicationsQuery.data?.pages.flatMap(p => p.items) ?? []).map(toListItem)}
          isLoading={publicationsQuery.isLoading}
          error={publicationsQuery.error}
          hasMore={publicationsQuery.hasNextPage}
          loadingMore={publicationsQuery.isFetchingNextPage}
          onLoadMore={() => void publicationsQuery.fetchNextPage()}
          empty="Публикаций об этой компании в выборке нет. Это значит только то, что в собранных источниках её не нашли, — а не то, что о ней не писали."
        />
      )}

      {view === 'details' && (
        <>
          <RegistryPanel registry={registry ?? null} title="Данные реестра о застройщике" />

          {/* Показатели — во всю ширину: в узкой колонке плитки рвали подписи. */}
          <section className={styles.metrics} aria-label="Показатели компании">
            <CompanySignals companyId={companyId} projectNames={new Map(projects.map(p => [p.id, p.name]))} />
          </section>

          <div className={styles.columns}>
            <div className={styles.colMain}>
              <CompanySummary companyId={companyId} />

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
                          <span className={styles.projectName}><Link to={`/projects/${p.id}`}>{p.name}</Link></span>
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
                      <li key={e.id} className={styles.event}>
                        <div className={styles.eventHead}>
                          <span className={styles.eventType}>По сообщению источника: {EVENT_LABELS[e.type] ?? e.type}</span>
                          <span className={styles.eventDate}>{formatDate(e.occurredOn) || 'дата неизвестна'}</span>
                        </div>
                        <div className={styles.eventMeta}>
                          {e.projectName && <span className={styles.tag}>{e.projectName}</span>}
                          {e.amountRub !== null && <span className={styles.tag}>{formatMoney(e.amountRub)}</span>}
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

              {/* Упоминания старого разбора. Новый конвейер в эту таблицу не пишет:
                  свежие публикации — в ленте на вкладке «Обзор». */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Упоминания из старого разбора</h2>
                  <div className={styles.segmented} role="group" aria-label="Тональность упоминаний">
                    {SENTIMENT_FILTERS.map(f => (
                      <button
                        key={f.value}
                        type="button"
                        aria-pressed={sentiment === f.value}
                        className={`${styles.segment} ${sentiment === f.value ? styles.segmentActive : ''}`}
                        onClick={() => setSentiment(f.value)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mentions.length === 0 ? (
                  <p className={styles.empty}>
                    {mentionsQuery.isLoading
                      ? 'Загрузка…'
                      : 'Упоминаний старого разбора нет. Публикации, собранные нынешним конвейером, — в ленте на вкладке «Обзор».'}
                  </p>
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
                          <Link to={`/documents/${m.documentId}`}>версии</Link>
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
            </div>
            <aside className={styles.colSide}>
              <GraphPanel companyId={companyId} />
            </aside>
          </div>
        </>
      )}
    </>
  );
};
