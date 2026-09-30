import { FC } from 'react';

import type { IStatement } from '../api/types';
import { formatDate, sourceLabel } from '../lib/labels';
import { Icon } from './ui/Icon';
import { VisuallyHidden } from './ui/VisuallyHidden';
import styles from './StatementList.module.css';

/** Цитаты, приложенные к фразе сводки: текст, источник, дата и оригинал. Без «доказательство #N». */
export const StatementQuotes: FC<{ quotes: IStatement['quotes'] }> = ({ quotes }) =>
  quotes.length === 0 ? null : (
    <ul className={styles.quotes}>
      {quotes.map(q => (
        <li key={q.evidenceId} className={styles.quoteItem}>
          <blockquote className={styles.quote}>«{q.quote}»</blockquote>
          <div className={styles.quoteMeta}>
            {q.stance === 'contradicts' && <strong>опровергает</strong>}
            <span>{sourceLabel({ sourceTitle: q.sourceTitle, sourceKey: q.sourceKey, sourceKind: q.sourceKind ?? '' })}</span>
            {q.publishedAt && <time dateTime={q.publishedAt}>{formatDate(q.publishedAt)}</time>}
            {q.url && (
              <a href={q.url} target="_blank" rel="noopener noreferrer" className={styles.metaLink}>
                оригинал
                <Icon name="external" size="sm" />
                <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
