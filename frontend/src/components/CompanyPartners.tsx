// «С кем работает»: контрагенты компании с основанием связи.
//
// Основания не сводятся в одно «связана с» (ADR-008): договор, корпоративная связь
// и совместное участие на объекте — разные вещи. Совместное участие показывается
// последним и подписано явно: две фирмы на одном объекте могут не иметь отношений
// между собой, и выдавать это за договор нельзя.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IPartnerLink, IPartnerRow } from '../api/types';
import { ASSERTION_ROLE_LABELS, PARTNER_KIND_HINTS, PARTNER_KIND_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { EmptyState, Section } from './ui/Section';
import styles from './CompanyPartners.module.css';

const roleText = (role: string | null): string | null => (role ? (ASSERTION_ROLE_LABELS[role] ?? role) : null);

const linkText = (link: IPartnerLink): string => {
  const role = roleText(link.role);
  const own = roleText(link.ownRole);
  if (link.kind === 'co_participation') {
    const pair = [own ? `мы — ${own}` : null, role ? `они — ${role}` : null].filter(Boolean).join(', ');
    return pair === '' ? 'роли не названы' : pair;
  }
  return role ?? own ?? 'вид связи не назван';
};

const KIND_ORDER: Record<string, number> = { contract: 0, corporate: 1, co_participation: 2 };

export const CompanyPartners: FC<{ companyId: number }> = ({ companyId }) => {
  const partners = useQuery({
    queryKey: ['company', companyId, 'partners'],
    queryFn: () => api.get<{ items: IPartnerRow[] }>(`/api/companies/${companyId}/partners?limit=12`),
  });

  const items = partners.data?.items ?? [];

  return (
    <Section title="С кем работает" note="на каком основании — подписано у каждой строки">
      {partners.isError && <p role="alert">{describeLoadError(partners.error)}</p>}
      {partners.isLoading && <p className={styles.muted}>Загрузка…</p>}
      {partners.isSuccess && items.length === 0 && (
        <EmptyState>
          Контрагентов в выборке нет: ни договоров, ни корпоративных связей, ни другой компании на тех же
          объектах. Это не значит, что их нет в действительности.
        </EmptyState>
      )}

      <ul className={styles.list}>
        {items.map(partner => {
          const links = [...partner.links].sort(
            (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9),
          );
          return (
            <li key={partner.companyId} className={styles.item}>
              <div className={styles.head}>
                <Link className={styles.name} to={`/company/${partner.companyId}`}>
                  {partner.name}
                </Link>
                {partner.city && <span className={styles.city}>{partner.city}</span>}
              </div>
              <ul className={styles.links}>
                {links.slice(0, 4).map((link, i) => (
                  <li key={`${link.kind}-${link.assertionId ?? i}-${link.projectId ?? 0}`} className={styles.link}>
                    <Badge
                      tone={link.kind === 'co_participation' ? 'neutral' : 'accent'}
                      hint={PARTNER_KIND_HINTS[link.kind]}
                    >
                      {PARTNER_KIND_LABELS[link.kind] ?? link.kind}
                    </Badge>
                    <span className={styles.linkText}>{linkText(link)}</span>
                    {link.projectId !== null && link.projectName && (
                      <Link className={styles.project} to={`/projects/${link.projectId}`}>
                        {link.projectName}
                      </Link>
                    )}
                  </li>
                ))}
                {links.length > 4 && <li className={styles.more}>и ещё связей: {links.length - 4}</li>}
              </ul>
            </li>
          );
        })}
      </ul>

      {items.length > 0 && (
        <p className={styles.note}>
          «Вместе на объекте» — не договор между этими компаниями: так написано в источниках об объекте,
          а не об их отношениях.
        </p>
      )}
    </Section>
  );
};
