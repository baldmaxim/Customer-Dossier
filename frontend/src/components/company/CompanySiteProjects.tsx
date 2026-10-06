// «С сайта компании» на вкладке «Объекты» (этап 25B, ADR-018): проекты, которые компания называет своими на
// подтверждённом сайте, — с цитатой и страницей. Отмечено, чего на портале нет и что появилось недавно: так новый
// объект Заказчика виден раньше, чем о нём напишут каналы или появится запись ДОМ.РФ. Это слова самой компании на
// дату — не проверенный факт и не канон: карточки объектов из них не строятся.

import { FC } from 'react';

import type { ICompanySiteProjectRow, ICompanySiteRead } from '../../api/types';
import { formatCount } from '../../lib/format';
import { SITE_PROJECT_STATUS_LABELS, SOURCE_HEALTH_LABELS, formatDate, formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { useSiteProjects } from '../companySite/useSiteProjects';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import styles from '../companySite/Site.module.css';

/** Прочитан ли сайт и когда; не прочитан — почему, словами. */
export const siteReadText = (site: ICompanySiteRead): string => {
  if (site.lastReadAt) return `прочитан ${formatDateTime(site.lastReadAt)}`;
  if (site.health && site.health !== 'ok' && site.health !== 'unknown') {
    return `не прочитан: ${SOURCE_HEALTH_LABELS[site.health] ?? site.health}${site.healthReason ? ` — ${site.healthReason}` : ''}`;
  }
  return site.status === 'active' ? 'ещё не прочитан — портал прочитает его в ближайшие минуты' : 'чтение на паузе';
};

const ProjectRow: FC<{ row: ICompanySiteProjectRow }> = ({ row }) => (
  <li className={styles.item}>
    <Cluster gap={2} align="center">
      {row.match ? (
        <ButtonLink to={`/projects/${row.match.projectId}`} variant="link" size="sm">
          {row.name}
        </ButtonLink>
      ) : (
        <span className={styles.host}>{row.name}</span>
      )}
      {row.isNew && (
        <Badge tone="accent" hint={`Впервые на сайте ${formatDate(row.firstSeenAt)}`}>
          новое
        </Badge>
      )}
      {!row.match && <Badge tone="info">нет на портале</Badge>}
      {row.status !== 'unknown' && <Badge>{SITE_PROJECT_STATUS_LABELS[row.status]}</Badge>}
      {row.completion && <Badge>сдача: {row.completion}</Badge>}
    </Cluster>
    <p className={styles.muted}>
      {[row.city, row.address].filter(Boolean).join(', ')}
      {row.city || row.address ? ' · ' : ''}
      со страницы{' '}
      <a href={row.pageUrl} target="_blank" rel="noreferrer noopener">
        {row.pageTitle ?? row.host}
      </a>{' '}
      на {formatDate(row.seenAt)}
    </p>
    <p className={styles.quote}>«{row.quote}»</p>
  </li>
);

export const CompanySiteProjects: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useSiteProjects(companyId);
  if (query.isError) {
    return (
      <Callout tone="danger" title="Проекты с сайта компании не загрузились" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  }
  const data = query.data;
  // Без подтверждённого сайта блока нет: сайт привязывают на «Сведениях».
  if (!data || data.sites.length === 0) return null;
  const missing = data.projects.filter(p => !p.match).length;
  const read = data.sites.some(s => s.lastReadAt);

  return (
    <Section
      variant="plain"
      title="С сайта компании"
      note={data.projects.length > 0 ? `проектов ${formatCount(data.projects.length)}, нет на портале ${formatCount(missing)}` : undefined}
    >
      <Stack gap={3}>
        <p className={styles.muted}>
          По данным сайта компании на дату снимка, не проверенный факт.{' '}
          {data.sites.map((site, i) => (
            <span key={site.host}>
              {i > 0 && '; '}
              <a href={site.url} target="_blank" rel="noreferrer noopener">
                {site.host}
              </a>{' '}
              {siteReadText(site)}
            </span>
          ))}
          {data.waiting > 0 ? `. Страниц ждут разбора: ${formatCount(data.waiting)}` : ''}
        </p>
        {data.projects.length === 0 ? (
          <EmptyState size="sm">{read ? 'На прочитанных страницах проектов не нашлось.' : 'Сайт ещё не прочитан.'}</EmptyState>
        ) : (
          <ul className={styles.list}>
            {data.projects.map(row => (
              <ProjectRow key={`${row.host}:${row.name}`} row={row} />
            ))}
          </ul>
        )}
      </Stack>
    </Section>
  );
};
