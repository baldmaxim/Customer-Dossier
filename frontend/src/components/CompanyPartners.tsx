// «С кем работает»: контрагенты компании с основанием связи.
//
// Совместное участие показывается у объектов: оно не доказывает отношения фирм.

import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IPartnerLink, IPartnerRow } from '../api/types';
import { ASSERTION_ROLE_LABELS, PARTNER_KIND_HINTS, PARTNER_KIND_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { EmptyState, Section } from './ui/Section';
import { AssertionDetail } from './AssertionDetail';
import styles from './CompanyPartners.module.css';

const roleText = (role: string | null): string | null => (role ? (ASSERTION_ROLE_LABELS[role] ?? role) : null);

const linkText = (link: IPartnerLink): string => {
  const role = roleText(link.role);
  const own = roleText(link.ownRole);
  return role ?? own ?? 'вид связи не назван';
};

const KIND_ORDER: Record<string, number> = { contract: 0, corporate: 1 };

export const CompanyPartners: FC<{ companyId: number }> = ({ companyId }) => {
  const [openAssertion, setOpenAssertion] = useState<number | null>(null);
  const partners = useQuery({
    queryKey: ['company', companyId, 'partners'],
    queryFn: () => api.get<{ items: IPartnerRow[] }>(`/api/companies/${companyId}/partners?limit=12`),
  });

  const items = partners.data?.items ?? [];

  return (
    <Section title="С кем связан" note="договоры и корпоративные связи из публикаций">
      {partners.isError && <p role="alert">{describeLoadError(partners.error)}</p>}
      {partners.isLoading && <p className={styles.muted}>Загрузка…</p>}
      {partners.isSuccess && items.length === 0 && (
        <EmptyState>
          Прямых связей с организациями в выборке нет. Участников тех же объектов смотрите в списке объектов.
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
                    <Badge tone="accent" hint={PARTNER_KIND_HINTS[link.kind]}>
                      {PARTNER_KIND_LABELS[link.kind] ?? link.kind}
                    </Badge>
                    <span className={styles.linkText}>{linkText(link)}</span>
                    {/* Объект подписан словом: ссылкой того же вида, что имя контрагента, он читался как ещё одна компания. */}
                    {link.projectId !== null && link.projectName && (
                      <span className={styles.project}>
                        объект <Link to={`/projects/${link.projectId}`}>«{link.projectName}»</Link>
                      </span>
                    )}
                    {link.assertionId !== null && (
                      <button type="button" className={styles.evidence} onClick={() => setOpenAssertion(openAssertion === link.assertionId ? null : link.assertionId)}>
                        {openAssertion === link.assertionId ? 'Скрыть основание' : 'Проверить основание'}
                      </button>
                    )}
                    {link.assertionId !== null && openAssertion === link.assertionId && <AssertionDetail assertionId={link.assertionId} />}
                  </li>
                ))}
                {links.length > 4 && <li className={styles.more}>и ещё связей: {links.length - 4}</li>}
              </ul>
            </li>
          );
        })}
      </ul>

      {items.length > 0 && <p className={styles.note}>Связи приведены по сообщениям источников. Основание каждой связи можно открыть и проверить.</p>}
    </Section>
  );
};
