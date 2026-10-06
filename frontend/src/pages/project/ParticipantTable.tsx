// Участники на широком экране: строка — ссылка на компанию, роль и даты не рвутся посреди слова,
// «Откуда известно» открывает цитаты окном.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import { EvidenceButton } from '../../components/EvidenceButton';
import { TableScroll } from '../../components/ui/TableScroll';
import { VisuallyHidden } from '../../components/ui/VisuallyHidden';
import { companyText, inPeriodText, participantKey, periodText, roleText, type Participant } from './participantText';
import styles from '../ProjectPage.module.css';

interface IParticipantTableProps {
  participants: Participant[];
  periodSelected: boolean;
}

export const ParticipantTable: FC<IParticipantTableProps> = ({ participants, periodSelected }) => (
  <TableScroll label="Участники" minWidth={periodSelected ? 900 : 780}>
    <thead>
      <tr>
        <th scope="col">Компания</th>
        <th scope="col">Роль</th>
        <th scope="col">Корпус</th>
        <th scope="col">Работы</th>
        <th scope="col">Период</th>
        {periodSelected && <th scope="col">Выбранный период</th>}
        <th scope="col">
          <VisuallyHidden>Откуда известно</VisuallyHidden>
        </th>
      </tr>
    </thead>
    <tbody>
      {participants.map((p, index) => (
        <tr key={participantKey(p, index)} className="row-link">
          <td>
            <Link to={`/company/${p.companyId}`} viewTransition className={`row-link-target ${styles.companyLink}`}>
              {companyText(p)}
            </Link>
          </td>
          <td className="nowrap">{roleText(p)}</td>
          <td className="nowrap">{p.building ?? '—'}</td>
          <td>{p.workPackage ?? '—'}</td>
          <td className="nowrap">{periodText(p)}</td>
          {periodSelected && <td>{inPeriodText(p)}</td>}
          <td className="row-link-above nowrap">
            <EvidenceButton assertionIds={p.statement.assertionIds} quotes={p.statement.quotes} lead={p.statement.text} />
          </td>
        </tr>
      ))}
    </tbody>
  </TableScroll>
);
