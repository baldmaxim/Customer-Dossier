// «Коротко о компании»: плитки-итоги (объекты · события · публикации · связи · суды · реестр)
// и строка ролей. У каждой плитки — разбивка мелко и ссылка туда, где число расписано.
//
// Здесь нет ни одного нового числа: всё берётся из расчёта показателей, уже загруженных
// объектов, событий и реестра — те же числа стоят в «Подробно → Показатели» с правилом и
// знаменателем. Итоговой оценки, балла и светофора нет и не будет (ADR-009) — сводка
// отвечает «что известно», а не «хорошая ли это компания»; плитки одного нейтрального тона.
//
// Показатели могут быть не посчитаны, устареть или не загрузиться. Тогда сводка говорит это
// словами и показывает то, что видно без них, а не подставляет ноль вместо неизвестного.
// Числа правил signals@2 (связи, суды) в старом снимке отсутствуют — их плиток тогда нет.

import { FC } from 'react';

import type { ICompanyObject, ICompanyResponse, ISignalAggregate } from '../api/types';
import { formatCount } from '../lib/format';
import { ASSERTION_ROLE_LABELS, formatDate, formatDateTime } from '../lib/labels';
import { BriefTile } from './company/BriefTile';
import { EVENTS_SECTION_ID } from './company/eventOrder';
import { useCompanyEvents, useCompanySignals } from './company/useCompanyQueries';
import { Button } from './ui/Button';
import { DescriptionList, type IDescriptionItem } from './ui/DescriptionList';
import { Section } from './ui/Section';
import styles from './CompanyBrief.module.css';

interface ICompanyBriefProps {
  companyId: number;
  /** Объекты вкладки «Объекты» (свои и застройщиков группы). */
  objects: ICompanyObject[];
  /** Сколько объектов всего, включая не вошедшие в выборку. */
  objectsTotal: number;
  /** Список объектов пришёл: до этого «—», а не «0». */
  objectsKnown: boolean;
  /** Ответ карточки (из кэша): реестр и его объекты. */
  company?: ICompanyResponse;
}

