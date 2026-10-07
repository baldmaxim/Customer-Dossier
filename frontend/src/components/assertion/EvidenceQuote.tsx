// Одна цитата: текст с окружением, источник (ссылка на публикацию в портале), дата и оригинал.
// Исключённая цитата остаётся видна словом «исключена» и приглушённым текстом, а не прозрачностью:
// при opacity .6 контраст падал до 2.3:1.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IEvidenceRow } from '../../api/types';
import { COMPLETENESS_LABELS, formatDate, sourceLabel } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from '../AssertionDetail.module.css';

export interface IEvidenceToolsProps {
  /** Инструменты оператора: «Исключить цитату». */
  tools: boolean;
  /** Ссылка на разбор, из которого пришла цитата, — только тем, кому открыта админка. */
  showRun: boolean;
  onWithdraw: (row: IEvidenceRow) => void;
}

const INACTIVE_LABELS: Record<IEvidenceRow['status'], string> = {
  active: '',
  withdrawn: 'исключена',
  unavailable: 'текст недоступен',
};

/** Окружение цитаты без своих многоточий по краям: своё «…» ставим сами, двойного «……» не будет. */
const trimEdge = (text: string, side: 'start' | 'end'): string =>
  side === 'start' ? text.replace(/^[\s….]+/u, '') : text.replace(/[\s….]+$/u, '');

export const EvidenceQuote: FC<{ row: IEvidenceRow } & IEvidenceToolsProps> = ({ row, tools, showRun, onWithdraw }) => {
  const source = sourceLabel({ sourceTitle: row.sourceTitle, sourceKey: row.sourceKey, sourceKind: row.sourceKind ?? '' });
  const inactive = row.status !== 'active';
  const before = trimEdge(row.contextBefore, 'start');
  const after = trimEdge(row.contextAfter, 'end');
  return (
    <li className={inactive ? `${styles.quoteItem} ${styles.inactive}` : styles.quoteItem}>
      <blockquote className={styles.quote}>
        {before && <span className={styles.context}>…{before}</span>}
        <mark className={styles.mark}>{row.quote}</mark>
        {after && <span className={styles.context}>{after}…</span>}
      </blockquote>
      <div className={styles.source}>
        {row.legacyDocumentId !== null ? (
          <Link to={`/documents/${row.legacyDocumentId}`} viewTransition className={styles.metaLink}>
            {source}
          </Link>
        ) : (
          <span>{source}</span>
        )}
        {row.publishedAt && <time dateTime={row.publishedAt}>{formatDate(row.publishedAt)}</time>}
        {row.completeness !== 'full' && <span>{COMPLETENESS_LABELS[row.completeness]}</span>}
        {row.url && (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className={styles.metaLink}>
            оригинал
            <Icon name="external" size="sm" />
            <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
          </a>
        )}
        {showRun && row.runId != null && (
          <Link to={`/admin/process/${row.runId}`} className={styles.metaLink}>
            разбор
          </Link>
        )}
        {inactive && <Badge tone="neutral">{INACTIVE_LABELS[row.status]}</Badge>}
        {inactive && row.statusReason && <span>{row.statusReason}</span>}
        {tools && !inactive && (
          <Button variant="link" size="sm" onClick={() => onWithdraw(row)}>
            Исключить цитату
          </Button>
        )}
      </div>
    </li>
  );
};
