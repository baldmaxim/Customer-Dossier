// Последние разборы: когда · источник · итог · длительность. Строка — ссылка на разбор
// целиком (раньше кликабелен был только «#id» 32×17px). На телефоне — карточки.
// Отпечаток, схема, модель и части текста — на странице разбора, под «Техническими подробностями».

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IRunListItem, ISourceRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatDuration } from '../../lib/format';
import { formatDateTime, sourceLabel } from '../../lib/labels';
import { MQ } from '../../lib/media';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { RunOutcomeBadge } from './RunOutcomeBadge';
import styles from './Runs.module.css';

/** Сколько шёл разбор: от начала до конца, а пока он не закончен — время ответов модели. */
export const runDuration = (r: Pick<IRunListItem, 'startedAt' | 'finishedAt' | 'usage'>): number | null =>
  r.startedAt && r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : r.usage.latencyMs;

/** Пометки к итогу: повторная попытка и текст, изменившийся после разбора. */
const notes = (r: IRunListItem): string[] => [
  ...(r.previousRunId !== null ? ['повтор'] : []),
  ...(r.latestRevisionNo > r.revisionNo ? ['текст с тех пор изменился'] : []),
];

interface IRunsListProps {
  runs: IRunListItem[];
  sources: ReadonlyMap<number, ISourceRow>;
}

export const RunsList: FC<IRunsListProps> = ({ runs, sources }) => {
  // Таблица — от 900px: на планшете длинные названия каналов уводили «Итог» за край.
  const wide = useMediaQuery(MQ.md);
  const nameOf = (r: IRunListItem): string => {
    const s = sources.get(r.source.id);
    return s ? sourceLabel({ sourceTitle: s.title, sourceKey: s.key, sourceKind: s.kind }) : r.source.key;
  };

  if (!wide) {
    return (
      <CardList label="Последние разборы">
        {runs.map(r => (
          <CardListItem
            key={r.id}
            to={`/admin/process/${r.id}`}
            title={
              <>
                <VisuallyHidden>Разбор: </VisuallyHidden>
                {nameOf(r)}
              </>
            }
            meta={`${formatDateTime(r.createdAt)} · ${formatDuration(runDuration(r))}`}
            aside={<RunOutcomeBadge run={r} />}
          >
            {notes(r).length > 0 && <span className={styles.note}>{notes(r).join(' · ')}</span>}
          </CardListItem>
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Последние разборы" minWidth={560}>
      <thead>
        <tr>
          <th>Когда</th>
          <th>Источник</th>
          <th>Итог</th>
          <th className="num">Длительность</th>
        </tr>
      </thead>
      <tbody>
        {runs.map(r => (
          <tr key={r.id} className="row-link">
            <td className={`nowrap ${styles.whenCell}`}>
              <Link to={`/admin/process/${r.id}`} viewTransition className={`row-link-target ${styles.rowLink}`}>
                <VisuallyHidden>Разбор от </VisuallyHidden>
                {formatDateTime(r.createdAt)}
              </Link>
            </td>
            <td className={styles.sourceCell}>{nameOf(r)}</td>
            <td>
              <RunOutcomeBadge run={r} />
              {notes(r).length > 0 && <span className={styles.note}>{notes(r).join(' · ')}</span>}
            </td>
            <td className="num">{formatDuration(runDuration(r))}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
