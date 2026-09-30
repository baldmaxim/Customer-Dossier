// Подпись в DescriptionList; с пояснением — кнопка с подсказкой по наведению и фокусу.

import { FC, ReactNode } from 'react';

import { useHint } from './useHint';
import styles from './DescriptionList.module.css';

export interface IDescriptionTermProps {
  label: ReactNode;
  hint?: string;
}

export const DescriptionTerm: FC<IDescriptionTermProps> = ({ label, hint }) => {
  const { triggerProps, bubble, pin } = useHint(hint);
  if (!hint) return <dt className={styles.term}>{label}</dt>;
  return (
    <dt className={styles.term}>
      <button {...triggerProps} type="button" className={styles.hinted} onClick={pin}>
        {label}
      </button>
      {bubble}
    </dt>
  );
};
