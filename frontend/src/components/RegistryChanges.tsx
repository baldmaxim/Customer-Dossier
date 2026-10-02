// Что изменилось в реестре между обновлениями: было — стало, с датой сведений. Прежнее значение
// видно рядом с новым: иначе перенос срока сдачи не прочитать.

import { FC } from 'react';

import type { IRegistryChangeEntry } from '../api/types';
import { formatDate } from '../lib/labels';
import { Heading } from './ui/Heading';
import { Icon } from './ui/Icon';
import { VisuallyHidden } from './ui/VisuallyHidden';
import styles from './RegistryPanel.module.css';

/** «Сведения на 26.09.2026 (получены 28.09.2026)»; без даты сведений — так и сказано. */
export const registryDateText = (asOf: string | null, fetchedAt: string): string =>
  asOf
    ? `Сведения на ${formatDate(asOf)} (получены ${formatDate(fetchedAt)})`
    : `Дата сведений в реестре не указана (получены ${formatDate(fetchedAt)})`;

interface IRegistryChangesProps {
  changes: IRegistryChangeEntry[];
  title?: string;
  /** Подпись даты изменения; по умолчанию — дата сведений реестра. */
  dateText?: (entry: IRegistryChangeEntry) => string;
}

export const RegistryChanges: FC<IRegistryChangesProps> = ({
  changes,
  title = 'Что изменилось в реестре',
  dateText = entry => registryDateText(entry.asOf, entry.fetchedAt),
}) => {
  if (changes.length === 0) return null;
  return (
    <section className={styles.changes}>
      <Heading className={styles.changesTitle}>{title}</Heading>
      <ul className={styles.changeList}>
        {changes.map(entry => (
          <li key={entry.fetchedAt} className={styles.change}>
            <span className={styles.changeDate}>{dateText(entry)}</span>
            <ul className={styles.fieldChanges}>
              {entry.changes.map(change => (
                <li key={change.label}>
                  <span className={styles.changeLabel}>{change.label}:</span> <VisuallyHidden>было </VisuallyHidden>
                  <span className={styles.from}>{change.from ?? 'не сообщалось'}</span>
                  <Icon name="forward" size="sm" className={styles.arrow} />
                  <VisuallyHidden>стало </VisuallyHidden>
                  <span className={styles.to}>{change.to ?? 'реестр перестал сообщать это поле'}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
};
