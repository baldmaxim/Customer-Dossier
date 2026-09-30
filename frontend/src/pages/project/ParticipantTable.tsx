// Участники на широком экране: строка — ссылка на компанию, роль и даты не рвутся посреди слова,
// «Откуда известно» раскрывает цитаты под строкой.

import { FC, Fragment, useId } from 'react';
import { Link } from 'react-router-dom';

import { StatementEvidence } from '../../components/StatementEvidence';
import { Button } from '../../components/ui/Button';
import { TableScroll } from '../../components/ui/TableScroll';
import { VisuallyHidden } from '../../components/ui/VisuallyHidden';
import { companyText, inPeriodText, participantKey, periodText, roleText, type Participant } from './participantText';
import styles from '../ProjectPage.module.css';

interface IParticipantTableProps {
  participants: Participant[];
  periodSelected: boolean;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export const ParticipantTable: FC<IParticipantTableProps> = ({ participants, periodSelected, open, onToggle }) => {
  const idBase = useId();
  const columns = periodSelected ? 7 : 6;
  return (
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
        {participants.map((p, index) => {
          const key = participantKey(p, index);
          const expanded = open.has(key);
          const evidenceId = `${idBase}-${index}`;
          return (
            <Fragment key={key}>
              <tr className="row-link">
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
                  <Button variant="link" size="sm" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => onToggle(key)}>
                    Откуда известно
                  </Button>
                </td>
              </tr>
              {expanded && (
                <tr className={styles.evidenceRow}>
                  <td colSpan={columns}>
                    <StatementEvidence statement={p.statement} id={evidenceId} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
