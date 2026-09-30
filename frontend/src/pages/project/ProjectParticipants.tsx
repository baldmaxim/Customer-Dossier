// «Участники» объекта: период (в адресе), затем список — карточками уже 900px и таблицей шире.
// «Откуда известно» — у каждой строки: отдельного блока «Основания участия» с теми же строками больше нет.

import { FC, ReactNode, useState } from 'react';

import type { IProjectDossier } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Section } from '../../components/ui/Section';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount, formatCountWord } from '../../lib/format';
import { MQ } from '../../lib/media';
import { ParticipantCards } from './ParticipantCards';
import { ParticipantTable } from './ParticipantTable';
import { PeriodFilter, type IPeriod } from './PeriodFilter';
import styles from '../ProjectPage.module.css';

interface IProjectParticipantsProps {
  dossier: IProjectDossier;
  period: IPeriod;
  onPeriodChange: (patch: Partial<IPeriod>) => void;
  /** Идёт перезапрос за новый период: прежний список на месте, но приглушён. */
  busy: boolean;
}

const PARTICIPANTS = ['участник', 'участника', 'участников'] as const;
/** «1 из 21 участника», «2 из 5 участников»: после «из» — родительный падеж. */
const OF_PARTICIPANTS = ['участника', 'участников', 'участников'] as const;

export const ProjectParticipants: FC<IProjectParticipantsProps> = ({ dossier, period, onPeriodChange, busy }) => {
  const wide = useMediaQuery(MQ.md);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const periodSelected = Boolean(period.from || period.to);
  const all = dossier.participants;
  const shown = period.only && periodSelected ? all.filter(p => p.inPeriod === 'overlaps') : all;
  const note = shown.length === all.length ? formatCountWord(all.length, PARTICIPANTS) : `${formatCount(shown.length)} из ${formatCountWord(all.length, OF_PARTICIPANTS)}`;

  const toggle = (key: string): void =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  let list: ReactNode;
  if (all.length === 0) {
    list = (
      <EmptyState size="sm" icon={false}>
        Участники объекта в собранных публикациях не найдены.
      </EmptyState>
    );
  } else if (shown.length === 0) {
    list = (
      <EmptyState
        size="sm"
        icon={false}
        action={
          <Button size="sm" onClick={() => onPeriodChange({ only: false })}>
            Показать всех
          </Button>
        }
      >
        За выбранный период участников не найдено.
      </EmptyState>
    );
  } else if (wide) {
    list = <ParticipantTable participants={shown} periodSelected={periodSelected} open={open} onToggle={toggle} />;
  } else {
    list = <ParticipantCards participants={shown} periodSelected={periodSelected} open={open} onToggle={toggle} />;
  }

  return (
    <Section title="Участники" note={note}>
      <div className={styles.participants}>
        <PeriodFilter period={period} onChange={onPeriodChange} />
        <div className={busy ? `${styles.list} ${styles.busy}` : styles.list} aria-busy={busy || undefined}>
          {list}
        </div>
      </div>
    </Section>
  );
};
