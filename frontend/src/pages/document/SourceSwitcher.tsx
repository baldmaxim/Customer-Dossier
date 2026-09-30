// Одна новость в нескольких каналах: канал и дата каждой перепечатки. С 900px — список карточек
// слева от поста, уже — выпадающий список (раньше «облако» переключателя в 130–210px высотой).
// Выбранный канал — в адресе (?source=): ссылкой на нужную перепечатку можно поделиться.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ISourceItem } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCountWord } from '../../lib/format';
import { formatPostDate, formatTime, sourceLabel } from '../../lib/labels';
import { MQ } from '../../lib/media';
import styles from '../DocumentPage.module.css';

interface ISourceSwitcherProps {
  items: ISourceItem[];
  current: ISourceItem;
  onSelect: (id: number) => void;
}

/** Дата перепечатки; без даты публикации — когда портал её увидел, и это сказано. */
const when = (item: ISourceItem): string => {
  const at = item.publishedAt ?? item.firstObservedAt;
  const text = [formatPostDate(at), formatTime(at)].filter(Boolean).join(', ');
  return item.publishedAt || !text ? text : `замечена ${text}`;
};

export const SourceSwitcher: FC<ISourceSwitcherProps> = ({ items, current, onSelect }) => {
  const wide = useMediaQuery(MQ.md);
  const title = `Эта же новость в ${formatCountWord(items.length, ['канале', 'каналах', 'каналах'])}`;

  if (!wide) {
    return (
      <Field label={title} className={styles.sourceField}>
        {control => (
          <Select {...control} value={String(current.id)} onChange={e => onSelect(Number(e.target.value))}>
            {items.map(item => (
              <option key={item.id} value={item.id}>
                {`${sourceLabel(item)} — ${when(item)}`}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  return (
    <nav aria-label={title} className={styles.sources}>
      <p className={styles.sourcesTitle}>{title}</p>
      <ul className={styles.sourceList}>
        {items.map(item => {
          const selected = item.id === current.id;
          return (
            <Card as="li" key={item.id} padding="sm" interactive selected={selected} className={`row-link ${styles.sourceCard}`}>
              {/* Смена канала — не переход: запись истории не добавляется, прокрутка не сбрасывается. */}
              <Link
                to={`?source=${item.id}`}
                replace
                preventScrollReset
                aria-current={selected ? 'true' : undefined}
                className={`row-link-target ${styles.sourceName}`}
              >
                {sourceLabel(item)}
              </Link>
              <span className={styles.sourceDate}>{when(item) || 'дата неизвестна'}</span>
            </Card>
          );
        })}
      </ul>
    </nav>
  );
};
