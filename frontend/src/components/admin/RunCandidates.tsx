// Что модель нашла в тексте: вид сведения, стороны, цитата и судьба каждого — попадёт в
// карточки, нужна проверка или отсеяно без цитаты. Номера символов и уверенность модели —
// в «Технических подробностях».

import { FC } from 'react';

import type { IRunDetail } from '../../api/types';
import { AMBIGUITY_STATUS_LABELS, CANDIDATE_VERDICT_LABELS, PREDICATE_LABELS, roleLabel } from '../../lib/labels';
import { CANDIDATE_VERDICT_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { EmptyState } from '../ui/EmptyState';
import { Stack } from '../ui/Stack';
import { Term } from '../ui/Term';
import styles from './Found.module.css';

interface IRunCandidatesProps {
  candidates: IRunDetail['candidates'];
  ambiguities: IRunDetail['ambiguities'];
}

export const RunCandidates: FC<IRunCandidatesProps> = ({ candidates, ambiguities }) => (
  <Stack gap={4}>
    {candidates.length === 0 ? (
      <EmptyState size="sm">Модель ничего не нашла в этом тексте — или разбор ещё не дошёл до ответа.</EmptyState>
    ) : (
      <ul className={styles.list}>
        {candidates.map(c => (
          <li key={c.id} className={styles.item}>
            <Cluster gap={2}>
              <span className={styles.kind}>
                <Term value={c.predicate} labels={PREDICATE_LABELS} />
                {c.role ? ` · ${roleLabel(c.role)}` : ''}
              </span>
              <Badge tone={toneOf(CANDIDATE_VERDICT_TONE, c.verdict)}>{CANDIDATE_VERDICT_LABELS[c.verdict] ?? c.verdict}</Badge>
            </Cluster>
            {c.parties.length > 0 && <span className={styles.muted}>{c.parties.join(' · ')}</span>}
            {c.evidence.map(e => (
              <blockquote key={`${e.spanStart}-${e.spanEnd}-${e.stance}`} className={styles.quote}>
                {e.quote}
                {e.stance === 'contradicts' && <span className={styles.muted}> — опровергает</span>}
              </blockquote>
            ))}
            {c.rejectedReason && <span className={styles.muted}>Почему не в карточках: {c.rejectedReason}</span>}
          </li>
        ))}
      </ul>
    )}
    {ambiguities.length > 0 && (
      <Callout
        tone="info"
        action={
          <ButtonLink to="/admin/review?tab=mentions" variant="link" size="sm">
            Открыть неясные упоминания
          </ButtonLink>
        }
      >
        Неясные упоминания: {ambiguities.map(a => `«${a.surface}» (${AMBIGUITY_STATUS_LABELS[a.status] ?? a.status})`).join(', ')}. Выбрать
        компанию можно в «Проверке»; решение по упоминанию не переносит найденное и не объединяет карточки.
      </Callout>
    )}
  </Stack>
);
