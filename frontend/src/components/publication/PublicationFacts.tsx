// Что портал нашёл в публикации — под постом, со ссылками на объект и вторую компанию,
// где сервер дал их id. В списке публикаций те же сведения одной строкой (без ссылок:
// карточка списка — кнопка, ссылку в неё не вложить).

import { FC, useId } from 'react';
import { Link } from 'react-router-dom';

import { formatCountWord } from '../../lib/format';
import type { IFactRef, IFactView } from '../../lib/publicationFacts';
import { Heading } from '../ui/Heading';
import styles from './PublicationFacts.module.css';

const FACT_FORMS = ['сведение', 'сведения', 'сведений'] as const;

interface IPublicationFactsProps {
  title: string;
  facts: ReadonlyArray<IFactView>;
  /** Сколько сведений сервер не прислал к этой публикации. */
  more?: number;
}

const RefLink: FC<{ value: IFactRef; to: string }> = ({ value, to }) =>
  value.id === null ? (
    <span>{value.name}</span>
  ) : (
    <Link to={to} viewTransition className={styles.link}>
      {value.name}
    </Link>
  );

export const PublicationFacts: FC<IPublicationFactsProps> = ({ title, facts, more = 0 }) => {
  const headingId = useId();
  if (facts.length === 0 && more === 0) return null;
  return (
    <section className={styles.facts} aria-labelledby={headingId}>
      <Heading id={headingId} className={styles.title}>
        {title}
      </Heading>
      <ul className={styles.list}>
        {facts.map(fact => (
          <li key={fact.key} className={styles.fact}>
            {fact.negated && <span className={styles.negated}>отрицается: </span>}
            <span className={styles.label}>{fact.label}</span>
            {fact.other && (
              <>
                <span aria-hidden="true"> · </span>
                <RefLink value={fact.other} to={`/company/${fact.other.id}`} />
              </>
            )}
            {fact.project && (
              <>
                <span aria-hidden="true"> · </span>
                <RefLink value={fact.project} to={`/projects/${fact.project.id}`} />
              </>
            )}
            {fact.money && (
              <>
                <span aria-hidden="true"> · </span>
                {/* Число и единица не рвутся сами (неразрывные пробелы formatMoney); пояснение переносится. */}
                <span>{fact.money}</span>
              </>
            )}
            {fact.qualifier && <span className={styles.qualifier}> ({fact.qualifier})</span>}
          </li>
        ))}
      </ul>
      {more > 0 && <p className={styles.more}>и ещё {formatCountWord(more, FACT_FORMS)} в этой публикации</p>}
    </section>
  );
};
