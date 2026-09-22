// Краткая сводка о компании: пять-шесть строк, с которых начинается карточка.
//
// Здесь нет ни одного нового числа: всё берётся из снимка сигналов и уже загруженных
// объектов и событий. Итоговой оценки, балла и светофора нет и не будет (ADR-009) —
// сводка отвечает «что известно», а не «хорошая ли это компания».
//
// Снимок может быть не рассчитан или устареть. Тогда сводка говорит это словами
// и показывает то, что видно без него, а не подставляет ноль вместо неизвестного.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IEventRow, IProjectRow, ISignalsResponse, Role } from '../api/types';
import {
  ASSERTION_ROLE_LABELS,
  EVENT_LABELS,
  IDENTITY_STATUS_LABELS,
  ROLE_LABELS,
  formatDate,
  formatDateTime,
} from '../lib/labels';
import { Section } from './ui/Section';
import styles from './CompanyBrief.module.css';

interface ICompanyBriefProps {
  companyId: number;
  /** Реквизиты и форма из шапки карточки: повторный запрос ради них не нужен. */
  facts: string[];
  projects: IProjectRow[];
  events: IEventRow[];
}

const Line: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={styles.line}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>{children}</span>
  </div>
);

/** Роли по объектам карточки: запасной путь, когда снимка сигналов нет. */
const rolesFromProjects = (projects: IProjectRow[]): string => {
  const counts = new Map<Role, number>();
  for (const p of projects) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
  if (counts.size === 0) return 'роль не названа ни в одной публикации';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${ROLE_LABELS[role]} — ${n}`)
    .join(', ');
};

export const CompanyBrief: FC<ICompanyBriefProps> = ({ companyId, facts, projects, events }) => {
  const query = useQuery({
    queryKey: ['company', companyId, 'signals'],
    queryFn: () => api.get<ISignalsResponse>(`/api/companies/${companyId}/signals`),
  });

  const signals = query.data?.signals ?? null;
  const refresh = query.data?.refresh;
  const lastEvent = events[0] ?? null;
  const cities = [...new Set(projects.map(p => p.city).filter((c): c is string => Boolean(c)))];

  const rolesText = signals
    ? Object.entries(signals.experience.byRole)
        .filter(([, agg]) => (agg.value ?? 0) > 0)
        .sort((a, b) => (b[1].value ?? 0) - (a[1].value ?? 0))
        .map(([role, agg]) => `${ASSERTION_ROLE_LABELS[role] ?? role} — ${agg.value}`)
        .join(', ')
    : rolesFromProjects(projects);

  const publications = signals?.media.publications;
  const latest = signals?.media.latestPublishedAt;

  return (
    <Section title="Коротко">
      <div className={styles.lines}>
        <Line label="Кто это">{facts.length > 0 ? facts.join(' · ') : 'реквизиты не установлены'}</Line>

        {signals && (
          <Line label="Идентификация">
            {IDENTITY_STATUS_LABELS[signals.identity.status] ?? signals.identity.status}
          </Line>
        )}

        <Line label="Роли в публикациях">{rolesText === '' ? 'роль не названа' : rolesText}</Line>

        <Line label="Объекты">
          {projects.length === 0
            ? 'в выборке нет'
            : `${projects.length}${cities.length > 0 ? ` · ${cities.slice(0, 4).join(', ')}` : ''}`}
        </Line>

        <Line label="Публикации">
          {publications && publications.status === 'ok'
            ? `${publications.value} в выборке${latest?.value ? `, последняя ${formatDate(latest.value)}` : ''}`
            : 'сколько их — станет известно после пересчёта сигналов'}
        </Line>

        <Line label="Последнее событие">
          {lastEvent
            ? `${EVENT_LABELS[lastEvent.type] ?? lastEvent.type}${
                lastEvent.occurredOn ? ` · ${formatDate(lastEvent.occurredOn)}` : ' · дата неизвестна'
              }${lastEvent.projectName ? ` · ${lastEvent.projectName}` : ''}`
            : 'событий в выборке нет'}
        </Line>
      </div>

      <p className={styles.note}>
        {refresh?.active
          ? `Числа — на срез ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' (устарел)' : ''}.`
          : 'Сигналы ещё не рассчитывались: числа ниже собраны без снимка.'}{' '}
        Это сведения из открытых публикаций, а не проверка контрагента и не оценка надёжности.
      </p>
    </Section>
  );
};
