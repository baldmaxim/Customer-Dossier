// «Сайт компании» на «Сведениях» (этап 25A, ADR-018): подтверждённый сайт ссылкой, сайт группы для СЗ,
// кандидаты из веб-поиска с признаками проверки и решения оператора. Подтверждает человек: модель находит
// адрес среди страниц выдачи, портал смотрит, написан ли там ИНН компании, — но «это сайт компании» говорит
// оператор. Читателю — только подтверждённое и строка о поиске. На карточке — коротко (06.10.2026): адрес,
// одна строка о чтении, действия ярлычками; как найден и кто решил — в очереди «Сайты компаний».

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanySites } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { SiteCandidates, SiteControls, searchLine } from '../companySite/SiteCandidates';
import { companySiteKey, useSiteActions } from '../companySite/useSiteActions';
import { useSiteProjects } from '../companySite/useSiteProjects';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { Disclosure } from '../ui/Disclosure';
import { Loading } from '../ui/Loading';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import styles from '../companySite/Site.module.css';
import { siteReadText } from './CompanySiteProjects';

/** Чтение подтверждённого сайта (25B): прочитан ли и что нашлось — подробности на вкладке «Объекты». */
const SiteReadSummary: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useSiteProjects(companyId);
  const data = query.data;
  if (!data || data.sites.length === 0) return null;
  const missing = data.projects.filter(p => !p.match).length;
  // Один сайт — адрес уже стоит строкой выше, не повторяем.
  const single = data.sites.length === 1;
  return (
    <p className={styles.muted}>
      {data.sites.map(site => (single ? siteReadText(site) : `${site.host}: ${siteReadText(site)}`)).join('; ')}
      {data.projects.length > 0 && (
        <>
          {'. '}
          <ButtonLink to="?tab=objects" variant="link" size="sm">
            Проектов на сайте: {formatCount(data.projects.length)}, нет на портале: {formatCount(missing)}
          </ButtonLink>
        </>
      )}
    </p>
  );
};

export const CompanySite: FC<{ companyId: number; companyName: string }> = ({ companyId, companyName }) => {
  const query = useQuery({
    queryKey: companySiteKey(companyId),
    queryFn: () => api.get<ICompanySites>(`/api/companies/${companyId}/site`),
  });
  const canDecide = useCan('sources.manage');
  const actions = useSiteActions();
  const data = query.data;
  const candidates = data?.candidates ?? [];
  const confirmed = candidates.filter(c => c.state === 'confirmed');
  const pending = candidates.filter(c => c.state === 'pending');
  const rejected = candidates.filter(c => c.state === 'rejected');
  const family = (data?.familySites ?? []).filter(f => !confirmed.some(c => c.host === f.host));
  const decide = { canDecide, busy: actions.busy, onConfirm: actions.confirm, onReject: (c: (typeof candidates)[number]) => void actions.reject(c) };

  return (
    <Section id="company-site" title="Сайт компании">
      {query.isLoading && <Loading label="Загружаю сайт компании…" />}
      {query.isError && (
        <Callout tone="danger" title="Сайт не загрузился" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      )}
      {data && (
        <Stack gap={2}>
          {confirmed.length > 0 && <SiteCandidates candidates={confirmed} compact {...decide} />}
          {confirmed.length > 0 && <SiteReadSummary companyId={companyId} />}
          {family.length > 0 && (
            <ul className={styles.list}>
              {family.map(f => (
                <li key={`${f.companyId}-${f.host}`} className={styles.item}>
                  <a href={f.url} target="_blank" rel="noreferrer noopener" className={styles.host}>
                    {f.host}
                  </a>
                  <p className={styles.muted}>сайт группы «{f.companyName}»</p>
                </li>
              ))}
            </ul>
          )}
          {confirmed.length === 0 && family.length === 0 && <p className={styles.muted}>Сайт не привязан.</p>}
          {pending.length > 0 &&
            (canDecide ? (
              <Stack gap={2}>
                <p className={styles.muted}>Найдено поиском — сайт ли это компании?</p>
                <SiteCandidates candidates={pending} compact {...decide} />
              </Stack>
            ) : (
              <p className={styles.muted}>Найдены кандидаты: {formatCount(pending.length)} — ждут решения оператора.</p>
            ))}
          {confirmed.length === 0 && <p className={styles.muted}>{searchLine(data.search, data.mode)}</p>}
          {canDecide && rejected.length > 0 && (
            <Disclosure summary="Отклонённые" meta={formatCount(rejected.length)}>
              <SiteCandidates candidates={rejected} compact {...decide} />
            </Disclosure>
          )}
          {canDecide && (
            <SiteControls
              companyName={companyName}
              searched={Boolean(data.search?.searchedAt)}
              busy={actions.busy}
              onManual={url => actions.manual(companyId, url)}
              onSearch={() => actions.search(companyId)}
            />
          )}
        </Stack>
      )}
    </Section>
  );
};
