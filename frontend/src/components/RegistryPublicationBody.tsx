import { FC } from 'react';

import styles from './RegistryPublicationBody.module.css';

const FIRST_FIELDS = [
  'Адрес', 'Статус строительства', 'Сдача дома', 'Количество квартир',
  'Генподрядчики', 'Генподрядчик', 'Застройщик', 'Группа компаний',
];

interface Props {
  body: string;
  representation: string;
}

/** Структурируем только сохранённые снимки реестра; обычный пост остаётся исходным текстом. */
export const RegistryPublicationBody: FC<Props> = ({ body, representation }) => {
  if (representation !== 'registry_object_browser@1' && representation !== 'registry_object@1') return <p className={styles.raw}>{body}</p>;

  const fields = body.split('\n').flatMap(line => {
    const match = /^([^:\n]{2,80}):\s*(.+)$/.exec(line.trim());
    return match?.[1] && match[2] && match[1] !== 'Объект' ? [{ label: match[1], value: match[2] }] : [];
  });
  if (fields.length === 0) return <p className={styles.raw}>{body}</p>;
  const priority = (label: string): number => {
    const index = FIRST_FIELDS.indexOf(label);
    return index === -1 ? FIRST_FIELDS.length : index;
  };
  const ordered = fields.map((field, index) => ({ ...field, index })).sort((a, b) => priority(a.label) - priority(b.label) || a.index - b.index);

  return <div className={styles.wrap}>
    <h3>Характеристики объекта</h3>
    <dl className={styles.fields}>{ordered.map(field => <div className={styles.field} key={`${field.label}-${field.index}`}>
      <dt>{field.label}</dt><dd>{field.value}</dd>
    </div>)}</dl>
    <details className={styles.source}><summary>Исходный текст снимка</summary><pre>{body}</pre></details>
  </div>;
};
