// «Откуда известно» — окном поверх страницы: цитаты сведения, источник и дата (у оператора — ещё решение).
// Раньше цитаты раскрывались под строкой: в длинном списке раскрытие сдвигало всё ниже, а раскрытия
// вкладывались одно в другое (06.10.2026, просьба владельца). Окно смонтировано только открытым —
// двадцать строк списка не делают двадцать запросов.

import { FC, ReactNode, useState } from 'react';

import type { IStatement } from '../api/types';
import { AssertionDetail } from './AssertionDetail';
import { StatementQuotes } from './StatementQuotes';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import styles from './EvidenceButton.module.css';

export interface IEvidenceButtonProps {
  /** Сведения, чьи цитаты показать. Пусто — приложенные цитаты quotes. */
  assertionIds: readonly number[];
  quotes?: IStatement['quotes'];
  /** Что известно — первой строкой окна: фраза сведения или строка списка. */
  lead?: ReactNode;
  /** Подпись кнопки. */
  label?: string;
}

export const EvidenceButton: FC<IEvidenceButtonProps> = ({ assertionIds, quotes = [], lead, label = 'Откуда известно' }) => {
  const [open, setOpen] = useState(false);
  if (assertionIds.length === 0 && quotes.length === 0) return null;
  return (
    <>
      <Button variant="link" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Откуда известно" size="lg">
        {lead && <p className={styles.lead}>{lead}</p>}
        <div className={styles.body}>
          {assertionIds.length > 0 ? (
            assertionIds.map(id => <AssertionDetail key={id} assertionId={id} showSummary={false} />)
          ) : (
            <StatementQuotes quotes={quotes} />
          )}
        </div>
      </Dialog>
    </>
  );
};
