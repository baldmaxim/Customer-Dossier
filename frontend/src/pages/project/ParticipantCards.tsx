// Участники на телефоне и планшете: карточка — ссылка на компанию целиком; роль, корпус, работы
// и период — строками; «Откуда известно» раскрывает цитаты внутри карточки. Раньше здесь была
// таблица, сжатая до «за/ка/зч/ик» — по две буквы в строке.

import { FC, useId } from 'react';

import { StatementEvidence } from '../../components/StatementEvidence';
import { Button } from '../../components/ui/Button';
import { CardList } from '../../components/ui/CardList';
import { CardListItem } from '../../components/ui/CardListItem';
import { companyText, inPeriodText, participantKey, periodText, roleText, type Participant } from './participantText';
import styles from '../ProjectPage.module.css';

interface IParticipantCardsProps {
  participants: Participant[];
  periodSelected: boolean;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export const ParticipantCards: FC<IParticipantCardsProps> = ({ participants, periodSelected, open, onToggle }) => {
  const idBase = useId();
  return (
    <CardList label="Участники">
      {participants.map((p, index) => {
        const key = participantKey(p, index);
        const expanded = open.has(key);
        const evidenceId = `${idBase}-${index}`;
        return (
          <CardListItem
            key={key}
            to={`/company/${p.companyId}`}
            title={companyText(p)}
            meta={[roleText(p), p.building].filter(Boolean).join(' · ')}
            actions={
              <>
                <Button variant="link" size="sm" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => onToggle(key)}>
                  Откуда известно
                </Button>
                {expanded && (
                  <div className={styles.cardEvidence}>
                    <StatementEvidence statement={p.statement} id={evidenceId} />
                  </div>
                )}
              </>
            }
          >
            {p.workPackage && <span className={styles.cardLine}>Работы: {p.workPackage}</span>}
            <span className={styles.cardLine}>
              <span className="nowrap">{periodText(p)}</span>
              {periodSelected && inPeriodText(p) && ` · ${inPeriodText(p)}`}
            </span>
          </CardListItem>
        );
      })}
    </CardList>
  );
};
