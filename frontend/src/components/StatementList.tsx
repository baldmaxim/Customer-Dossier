// Фразы сводки с атрибуцией словами (не цветом) и «Откуда известно» у каждой: цитаты, источник,
// дата; у оператора — ещё и «Решение оператора». Атрибуция — одна на группу подряд идущих фраз:
// «В ПУБЛИКАЦИИ СООБЩАЕТСЯ» у каждого пункта повторялось по пять раз подряд.

import { FC, useId, useState } from 'react';

import type { IStatement } from '../api/types';
import { ATTRIBUTION_LABELS } from '../lib/labels';
import { PublicationSourceButton } from './PublicationModal';
import { StatementEvidence } from './StatementEvidence';
import { StatementQuotes } from './StatementQuotes';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import styles from './StatementList.module.css';

export interface IStatementListProps {
  items: IStatement[];
  /** Что сказать, если фраз нет; без него пустой список не рисуется. */
  empty?: string;
  /** Цитаты сразу под фразой, без раскрытия. */
  showQuotes?: boolean;
  /** Строка «Источник: …» с просмотром сохранённой публикации по нажатию. */
  showPublicationSource?: boolean;
}

interface IGroup {
  attribution: string;
  items: Array<{ statement: IStatement; key: string }>;
}

/** Подряд идущие фразы с одной атрибуцией — одна группа с одной подписью. */
const groupByAttribution = (items: readonly IStatement[]): IGroup[] =>
  items.reduce<IGroup[]>((groups, statement, index) => {
    const key = `${statement.code}:${statement.assertionIds.join(',')}:${index}`;
    const last = groups[groups.length - 1];
    if (last && last.attribution === statement.attribution) last.items.push({ statement, key });
    else groups.push({ attribution: statement.attribution, items: [{ statement, key }] });
    return groups;
  }, []);

/** Разные источники одной фразы — по одному разу. */
const uniqueSources = (quotes: IStatement['quotes']): IStatement['quotes'] =>
  quotes.filter((q, i, all) => all.findIndex(o => o.revisionId === q.revisionId && o.sourceTitle === q.sourceTitle) === i);

export const StatementList: FC<IStatementListProps> = ({ items, empty, showQuotes = false, showPublicationSource = false }) => {
  const idBase = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) {
    return empty ? (
      <EmptyState size="sm" icon={false}>
        {empty}
      </EmptyState>
    ) : null;
  }

  const toggle = (key: string): void =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.list}>
      {groupByAttribution(items).map(group => (
        <div key={group.items[0]?.key ?? group.attribution} className={styles.group}>
          <p className={styles.attribution}>{ATTRIBUTION_LABELS[group.attribution] ?? ATTRIBUTION_LABELS.source_reported}</p>
          <ul className={styles.items}>
            {group.items.map(({ statement: s, key }) => {
              const expanded = open.has(key);
              const regionId = `${idBase}-${key}`;
              const canExpand = s.assertionIds.length > 0 || (!showQuotes && s.quotes.length > 0);
              const sources = uniqueSources(s.quotes);
              return (
                <li key={key} className={styles.item}>
                  <p className={styles.text}>{s.text}</p>
                  {showPublicationSource && (
                    <div className={styles.sources}>
                      <span>Источник:</span>
                      {sources.length === 0 ? <span>не указан</span> : sources.map(q => <PublicationSourceButton key={q.evidenceId} source={q} />)}
                    </div>
                  )}
                  {showQuotes && <StatementQuotes quotes={s.quotes} />}
                  {canExpand && (
                    <div>
                      <Button
                        variant="link"
                        size="sm"
                        iconEnd="chevron"
                        className={styles.toggle}
                        aria-expanded={expanded}
                        aria-controls={regionId}
                        onClick={() => toggle(key)}
                      >
                        Откуда известно
                      </Button>
                    </div>
                  )}
                  {expanded && <StatementEvidence statement={s} id={regionId} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};