/** Роли по своим объектам карточки: запасной путь, когда показатели не посчитаны. Роли СЗ группы — не её. */
const rolesFromObjects = (objects: ICompanyObject[]): string[] => {
  const counts = new Map<string, number>();
  for (const o of objects) {
    if (o.via) continue;
    for (const r of o.roles) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${ASSERTION_ROLE_LABELS[role] ?? role} — ${n}`);
};

/** Число показателя: посчитано — числом, нет данных или нет показателя — «—». */
const aggregateText = (aggregate: ISignalAggregate | undefined): string =>
  aggregate?.status === 'ok' ? formatCount(aggregate.value) : '—';

/**
 * «за 90 дней — 4 · последняя 30.09.2026»: только известные части. Пробелы у тире —
 * неразрывные: узкая плитка переносит «ответчик — 3» целиком, а не оставляет «— 3» на
 * следующей строке.
 */
const joinDetail = (parts: Array<string | null>): string | null => {
  const known = parts.filter((p): p is string => Boolean(p)).map(p => p.replace(/ — /g, '\u00a0—\u00a0'));
  return known.length > 0 ? known.join(' · ') : null;
};

const known = (label: string, aggregate: ISignalAggregate | undefined): string | null =>
  aggregate?.status === 'ok' ? `${label} — ${formatCount(aggregate.value)}` : null;

export const CompanyBrief: FC<ICompanyBriefProps> = ({ companyId, objects, objectsTotal, objectsKnown, company }) => {
  const query = useCompanySignals(companyId);
  const events = useCompanyEvents(companyId);
  const signals = query.data?.signals ?? null;
  const refresh = query.data?.refresh;

  const roles = signals
    ? Object.entries(signals.experience.byRole)
        .filter(([, agg]) => (agg.value ?? 0) > 0)
        .sort((a, b) => (b[1].value ?? 0) - (a[1].value ?? 0))
        .map(([role, agg]) => `${ASSERTION_ROLE_LABELS[role] ?? role} — ${agg.value}`)
    : rolesFromObjects(objects);
  const cities = [...new Set(objects.filter(o => !o.via).map(o => o.city).filter((c): c is string => Boolean(c)))];

  const media = signals?.media;
  const experience = signals?.experience;
  const latest = media?.latestPublishedAt;
  const registry = company?.registry ?? null;
  const cases = media?.legalCasesCount;

  const lines: IDescriptionItem[] = [{ label: 'Роли в публикациях', value: roles.join(', ') || 'роль не названа ни в одной публикации' }];
  if (cities.length > 0) lines.push({ label: 'География объектов', value: cities.slice(0, 4).join(', ') });

  return (
    <Section
      title="Коротко о компании"
      note={refresh?.active ? `показатели на ${formatDate(refresh.active.cutoffAt)}` : undefined}
    >
      <dl className={styles.tiles}>
        <BriefTile
          label="Объекты"
          value={objectsKnown ? formatCount(objectsTotal) : '—'}
          detail={joinDetail(roles.slice(0, 2))}
          to={{ search: '?tab=objects' }}
          linkText="Все объекты"
        />
        <BriefTile
          label="События"
          value={events.isSuccess ? formatCount(events.data.items.length) : '—'}
          detail={joinDetail([known('с датой за 12 мес.', media?.eventsDated12m)])}
          to={{ search: '?tab=details', hash: EVENTS_SECTION_ID }}
          linkText="Все события"
        />
        <BriefTile
          label="Публикации"
          value={aggregateText(media?.publications)}
          detail={joinDetail([known('за 90 дней', media?.publications90d), latest?.value ? `последняя ${formatDate(latest.value)}` : null])}
          to={{ search: '?tab=publications' }}
          linkText="Все публикации"
        />
        {experience?.counterparties && (
          <BriefTile
            label="Связи"
            value={aggregateText(experience.counterparties)}
            detail={joinDetail([known('договоров', experience.contractsCount), known('корпоративных', experience.corporateCount)])}
            to={`/links?company=${companyId}`}
            linkText="Все связи"
            viewTransition
          />
        )}
        {media && cases && (
          <BriefTile
            label="Суды"
            value={aggregateText(cases)}
            detail={
              cases.status === 'ok' && (cases.value ?? 0) > 0
                ? joinDetail([`истец — ${formatCount(media.courtRoles.plaintiff)}`, `ответчик — ${formatCount(media.courtRoles.defendant)}`])
                : null
            }
            to={{ search: '?tab=details', hash: 'company-signals' }}
            linkText="Дела подробно"
          />
        )}
        {registry && (
          <BriefTile
            label="Реестр"
            value={formatCount((company?.registryProjects ?? []).length)}
            detail={joinDetail(['объектов в реестре', registry.asOf ? `на ${formatDate(registry.asOf)}` : null])}
            to={{ search: '?tab=details', hash: 'company-registry' }}
            linkText="Сведения реестра"
          />
        )}
      </dl>

      <DescriptionList items={lines} />

      <p className={styles.note}>
        {query.isError ? (
          <>
            Показатели не загрузились — числа публикаций не показаны.{' '}
            <Button variant="link" size="sm" onClick={() => void query.refetch()}>
              Повторить
            </Button>{' '}
          </>
        ) : refresh?.active ? (
          `Публикации, роли, связи и суды посчитаны ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' — расчёт устарел' : ''}; объекты и события — на сегодня. `
        ) : query.isSuccess ? (
          'Показатели ещё не посчитаны: объекты и события — на сегодня, публикаций пока не видно. '
        ) : null}
        Это сведения из открытых публикаций, а не проверка контрагента и не оценка надёжности.
      </p>
    </Section>
  );
};
