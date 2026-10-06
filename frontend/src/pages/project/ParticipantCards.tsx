// Участники на телефоне и планшете: карточка — ссылка на компанию целиком; роль, корпус, работы
// и период — строками; «Откуда известно» открывает цитаты окном. Раньше здесь была
// таблица, сжатая до «за/ка/зч/ик» — по две буквы в строке.

import { FC } from 'react';

import { EvidenceButton } from '../../components/EvidenceButton';
import { CardList } from '../../components/ui/CardList';
import { CardListItem } from '../../components/ui/CardListItem';
import { companyText, inPeriodText, participantKey, periodText, roleText, type Participant } from './participantText';
import styles from '../ProjectPage.module.css';

interface IParticipantCardsProps {
  participants: Participant[];
  periodSelected: boolean;
}

export const ParticipantCards: FC<IParticipantCardsProps> = ({ participants, periodSelected }) => (
  <CardList label="Участники">
    {participants.map((p, index) => (
      <CardListItem
        key={participantKey(p, index)}
        to={`/company/${p.companyId}`}
        title={companyText(p)}
        meta={[roleText(p), p.building].filter(Boolean).join(' · ')}
        actions={<EvidenceButton assertionIds={p.statement.assertionIds} quotes={p.statement.quotes} lead={p.statement.text} />}
      >
        {p.workPackage && <span className={styles.cardLine}>Работы: {p.workPackage}</span>}
        <span className={styles.cardLine}>
          <span className="nowrap">{periodText(p)}</span>
          {periodSelected && inPeriodText(p) && ` · ${inPeriodText(p)}`}
        </span>
      </CardListItem>
    ))}
  </CardList>
);
