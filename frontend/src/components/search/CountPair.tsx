// «7 объ. · 24 817 публ.» в карточке списка на телефоне. Сокращения — только для глаз:
// диктор слышит «7 объектов, 24 817 публикаций», а не «объ точка».

import { FC, ReactNode } from 'react';

import { formatCount, formatCountWord, type PluralForms } from '../../lib/format';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Search.module.css';

const PROJECT_FORMS: PluralForms = ['объект', 'объекта', 'объектов'];
const PUBLICATION_FORMS: PluralForms = ['публикация', 'публикации', 'публикаций'];

/** Неизвестное число в карточке не показываем вовсе: «— объ.» читалось как опечатка. */
const countNode = (value: number | null, short: string, forms: PluralForms): ReactNode =>
  value === null ? null : (
    <span className={styles.count}>
      <span aria-hidden="true">
        {formatCount(value)} {short}
      </span>
      <VisuallyHidden>{formatCountWord(value, forms)}</VisuallyHidden>
    </span>
  );

interface ICountPairProps {
  projects: number | null;
  /** Не передано — только объекты (результаты поиска). */
  publications?: number | null;
}

export const CountPair: FC<ICountPairProps> = ({ projects, publications }) => (
  <span className={styles.counts}>
    {countNode(projects, 'объ.', PROJECT_FORMS)}
    {publications !== undefined && countNode(publications, 'публ.', PUBLICATION_FORMS)}
  </span>
);
