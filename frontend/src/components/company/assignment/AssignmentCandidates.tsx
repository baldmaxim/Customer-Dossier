// Кандидаты для имени без ИНН (ADR-016, этап 23D): похожие юрлица портала и пары «возможный дубль»
// (с вердиктом модели, если она смотрела) и юрлица по названию из Контур.Фокуса. Кандидат — подсказка,
// а не решение: назначает человек.
//
//  - «Это она» у компании портала — слияние имени в неё через предпросмотр (MergePreview, право entities.merge);
//  - «Это оно» у юрлица из Фокуса — реквизит на карточку (companies.manage); такое юрлицо уже есть в портале —
//    кнопка та же, что у компании портала: слияние с ним.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IEgrulCandidate, IPortalCandidate } from '../../../api/types';
import { useCan } from '../../../hooks/useAuth';
import { ENTITY_TYPE_LABELS, MODEL_VERDICT_HINTS, primaryIdentifierText } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { Section } from '../../ui/Section';
import styles from './Assignment.module.css';

const identifierText = (c: { inn: string | null; ogrn: string | null }): string | null => primaryIdentifierText(c);

interface IRowProps {
  title: ReactNode;
  meta: Array<string | null>;
  note?: string | null;
  action?: ReactNode;
  selected?: boolean;
  children?: ReactNode;
}

const CandidateRow: FC<IRowProps> = ({ title, meta, note, action, selected = false, children }) => (
  <li className={selected ? `${styles.candidate} ${styles.selected}` : styles.candidate}>
    <div className={styles.candidateHead}>
      <div className={styles.candidateText}>
        <span className={styles.candidateTitle}>{title}</span>
        <span className={styles.candidateMeta}>{meta.filter(Boolean).join(' · ')}</span>
        {note && <span className={styles.candidateNote}>{note}</span>}
      </div>
      {action}
    </div>
    {children}
  </li>
);

interface IPortalCandidatesProps {
  items: IPortalCandidate[];
  /** Открытое слияние: id компании-цели. */
  mergeTarget: number | null;
  onMerge: (targetId: number | null) => void;
  renderMerge: (targetId: number) => ReactNode;
}

export const PortalCandidates: FC<IPortalCandidatesProps> = ({ items, mergeTarget, onMerge, renderMerge }) => {
  const canMerge = useCan('entities.merge');
  if (items.length === 0) return null;
  return (
    <Section title="Похожие компании портала" variant="plain">
      <ul className={styles.list}>
        {items.map(c => {
          const open = mergeTarget === c.companyId;
          return (
            <CandidateRow
              key={c.companyId}
              selected={open}
              title={
                <Link to={`/company/${c.companyId}`} viewTransition>
                  {c.name}
                </Link>
              }
              meta={[identifierText(c), c.city, c.entityType === 'group' ? (ENTITY_TYPE_LABELS.group ?? null) : null, c.mergeQueueId ? 'в «Возможных дублях»' : null]}
              note={c.modelVerdict ? `${MODEL_VERDICT_HINTS[c.modelVerdict]}${c.modelReason ? ` — ${c.modelReason}` : ''}` : null}
              action={
                canMerge ? (
                  <Button size="sm" variant={open ? 'secondary' : 'primary'} aria-expanded={open} onClick={() => onMerge(open ? null : c.companyId)}>
                    {open ? 'Свернуть' : 'Это она'}
                  </Button>
                ) : undefined
              }
            >
              {open && renderMerge(c.companyId)}
            </CandidateRow>
          );
        })}
      </ul>
    </Section>
  );
};

interface IEgrulCandidatesProps {
  items: IEgrulCandidate[];
  mergeTarget: number | null;
  onMerge: (targetId: number | null) => void;
  renderMerge: (targetId: number) => ReactNode;
  onIdentify: (identifier: string) => void;
  identifying: string | null;
  footer: ReactNode;
}

export const EgrulCandidates: FC<IEgrulCandidatesProps> = ({ items, mergeTarget, onMerge, renderMerge, onIdentify, identifying, footer }) => {
  const canMerge = useCan('entities.merge');
  const canIdentify = useCan('companies.manage');
  return (
    <Section title="Юрлица по названию — Контур.Фокус" variant="plain" footer={footer}>
      {items.length === 0 ? (
        <p className={styles.muted}>Подсказок нет.</p>
      ) : (
        <ul className={styles.list}>
          {items.map(c => {
            const identifier = c.inn ?? c.ogrn ?? '';
            const existing = c.existingCompanyId;
            const open = existing !== null && mergeTarget === existing;
            let action: ReactNode;
            if (existing !== null) {
              action = canMerge ? (
                <Button size="sm" variant={open ? 'secondary' : 'primary'} aria-expanded={open} onClick={() => onMerge(open ? null : existing)}>
                  {open ? 'Свернуть' : 'Это она'}
                </Button>
              ) : undefined;
            } else if (canIdentify) {
              action = (
                <Button size="sm" variant="primary" loading={identifying === identifier} onClick={() => onIdentify(identifier)}>
                  Это оно
                </Button>
              );
            }
            return (
              <CandidateRow
                key={identifier}
                selected={open}
                title={c.name ?? identifierText(c) ?? 'Юрлицо без названия'}
                meta={[identifierText(c), c.status, c.address]}
                note={
                  existing !== null ? `уже в портале — «${c.existingCompanyName ?? `#${existing}`}»: имя назначается этой компании` : null
                }
                action={action}
              >
                {open && existing !== null && renderMerge(existing)}
              </CandidateRow>
            );
          })}
        </ul>
      )}
    </Section>
  );
};
