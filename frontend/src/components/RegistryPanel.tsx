// Данные реестра на карточке (этап 20B).
//
// Три правила показа:
//  - у каждого числа стоит дата сведений: реестр отдаёт состояние на момент, а не навсегда;
//  - атрибуция словами — это проектная декларация застройщика, а не проверенный факт;
//  - изменения показываются отдельно: перенос срока сдачи важнее самого срока.
// Цвета-индикаторы не используются: статус читается словами (ADR-009).

import { FC } from 'react';

import type { IRegistryView } from '../api/types';
import { formatDate } from '../lib/labels';
import { Section } from './ui/Section';
import styles from './RegistryPanel.module.css';

export interface IRegistryPanelProps {
  registry: IRegistryView | null;
  title?: string;
}

const dateText = (iso: string | null): string => (iso ? formatDate(iso) : 'дата сведений в реестре не указана');

export const RegistryPanel: FC<IRegistryPanelProps> = ({ registry, title = 'Данные реестра' }) => {
  if (!registry) return null;

  const rows: Array<{ label: string; value: string }> = [];
  if (registry.address) rows.push({ label: 'Адрес', value: registry.address });
  if (registry.developer) {
    const name = registry.developer.legalForm && !registry.developer.name.startsWith(registry.developer.legalForm)
      ? `${registry.developer.legalForm} ${registry.developer.name}`
      : registry.developer.name;
    rows.push({ label: 'Застройщик', value: name });
    if (registry.developer.inn) rows.push({ label: 'ИНН застройщика', value: registry.developer.inn });
    if (registry.developer.ogrn) rows.push({ label: 'ОГРН застройщика', value: registry.developer.ogrn });
  }
  if (registry.groupName) rows.push({ label: 'Группа компаний', value: registry.groupName });
  rows.push(...registry.fields);

  return (
    <Section title={title} note={`${registry.source.title} · запись ${registry.externalRef}`}>
      <p className={styles.meta}>
        Сведения на {dateText(registry.asOf)} · получено {formatDate(registry.fetchedAt)}
      </p>
      <p className={styles.attribution}>{registry.attribution}</p>

      <div className={styles.fields}>
        {rows.map(row => (
          <div className={styles.row} key={row.label}>
            <span className={styles.label}>{row.label}</span>
            <span className={styles.value}>{row.value}</span>
          </div>
        ))}
      </div>

      {registry.changes.length > 0 && (
        <>
          <h3 className={styles.meta}>Что изменилось в реестре</h3>
          <ul className={styles.changes}>
            {registry.changes.map(entry => (
              <li className={styles.change} key={entry.fetchedAt}>
                <span className={styles.changeDate}>
                  Снимок на {dateText(entry.asOf)} (получен {formatDate(entry.fetchedAt)})
                </span>
                {entry.changes.map(change => (
                  <div key={change.label}>
                    {change.label}: <span className={styles.from}>{change.from ?? 'не сообщалось'}</span> →{' '}
                    <span className={styles.to}>{change.to ?? 'реестр перестал сообщать это поле'}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      {registry.changes.length === 0 && registry.coverage.loaded > 1 && (
        <p className={styles.meta}>За {registry.coverage.loaded} последних снимков значения не менялись.</p>
      )}
      {registry.coverage.truncated && (
        <p className={styles.meta}>Показаны последние {registry.coverage.loaded} снимков; более ранние есть, но здесь не показаны.</p>
      )}
    </Section>
  );
};
