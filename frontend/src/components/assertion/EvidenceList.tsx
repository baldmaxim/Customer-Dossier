// Цитаты сведения по отношению к нему: подтверждают и опровергают — рядом, если есть место,
// упоминания — ниже. «Опровержений не найдено» сказано словами: это тоже сведение.

import { FC, ReactNode } from 'react';

import type { IEvidenceRow } from '../../api/types';
import { Heading } from '../ui/Heading';
import { EvidenceQuote, type IEvidenceToolsProps } from './EvidenceQuote';
import styles from '../AssertionDetail.module.css';

interface IEvidenceListProps extends IEvidenceToolsProps {
  evidence: IEvidenceRow[];
}

export const EvidenceList: FC<IEvidenceListProps> = ({ evidence, ...tools }) => {
  const group = (title: string, rows: IEvidenceRow[], empty?: string): ReactNode => (
    <section className={styles.group}>
      <Heading className={styles.groupTitle}>
        {title} <span className="num">({rows.length})</span>
      </Heading>
      {rows.length === 0 ? (
        empty && <p className={styles.muted}>{empty}</p>
      ) : (
        <ul className={styles.quotes}>
          {rows.map(row => (
            <EvidenceQuote key={row.id} row={row} {...tools} />
          ))}
        </ul>
      )}
    </section>
  );
  const mentions = evidence.filter(e => e.stance === 'mentions');
  return (
    <>
      <div className={styles.columns}>
        {group('Подтверждают', evidence.filter(e => e.stance === 'supports'), 'Подтверждающих цитат нет.')}
        {group('Опровергают', evidence.filter(e => e.stance === 'contradicts'), 'Опровержений в собранных публикациях не найдено.')}
      </div>
      {mentions.length > 0 && group('Упоминают', mentions)}
    </>
  );
};
