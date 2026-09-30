import { FC, useState } from 'react';

import type { IStatement } from '../api/types';
import { ATTRIBUTION_LABELS, formatDate } from '../lib/labels';
import styles from '../pages/Dossier.module.css';
import { AssertionDetail } from './AssertionDetail';
import { PublicationSourceButton } from './PublicationModal';

interface IStatementListProps {
  items: IStatement[];
  empty?: string;
  /** Показывать цитаты сразу (для наблюдений), иначе — по кнопке. */
  showQuotes?: boolean;
  /** Имя источника в строке и просмотр сохранённой публикации по нажатию. */
  showPublicationSource?: boolean;
}

/**
 * Фразы досье с атрибуцией словами (не цветом), цитатами и переходом к утверждению:
 * по «основания» открывается карточка утверждения с доказательствами, span и историей решений.
 */
export const StatementList: FC<IStatementListProps> = ({ items, empty, showQuotes = false, showPublicationSource = false }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return empty ? <p className={styles.meta}>{empty}</p> : null;

  return (
    <ul className={styles.statements}>
      {items.map((s, index) => {
        const key = `${s.code}:${s.assertionIds.join(',')}:${index}`;
        const expanded = open === key;
        const sources = s.quotes.filter((q, i, all) => all.findIndex(other => other.revisionId === q.revisionId && other.sourceTitle === q.sourceTitle) === i);
        return (
          <li key={key} className={styles.statement}>
            <span className={styles.attribution}>{ATTRIBUTION_LABELS[s.attribution] ?? s.attribution}</span>
            <p className={styles.statementText}>{s.text}</p>
            {showPublicationSource && <div className={styles.statementSources}>
              <span>Источник:</span>
              {sources.length === 0 && <span>не указан</span>}
              {sources.map(q => <PublicationSourceButton key={q.evidenceId} source={q} />)}
            </div>}
            {(showQuotes || expanded) &&
              s.quotes.map(q => (
                <blockquote key={q.evidenceId} className={styles.quote}>
                  «{q.quote}»
                  <span className={styles.quoteMeta}>
                    {q.stance === 'contradicts' ? 'опровергает · ' : ''}
                    {q.sourceTitle}
                    {q.publishedAt ? ` · ${formatDate(q.publishedAt)}` : ''} · доказательство #{q.evidenceId}
                  </span>
                </blockquote>
              ))}
            {s.assertionIds.length > 0 && (
              <button type="button" className={styles.linkButton} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                {expanded ? 'скрыть основания' : `основания (утверждение #${s.assertionIds.join(', #')})`}
              </button>
            )}
            {expanded && s.assertionIds.map(id => <AssertionDetail key={id} assertionId={id} />)}
          </li>
        );
      })}
    </ul>
  );
};
