// Варианты для неясного упоминания: чья это карточка, вид, форма, город, реквизиты словами.
// Вариант, который противоречит реквизиту или форме из текста, выбрать нельзя — причина
// видна отдельной строкой, а не склеена с реквизитом («RU:inn 7802000000Нельзя: …»).

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IAmbiguityCandidate, IAmbiguityDetail } from '../../api/types';
import { ENTITY_TYPE_LABELS, PROJECT_LEVEL_LABELS, formatIdentifier } from '../../lib/labels';
import { Button } from '../ui/Button';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { IAmbiguityChoice } from '../AmbiguityDetail';
import styles from './Ambiguity.module.css';

interface IAmbiguityCandidatesProps {
  entityKind: IAmbiguityDetail['entityKind'];
  candidates: IAmbiguityCandidate[];
  /** Упоминание ещё ждёт решения — можно выбирать. */
  open: boolean;
  choice: IAmbiguityChoice | null;
  onChoose: (entityId: number) => void;
}

const kindOf = (entityKind: IAmbiguityDetail['entityKind'], c: IAmbiguityCandidate): string =>
  entityKind === 'company'
    ? (ENTITY_TYPE_LABELS[c.entityType ?? 'unknown'] ?? ENTITY_TYPE_LABELS.unknown ?? '')
    : (PROJECT_LEVEL_LABELS[c.entityType ?? ''] ?? 'объект');

export const AmbiguityCandidates: FC<IAmbiguityCandidatesProps> = ({ entityKind, candidates, open, choice, onChoose }) => (
  <ul className={styles.candidates}>
    {candidates.map(c => {
      const blocked = c.choice.conflicts.length > 0;
      const active = choice?.decision === 'resolved_to' && choice.entityId === c.id;
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
                variant={active ? 'primary' : 'secondary'}
                disabled={blocked}
                aria-pressed={active}
                onClick={() => onChoose(c.id)}
              >
                {entityKind === 'company' ? 'Это она' : 'Это он'}
                <VisuallyHidden> «{c.name}»</VisuallyHidden>
              </Button>
            </div>
          )}
        </li>
      );
    })}
  </ul>
);
