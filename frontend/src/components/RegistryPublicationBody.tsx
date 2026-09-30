// Текст публикации. Снимок записи реестра раскладываем по полям (главные — первыми), обычный пост
// остаётся исходным текстом — со ссылками, по которым можно перейти.

import { FC } from 'react';

import { Disclosure } from './ui/Disclosure';
import { DescriptionList } from './ui/DescriptionList';
import { Heading } from './ui/Heading';
import { LinkifiedText } from './LinkifiedText';
import styles from './RegistryPublicationBody.module.css';

const REGISTRY_REPRESENTATIONS = new Set(['registry_object_browser@1', 'registry_object@1']);

const FIRST_FIELDS = ['Адрес', 'Статус строительства', 'Сдача дома', 'Количество квартир', 'Генподрядчики', 'Генподрядчик', 'Застройщик', 'Группа компаний'];

interface IRegistryPublicationBodyProps {
  body: string;
  representation: string;
}

const priority = (label: string): number => {
  const index = FIRST_FIELDS.indexOf(label);
  return index === -1 ? FIRST_FIELDS.length : index;
};

export const RegistryPublicationBody: FC<IRegistryPublicationBodyProps> = ({ body, representation }) => {
  const raw = (
    <p className={styles.raw}>
      <LinkifiedText text={body} />
    </p>
  );
  if (!REGISTRY_REPRESENTATIONS.has(representation)) return raw;

  const fields = body.split('\n').flatMap((line, index) => {
    const match = /^([^:\n]{2,80}):\s*(.+)$/.exec(line.trim());
    return match?.[1] && match[2] && match[1] !== 'Объект' ? [{ label: match[1], value: match[2], index }] : [];
  });
  if (fields.length === 0) return raw;
  const ordered = [...fields].sort((a, b) => priority(a.label) - priority(b.label) || a.index - b.index);

  return (
    <div className={styles.wrap}>
      <Heading className={styles.heading}>Характеристики объекта</Heading>
      <DescriptionList dense items={ordered.map(f => ({ key: `${f.label}-${f.index}`, label: f.label, value: <LinkifiedText text={f.value} /> }))} />
      <Disclosure summary="Исходный текст записи реестра">
        <pre className={styles.source}>{body}</pre>
      </Disclosure>
    </div>
  );
};
