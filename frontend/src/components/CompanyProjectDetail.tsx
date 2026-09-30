import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IProjectDossier, IProjectRow, IRegistryView, IStatement } from '../api/types';
import { ASSERTION_ROLE_LABELS, CONTEXT_STATE_LABELS, PROJECT_LEVEL_LABELS, STAGE_LABELS, formatDate } from '../lib/labels';
import { GraphPanel } from './GraphPanel';
import { PublicationSourceButton } from './PublicationModal';
import { RegistryPanel } from './RegistryPanel';
import { StatementList } from './StatementList';
import styles from './CompanyProjectDetail.module.css';

interface Props {
  companyId: number;
  project: IProjectRow | null;
}

const previewText = (statement: IStatement): string => statement.quotes[0]?.quote ?? statement.text;

const REGISTRY_MAIN_FIELDS = [
  'Статус строительства', 'Сдача дома', 'Количество квартир', 'Класс недвижимости',
  'Средняя цена за 1 м²', 'Распроданность квартир', 'Застройщик', 'Генподрядчики', 'Генподрядчик', 'Группа компаний',
];

const registryMainFields = (registry: IRegistryView): Array<{ label: string; value: string }> => {
  const fields = registry.address ? [{ label: 'Адрес', value: registry.address }] : [];
  for (const label of REGISTRY_MAIN_FIELDS) {
    const field = registry.fields.find(item => item.label === label);
    if (field) fields.push(field);
    else if (label === 'Застройщик' && registry.developer) fields.push({ label, value: registry.developer.name });
    else if (label === 'Группа компаний' && registry.groupName) fields.push({ label, value: registry.groupName });
  }
  return fields;
};

