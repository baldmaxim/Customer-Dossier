import { FC, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ICompanyResponse, IEventRow, IProjectRow, IPublicationRow } from '../api/types';
import { RegistryPanel } from '../components/RegistryPanel';
import { CompanyBrief } from '../components/CompanyBrief';
import { CompanyPartners } from '../components/CompanyPartners';
import { CompanyProjects } from '../components/CompanyProjects';
import { CompanyProjectDetail } from '../components/CompanyProjectDetail';
import { CompanySignals } from '../components/CompanySignals';
import { CompanySummary } from '../components/CompanySummary';
import { CompanyReviewOverview } from '../components/CompanyReviewOverview';
import { GraphPanel } from '../components/GraphPanel';
import { PublicationBrowser, type IPublicationListItem } from '../components/PublicationBrowser';
import { Segmented } from '../components/ui/Segmented';
import { EVENT_LABELS, ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, RELATION_LABELS, formatDate, formatMoney, sourceLabel } from '../lib/labels';
import { factText } from '../lib/publicationFacts';
import styles from './CompanyPage.module.css';

type View = 'dossier' | 'publications';
const VIEWS: ReadonlyArray<{ value: View; label: string; hint?: string }> = [
  { value: 'dossier', label: 'Обзор', hint: 'досье компании, объекты, связи и основания' },
  { value: 'publications', label: 'Публикации', hint: 'сообщения источников и исходный текст' },
];
const SILENT_PREDICATES = new Set(['company_mentioned', 'project_mentioned']);
const toListItem = (row: IPublicationRow): IPublicationListItem => ({
  key: row.itemId, revisionId: row.revisionId, title: row.title, topic: row.topic,
  publishedAt: row.publishedAt, observedAt: row.observedAt, sourceTitle: row.sourceTitle,
  sourceKey: row.sourceKey, sourceKind: row.sourceKind, url: row.url, snippet: row.snippet,
  facts: row.facts.filter(f => !SILENT_PREDICATES.has(f.predicate)).map(factText),
});
const eventSourceName = (event: IEventRow): string => {
  if (event.sourceTitle) return sourceLabel({
    sourceTitle: event.sourceTitle, sourceKey: event.sourceKey, sourceKind: event.sourceKind ?? '',
  });
  if (event.url) {
    try { return new URL(event.url).hostname; } catch { return 'Публикация'; }
  }
  return 'Источник не указан';
};

