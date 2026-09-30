// Данные реестра на карточке (этап 20B).
//
// Три правила показа:
//  - у сведений стоит дата: реестр отдаёт состояние на момент, а не навсегда;
//  - атрибуция словами — это проектная декларация застройщика, а не проверенный факт;
//  - изменения показываются отдельно: перенос срока сдачи важнее самого срока.
// Цвета-индикаторы не используются: статус читается словами (ADR-009).
//
// brief — шесть главных полей и «Все сведения реестра» раскрытием (страница объекта);
// full — все поля сразу (как было).

import { FC } from 'react';

import type { IRegistryView } from '../api/types';
import { formatCountWord } from '../lib/format';
import { withLegalForm } from '../lib/legalForm';
import { Callout } from './ui/Callout';
import { DescriptionList, type IDescriptionItem } from './ui/DescriptionList';
import { Disclosure } from './ui/Disclosure';
import { Section } from './ui/Section';
import { LinkifiedText } from './LinkifiedText';
import { RegistryChanges, registryDateText } from './RegistryChanges';
import styles from './RegistryPanel.module.css';

export interface IRegistryPanelProps {
  registry: IRegistryView | null;
  title?: string;
  /** full (по умолчанию) — все сведения сразу; brief — шесть главных и «Все сведения реестра». */
  variant?: 'full' | 'brief';
}

const GENERAL_CONTRACTOR = new Set(['Генподрядчики', 'Генподрядчик']);
/** Порядок кратких сведений: где, кто строит, кто подрядчик, что со стройкой, когда сдача, сколько квартир. */
const BRIEF_ORDER = ['address', 'developer', 'Генподрядчики', 'Генподрядчик', 'Статус строительства', 'Сдача дома', 'Срок сдачи', 'Количество квартир'];
const BRIEF_SIZE = 6;

const rowsOf = (registry: IRegistryView): Array<IDescriptionItem & { key: string }> => {
  const rows: Array<IDescriptionItem & { key: string }> = [];
  if (registry.address) rows.push({ key: 'address', label: 'Адрес', value: registry.address });
  if (registry.developer) {
    rows.push({ key: 'developer', label: 'Застройщик', value: withLegalForm(registry.developer.name, registry.developer.legalForm) });
    if (registry.developer.inn) rows.push({ key: 'inn', label: 'ИНН застройщика', value: registry.developer.inn });
    if (registry.developer.ogrn) rows.push({ key: 'ogrn', label: 'ОГРН застройщика', value: registry.developer.ogrn });
  }
  if (registry.groupName) rows.push({ key: 'group', label: 'Группа компаний', value: registry.groupName });
  // Исполнитель работ нужен рядом с основным, даже если в реестре это поле идёт после длинного списка.
  const fields = [...registry.fields.filter(f => GENERAL_CONTRACTOR.has(f.label)), ...registry.fields.filter(f => !GENERAL_CONTRACTOR.has(f.label))];
  fields.forEach((f, i) => rows.push({ key: `field-${i}-${f.label}`, label: f.label, value: <LinkifiedText text={f.value} /> }));
  return rows;
};

const briefOf = <T extends IDescriptionItem & { key: string }>(rows: T[]): T[] => {
  const rank = (row: T): number => {
    const byKey = BRIEF_ORDER.indexOf(row.key);
    const byLabel = typeof row.label === 'string' ? BRIEF_ORDER.indexOf(row.label) : -1;
    const found = byKey === -1 ? byLabel : byKey;
    return found === -1 ? BRIEF_ORDER.length : found;
  };
  const picked = rows
    .filter(row => rank(row) < BRIEF_ORDER.length)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, BRIEF_SIZE);
  // Главных полей меньше шести — добираем следующими по порядку реестра (без реквизитов: они в полном списке).
  const rest = rows.filter(row => !picked.includes(row) && row.key !== 'inn' && row.key !== 'ogrn');
  return [...picked, ...rest.slice(0, Math.max(0, BRIEF_SIZE - picked.length))];
};

export const RegistryPanel: FC<IRegistryPanelProps> = ({ registry, title = 'Данные реестра', variant = 'full' }) => {
  if (!registry) return null;
  const rows = rowsOf(registry);
  const brief = variant === 'brief';
  const updates = ['обновления', 'обновлений', 'обновлений'] as const;

  const coverage = (
    <>
      {registry.changes.length === 0 && registry.coverage.loaded > 1 && (
        <p className={styles.note}>За последние {formatCountWord(registry.coverage.loaded, updates)} реестра значения не менялись.</p>
      )}
      {registry.coverage.truncated && (
        <p className={styles.note}>
          Показаны последние {formatCountWord(registry.coverage.loaded, updates)} реестра; более ранние есть, но здесь не показаны.
        </p>
      )}
    </>
  );

  return (
    <Section title={title} note={`${registry.source.title}, запись ${registry.externalRef}`}>
      <div className={styles.body}>
        <p className={styles.asOf}>{registryDateText(registry.asOf, registry.fetchedAt)}</p>
        <DescriptionList items={brief ? briefOf(rows) : rows} />
        <Callout tone="neutral" className={styles.attribution}>
          {registry.attribution}
        </Callout>
        {brief ? (
          <>
            <RegistryChanges changes={registry.changes.slice(0, 1)} title="Последнее изменение в реестре" />
            <Disclosure summary="Все сведения реестра" meta={formatCountWord(rows.length, ['поле', 'поля', 'полей'])}>
              <div className={styles.body}>
                <DescriptionList items={rows} />
                <RegistryChanges changes={registry.changes} />
                {coverage}
              </div>
            </Disclosure>
          </>
        ) : (
          <>
            <RegistryChanges changes={registry.changes} />
            {coverage}
          </>
        )}
      </div>
    </Section>
  );
};