export const CompanyProjectDetail: FC<Props> = ({ companyId, project }) => {
  const projectId = project?.id ?? null;
  const query = useQuery({
    queryKey: ['project', projectId, 'dossier', '', ''],
    queryFn: () => api.get<IProjectDossier>(`/api/projects/${projectId}/dossier`),
    enabled: projectId !== null,
  });

  if (!project) return <section id="company-project-detail" className={`${styles.panel} ${styles.placeholder}`} aria-label="Сведения об объекте">
    <h2>Сведения об объекте</h2>
    <p>Выберите объект слева, чтобы увидеть основные сведения.</p>
  </section>;

  const d = query.data;
  const currentState = d?.state.current[0];
  const otherParticipants = d?.participants.filter(p => p.companyId !== companyId) ?? [];
  const hasAdditionalData = Boolean(d && (d.project.parent || d.project.children.length > 0 || d.state.history.length > 1 ||
    otherParticipants.length > 0 || d.contracts.length > 0 || d.events.length > 0 || d.notCounted.length > 0 ||
    d.cases.length > 0));
  return <section id="company-project-detail" className={styles.panel} aria-label={`Сведения об объекте ${project.name}`}>
    <div className={styles.head}>
      <div>
        <p className={styles.kicker}>Объект</p>
        <h2>{d?.project.name ?? project.name}</h2>
        <p className={styles.meta}>
          {project.city ?? d?.project.city ?? 'Город не указан'} · {STAGE_LABELS[project.stage] ?? project.stage}
          {d?.project.level && ` · ${PROJECT_LEVEL_LABELS[d.project.level] ?? d.project.level}${d.project.levelLabel ? ` ${d.project.levelLabel}` : ''}`}
        </p>
        {project.plannedCompletion && <p className={styles.meta}>Плановый срок: {formatDate(project.plannedCompletion)}</p>}
        {project.actualCompletion && <p className={styles.meta}>Фактическое завершение: {formatDate(project.actualCompletion)}</p>}
        {project.basis === 'event' && <p className={styles.meta}>Связь с компанией: событие · роль не установлена</p>}
      </div>
      <Link className={styles.fullLink} to={`/projects/${d?.project.mergedIntoId ?? project.id}`}>Открыть объект ↗</Link>
    </div>

    {query.isLoading && <p className={styles.meta}>Загрузка сведений об объекте…</p>}
    {query.isError && <p role="alert" className={styles.error}>Не удалось загрузить досье объекта. Полная карточка доступна по ссылке выше.</p>}
    {d && <div className={styles.content}>
      {d.registry && <section className={styles.registryLead} aria-label="Основные сведения реестра">
        <div className={styles.registryHead}>
          <h3>Сведения реестра</h3>
          <span>{d.registry.source.title} · запись №{d.registry.externalRef}</span>
        </div>
        <p className={styles.registryDate}>Снимок получен {formatDate(d.registry.fetchedAt)}{d.registry.asOf ? ` · сведения на ${formatDate(d.registry.asOf)}` : ''}</p>
        <div className={styles.registryFacts}>
          {registryMainFields(d.registry).map(field => <div className={styles.registryFact} key={field.label}>
            <span>{field.label}</span><strong>{field.value}</strong>
          </div>)}
        </div>
        <p className={styles.registryAttribution}>{d.registry.attribution}</p>
        <details className={styles.registryMore}>
          <summary>Все сведения и изменения</summary>
          <RegistryPanel registry={d.registry} title="Полные сведения реестра" />
        </details>
      </section>}
      {(!d.registry || currentState) && <div className={styles.status}>
        <span>{d.registry ? 'Состояние по публикациям' : 'Состояние'}</span>
        <strong>{currentState ? `${currentState.building ? `${currentState.building}: ` : ''}${CONTEXT_STATE_LABELS[currentState.state] ?? currentState.state}` : 'не установлено'}</strong>
        {currentState?.validFrom && <span>с {formatDate(currentState.validFrom)}</span>}
      </div>}

      {otherParticipants.length > 0 && <div className={styles.previewBlock}>
        <h3>Другие участники <span className={styles.count}>{otherParticipants.length}</span></h3>
        <ul className={styles.people}>{otherParticipants.map((p, i) => <li key={`${p.companyId}-${p.role}-${i}`}>
          <Link to={`/company/${p.companyId}`}>{p.companyName}</Link>
          <span>{ASSERTION_ROLE_LABELS[p.role ?? ''] ?? p.role ?? 'роль не указана'}{p.workPackage && ` · ${p.workPackage}`}</span>
        </li>)}</ul>
      </div>}

      {d.events.length > 0 && <div className={styles.previewBlock}>
        <h3>События <span className={styles.count}>{d.events.length}</span></h3>
        <ul className={styles.previewList}>{d.events.slice(0, 3).map((event, i) => <li key={`${event.assertionIds.join('-')}-${i}`}>
          <span className={styles.previewText}>{previewText(event)}</span>
          <span className={styles.previewSource}>Источник: {event.quotes[0] ? <PublicationSourceButton source={event.quotes[0]} /> : 'не указан'}</span>
        </li>)}</ul>
        {d.events.length > 3 && <p className={styles.meta}>Ещё {d.events.length - 3} — в источниках ниже</p>}
      </div>}

      {d.contracts.length > 0 && <div className={styles.previewBlock}>
        <h3>Договоры <span className={styles.count}>{d.contracts.length}</span></h3>
        <ul className={styles.previewList}>{d.contracts.slice(0, 2).map((contract, i) => <li key={`${contract.assertionIds.join('-')}-${i}`}>
          <span className={styles.previewText}>{contract.text}</span>
          <span className={styles.previewSource}>Источник: {contract.quotes[0] ? <PublicationSourceButton source={contract.quotes[0]} /> : 'не указан'}</span>
        </li>)}</ul>
        {d.contracts.length > 2 && <p className={styles.meta}>Ещё {d.contracts.length - 2} — в источниках ниже</p>}
      </div>}

      {hasAdditionalData && <details className={styles.more}>
        <summary>Источники и дополнительные сведения</summary>
        <div className={styles.moreContent}>
      {(d.project.parent || d.project.children.length > 0) && <div className={styles.block}>
        <h3>Состав объекта</h3>
        {d.project.parent && <p>Входит в <Link to={`/projects/${d.project.parent.id}`}>{d.project.parent.name}</Link></p>}
        {d.project.children.length > 0 && <p>Очереди и корпуса: {d.project.children.map((child, i) => <span key={child.id}>
          {i > 0 && ', '}<Link to={`/projects/${child.id}`}>{child.levelLabel ?? child.name}</Link>
        </span>)}</p>}
      </div>}

      {d.state.history.length > 1 && <div className={styles.block}>
        <h3>История состояния</h3>
        <p className={styles.meta}>{d.state.history.map(s => `${CONTEXT_STATE_LABELS[s.state] ?? s.state} ${formatDate(s.validFrom)}`).join(' → ')}</p>
      </div>}

      {otherParticipants.length > 0 && <div className={styles.block}>
        <h3>Другие участники <span className={styles.count}>{otherParticipants.length}</span></h3>
        <ul>{otherParticipants.map((p, i) => <li key={`${p.companyId}-${p.role}-${i}`}>
            <Link to={`/company/${p.companyId}`}>{p.companyName}</Link>
            {' · '}{ASSERTION_ROLE_LABELS[p.role ?? ''] ?? p.role ?? 'роль не указана'}
            {p.building && ` · ${p.building}`}{p.workPackage && ` · ${p.workPackage}`}
            {p.validFrom && ` · с ${formatDate(p.validFrom)}`}{p.validTo && ` по ${formatDate(p.validTo)}`}
          </li>)}</ul>
        <details><summary>Основания участия</summary><StatementList items={otherParticipants.map(p => p.statement)} showPublicationSource /></details>
      </div>}

      {d.contracts.length > 0 && <div className={styles.block}>
        <h3>Договоры <span className={styles.count}>{d.contracts.length}</span></h3>
        <StatementList items={d.contracts} showPublicationSource />
        <p className={styles.meta}>{d.coParticipationNote}</p>
      </div>}

      {d.events.length > 0 && <div className={styles.block}>
        <h3>События <span className={styles.count}>{d.events.length}</span></h3>
        <StatementList items={d.events} showPublicationSource />
      </div>}

      {d.notCounted.length > 0 && <div className={styles.block}>
        <h3>Планы, слухи и отрицания</h3>
        <StatementList items={d.notCounted} showPublicationSource />
      </div>}

      {d.cases.length > 0 && <div className={styles.block}>
        <h3>Обращения</h3>
        <ul>{d.cases.map(c => <li key={c.id}>{c.title} · {c.status}</li>)}</ul>
      </div>}

      <GraphPanel projectId={d.project.id} />
        </div>
      </details>}
    </div>}
  </section>;
};
