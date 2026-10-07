// «С кем связана»: контрагенты компании с видом связи и цитатой-основанием.
//
// Договор, корпоративная связь и совместное участие на объекте — разные вещи: две фирмы на
// одном объекте могут не иметь отношений между собой. Сервер отдаёт первые 12 контрагентов и число всех (тот же
// запрос читает плитка «Связи»): усечённый список называет себя «первые N из M» и ведёт к схеме связей (окном).
// На обзоре видно первых SHOWN, остальные — «Показать ещё» концовкой блока.

import { CSSProperties, FC, useState } from 'react';
import { Link } from 'react-router-dom';

import type { IPartnerLink } from '../api/types';
import { formatCount } from '../lib/format';
import { ASSERTION_ROLE_LABELS, PARTNER_KIND_HINTS, PARTNER_KIND_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { useCompanyPartners } from './company/useCompanyQueries';
import { EvidenceButton } from './EvidenceButton';
import { GraphButton } from './graph/GraphButton';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
import { Section } from './ui/Section';
import styles from './CompanyPartners.module.css';

/** Сколько контрагентов просим у сервера; сколько их всего — counts ответа (тот же запрос читает плитка «Связи»). */
export const PARTNERS_LIMIT = 12;
/** Контрагентов видно до «Показать ещё». */
const SHOWN = 6;
/** Связей одного контрагента на обзоре; остальные — числом. */
const LINKS_SHOWN = 4;

const KIND_ORDER: Record<string, number> = { contract: 0, corporate: 1 };

export const partnerLinkText = (link: IPartnerLink): string => {
  const role = link.role ? (ASSERTION_ROLE_LABELS[link.role] ?? link.role) : null;
  const own = link.ownRole ? (ASSERTION_ROLE_LABELS[link.ownRole] ?? link.ownRole) : null;
  return role ?? own ?? 'вид связи не назван';
};

const linkKey = (partnerId: number, link: IPartnerLink, i: number): string =>
  `${partnerId}-${link.kind}-${link.assertionId ?? `n${i}`}-${link.projectId ?? 0}`;

export const CompanyPartners: FC<{ companyId: number }> = ({ companyId }) => {
  const partners = useCompanyPartners(companyId, PARTNERS_LIMIT);
  const items = partners.data?.items ?? [];
  const total = partners.data?.counts?.companies ?? items.length;
  const truncated = total > items.length || (partners.data?.counts === undefined && items.length >= PARTNERS_LIMIT);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, SHOWN);
  const hidden = items.length - visible.length;
  // Виды связей, которые есть в показанных строках, — в пояснение под списком.
  const kinds = [...new Set(visible.flatMap(p => p.links.slice(0, LINKS_SHOWN).map(l => l.kind)))]
    .filter(kind => PARTNER_KIND_HINTS[kind])
    .sort((a, b) => (KIND_ORDER[a] ?? 9) - (KIND_ORDER[b] ?? 9));

  return (
    <Section
      title="С кем связана"
      note={truncated ? `первые ${formatCount(items.length)} из ${formatCount(total)}` : undefined}
      footer={
        (hidden > 0 || truncated) && (
          <>
            {hidden > 0 && (
              <Button variant="link" iconEnd="chevron" aria-expanded={false} onClick={() => setExpanded(true)}>
                Показать ещё {formatCount(hidden)}
              </Button>
            )}
            {truncated && <GraphButton companyId={companyId} label="Все связи" variant="link" iconEnd="forward" />}
          </>
        )
      }
    >
      {partners.isLoading && (
        <LoadingSkeleton label="Загружаю контрагентов…" lines={4} height="40px" />
      )}
      {partners.isError && (
        <Callout
          tone="danger"
          title="Контрагенты не загрузились"
          action={
            <Button size="sm" onClick={() => void partners.refetch()}>
              Повторить
            </Button>
          }
        >
          {describeLoadError(partners.error)}
        </Callout>
      )}
      {partners.isSuccess && items.length === 0 && (
        <EmptyState size="sm">
          Договоров и корпоративных связей не найдено. Кто работал на тех же объектах — на странице объекта.
        </EmptyState>
      )}

      {items.length > 0 && (
        <ul className={styles.list}>
          {visible.map((partner, i) => {
            const links = [...partner.links].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
            const added = i >= SHOWN;
            return (
              <li
                key={partner.companyId}
                className={added ? `${styles.item} appear` : styles.item}
                style={added ? ({ '--i': i - SHOWN } as CSSProperties) : undefined}
              >
                <div className={styles.head}>
                  <Link className={styles.name} to={`/company/${partner.companyId}`} viewTransition>
                    {partner.name}
                  </Link>
                  {partner.city && <span className={styles.city}>{partner.city}</span>}
                </div>
                <ul className={styles.links}>
                  {links.slice(0, LINKS_SHOWN).map((link, i) => {
                    const key = linkKey(partner.companyId, link, i);
                    return (
                      <li key={key} className={styles.link}>
                        <span className={styles.linkLine}>
                          {/* Ярлык без подсказки-кнопки: пояснение видам связи — одно, под списком
                              (у каждой связи своя кнопка «?» давала лишние остановки Tab и мелкие цели). */}
                          <Badge tone="accent">{PARTNER_KIND_LABELS[link.kind] ?? 'связь'}</Badge>
                          <span className={styles.linkText}>{partnerLinkText(link)}</span>
                          {/* Объект подписан словом: ссылкой того же вида, что имя контрагента, он читался как ещё одна компания. */}
                          {link.projectId !== null && link.projectName && (
                            <span className={styles.project}>
                              объект{' '}
                              <Link className={styles.projectLink} to={`/projects/${link.projectId}`} viewTransition>
                                «{link.projectName}»
                              </Link>
                            </span>
                          )}
                        </span>
                        {/* Цитата — окном и грузится только в открытом окне, а не для всех связей сразу. */}
                        {link.assertionId !== null && (
                          <div>
                            <EvidenceButton assertionIds={[link.assertionId]} lead={`${partner.name}: ${PARTNER_KIND_LABELS[link.kind] ?? 'связь'} — ${partnerLinkText(link)}`} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {links.length > LINKS_SHOWN && (
                    <li className={styles.more}>и ещё связей: {formatCount(links.length - LINKS_SHOWN)}</li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {truncated && expanded && (
        <p className={styles.note}>Показаны первые {formatCount(PARTNERS_LIMIT)} контрагентов — остальные на схеме связей.</p>
      )}
      {kinds.length > 0 && (
        <ul className={styles.legend} aria-label="Виды связей">
          {kinds.map(kind => (
            <li key={kind}>
              <span className={styles.legendTerm}>{PARTNER_KIND_LABELS[kind] ?? 'связь'}</span> — {PARTNER_KIND_HINTS[kind]}.
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