export const CompanyPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const [view, setView] = useState<View>('dossier');
  const [showEvidence, setShowEvidence] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [projectSelection, setProjectSelection] = useState<{ companyId: number; projectId: number } | null>(null);
  const companyQuery = useQuery({ queryKey: ['company', companyId], queryFn: () => api.get<ICompanyResponse>(`/api/companies/${companyId}`), enabled: Number.isFinite(companyId) });
  const projectsQuery = useQuery({ queryKey: ['company', companyId, 'projects'], queryFn: () => api.get<{ items: IProjectRow[] }>(`/api/companies/${companyId}/projects`), enabled: Number.isFinite(companyId) });
  const eventsQuery = useQuery({ queryKey: ['company', companyId, 'events'], queryFn: () => api.get<{ items: IEventRow[] }>(`/api/companies/${companyId}/events`), enabled: Number.isFinite(companyId) });
  const similarQuery = useQuery({ queryKey: ['company', companyId, 'similar'], queryFn: () => api.get<{ items: Array<{ id: number; name: string; city: string | null }> }>(`/api/companies/${companyId}/similar`), enabled: Number.isFinite(companyId) });
  const publicationsQuery = useInfiniteQuery({
    queryKey: ['company', companyId, 'publications'], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IPublicationRow[]; nextCursor: string | null }>(`/api/companies/${companyId}/publications?${params}`);
    },
    getNextPageParam: last => last.nextCursor,
    enabled: Number.isFinite(companyId) && view === 'publications',
  });
  if (!Number.isFinite(companyId)) return <p className={styles.empty}>Некорректный адрес карточки.</p>;
  if (companyQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (companyQuery.isError) return <p className={styles.empty}>Компания не найдена.</p>;
  const data = companyQuery.data;
  if (data?.mergedInto) return <Navigate to={`/company/${data.mergedInto}`} replace />;
  if (!data?.company) return <p className={styles.empty}>Компания не найдена.</p>;

  const { company, aliases, identifiers = [], relations = [], registry } = data;
  const projects = projectsQuery.data?.items ?? [];
  const selectedProjectId = projectSelection?.companyId === companyId ? projectSelection.projectId : null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const events = eventsQuery.data?.items ?? [];
  const featuredEvents = events.filter(e => e.type !== 'other').slice(0, 4);
  const previewEvents = featuredEvents.length ? featuredEvents : events.slice(0, 4);
  const similar = similarQuery.data?.items ?? [];
  const identifierFacts = identifiers.length > 0
    ? identifiers.map(i => `${IDENTIFIER_TYPE_LABELS[i.type] ?? i.type} ${i.value}`)
    : company.taxId ? [`ИНН/ОГРН ${company.taxId}`] : [];
  const identityFacts = [company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null,
    company.legalForm, company.city, ...identifierFacts].filter((value): value is string => Boolean(value));
  const openEvidence = (): void => {
    setShowEvidence(true);
    document.getElementById('company-evidence')?.scrollIntoView?.({ behavior: 'smooth' });
  };
  const selectProject = (projectId: number): void => {
    setProjectSelection({ companyId, projectId });
    if (window.matchMedia?.('(max-width: 899px)').matches) {
      window.requestAnimationFrame(() => document.getElementById('company-project-detail')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    }
  };

  return <>
    <header className={`${styles.dossierHeader} ${view === 'publications' ? styles.readerHeader : ''}`}>
      <div>
        <p className={styles.eyebrow}>Компания №{company.id} · сведения из источников</p>
        <h1 className={styles.name}>{company.name}</h1>
        <div className={styles.facts}>{identityFacts.length ? identityFacts.map(fact => <span key={fact} className={styles.fact}>{fact}</span>) : <span>Реквизиты не установлены</span>}</div>
      </div>
      <Segmented label="Вид карточки" items={VIEWS} value={view} onChange={setView} size="md" />
    </header>
    {view === 'dossier' && similar.length > 0 && <div className={styles.callout}>
      <strong>Похожие названия — проверьте идентификацию: </strong>
      {similar.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link to={`/company/${s.id}`}>{s.name}</Link>{s.city ? ` (${s.city})` : ''}</span>)}.
    </div>}

    {view === 'dossier' && <div className={styles.dossierBody}>
      <CompanyBrief companyId={companyId} projects={projects} events={events} projectsKnown={projectsQuery.isSuccess} eventsKnown={eventsQuery.isSuccess} />
      <CompanyReviewOverview companyId={companyId} registry={registry ?? null} onOpenEvidence={openEvidence} />
      <div className={styles.projectWorkspace}>
        <CompanyProjects projects={projects} isLoading={projectsQuery.isLoading} error={projectsQuery.error}
          selectedProjectId={selectedProjectId} onSelect={selectProject} />
        <CompanyProjectDetail companyId={companyId} project={selectedProject} />
      </div>
      <div className={styles.overview}>
        <div className={styles.overviewCol}>
          <CompanyPartners companyId={companyId} />
        </div>
        <div className={styles.overviewCol}>
          {events.length > 0 && <section className={styles.eventsPanel}>
            <h2>События из публикаций <span className={styles.count}>{events.length}</span></h2>
            <ol className={styles.timeline}>{(showAllEvents ? events : previewEvents).map(e => {
              const sourceName = eventSourceName(e);
              return <li key={e.id} className={styles.event}>
              <div className={styles.eventHead}>
                <span className={styles.eventType}>{EVENT_LABELS[e.type] ?? e.type}</span>
                <span className={styles.eventDate}>{formatDate(e.occurredOn) || 'дата неизвестна'}</span>
              </div>
              <div className={styles.eventMeta}>
                {e.projectName && <span className={styles.tag}>{e.projectName}</span>}
                {e.amountRub !== null && <span className={styles.tag}>{formatMoney(e.amountRub)}</span>}
                {e.url
                  ? <a className={styles.eventSource} href={e.url} target="_blank" rel="noreferrer noopener" aria-label={`${sourceName} — открыть публикацию`}>{sourceName}</a>
                  : <span className={styles.eventSource}>{sourceName}</span>}
              </div>
            </li>})}</ol>
            {events.length > previewEvents.length && <button type="button" className={styles.evidenceToggle} onClick={() => setShowAllEvents(v => !v)}>{showAllEvents ? 'Свернуть события' : `Показать все ${events.length} событий`}</button>}
          </section>}
        </div>
      </div>
      <GraphPanel companyId={companyId} />
      <section id="company-evidence" className={styles.evidenceSection}>
        <button type="button" className={styles.evidenceToggle} aria-expanded={showEvidence} onClick={() => setShowEvidence(v => !v)}>
          {showEvidence ? 'Скрыть' : 'Открыть'} основания и проверку данных
        </button>
        <p>Подробные сигналы, реестр, резюме и исходные утверждения.</p>
        {showEvidence && <div className={styles.evidenceContent}>
          <RegistryPanel registry={registry ?? null} title="Данные реестра о застройщике" />
          <CompanySignals companyId={companyId} projectNames={new Map(projects.map(p => [p.id, p.name]))} />
          <CompanySummary companyId={companyId} />
          {relations.length > 0 && <section><h2>Связи из реестра</h2><ul>{relations.map(r => <li key={r.id}>{RELATION_LABELS[r.relationType]?.[r.direction] ?? r.relationType} «{r.otherCompanyName}»{r.status === 'candidate' ? ' · не подтверждено' : ''}</li>)}</ul></section>}
          {aliases.length > 1 && <section><h2>Варианты написания</h2><p>{aliases.map(a => a.alias).join(' · ')}</p></section>}
        </div>}
      </section>
    </div>}
    {view === 'publications' && <PublicationBrowser
      items={(publicationsQuery.data?.pages.flatMap(p => p.items) ?? []).map(toListItem)}
      isLoading={publicationsQuery.isLoading} error={publicationsQuery.error}
      hasMore={publicationsQuery.hasNextPage} loadingMore={publicationsQuery.isFetchingNextPage}
      onLoadMore={() => void publicationsQuery.fetchNextPage()}
      empty="Публикаций об этой компании в выборке нет. Это значит только то, что в собранных источниках её не нашли."
    />}
  </>;
};
