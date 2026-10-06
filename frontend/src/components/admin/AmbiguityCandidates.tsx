// Варианты для неясного упоминания: чья это карточка, вид, форма, город, реквизиты словами.
// Вариант, который противоречит реквизиту или форме из текста, выбрать нельзя — причина
// видна отдельной строкой, а не склеена с реквизитом («RU:inn 7802000000Нельзя: …»).

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IAmbiguityCandidate, IAmbiguityDetail } from '../../api/types';
import { ENTITY_TYPE_LABELS, PROJECT_LEVEL_LABELS, formatIdentifier } from '../../lib/labels';
import { Button } from '../ui/Button';
import type { IAmbiguityChoice } from '../AmbiguityDetail';
import styles from './Ambiguity.module.css';

interface IAmbiguityCandidatesProps {
  entityKind: IAmbiguityDetail['entityKind'];
  candidates: IAmbiguityCandidate[];
  /** Упоминание ещё ждёт решения — можно выбирать. */
  open: boolean;
  /** Решение, которое сейчас записывается: кнопки ждут ответа сервера. */
  pending: IAmbiguityChoice | null;
  /** «Да» записывает решение сразу, без отдельной кнопки. */
  onChoose: (entityId: number) => void;
}

const kindOf = (entityKind: IAmbiguityDetail['entityKind'], c: IAmbiguityCandidate): string =>
  entityKind === 'company'
    ? (ENTITY_TYPE_LABELS[c.entityType ?? 'unknown'] ?? ENTITY_TYPE_LABELS.unknown ?? '')
    : (PROJECT_LEVEL_LABELS[c.entityType ?? ''] ?? 'объект');

export const AmbiguityCandidates: FC<IAmbiguityCandidatesProps> = ({ entityKind, candidates, open, pending, onChoose }) => (
  <ul className={styles.candidates}>
    {candidates.map(c => {
      const blocked = c.choice.conflicts.length > 0;
      const active = pending?.decision === 'resolved_to' && pending.entityId === c.id;
      const facts = [kindOf(entityKind, c), c.legalForm, c.city ?? 'город неизвестен'].filter(Boolean).join(' · ');
      return (
        <li key={c.id} className={active ? `${styles.candidate} ${styles.chosen}` : styles.candidate}>
          <Link to={entityKind === 'company' ? `/company/${c.id}` : `/projects/${c.id}`} viewTransition className={styles.candidateName}>
            {c.name}
          </Link>
          <span className={styles.muted}>{facts}</span>
          <span className={styles.muted}>
            {c.identifiers.length > 0 ? c.identifiers.map(formatIdentifier).join(', ') : 'реквизитов нет'}
            {c.mergedIntoId !== null ? ' · объединена с другой карточкой' : ''}
          </span>
          {c.choice.conflicts.map(x => (
            <span key={x.code + x.message} className={styles.conflict}>
              Нельзя: {x.message}
            </span>
          ))}
          {open && (
            <div>
              <Button
                size="sm"
                aria-label={`Да, это «${c.name}»`}
                loading={active}
                disabled={blocked || pending !== null}
                onClick={() => onChoose(c.id)}
              >
                Да
              </Button>
            </div>
          )}
        </li>
      );
    })}
  </ul>
);
