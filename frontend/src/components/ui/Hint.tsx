// Значок пояснения «?» поверх useHint. Термин с подсказкой — Term.tsx (реэкспорт ниже
// оставлен для прежних импортов из './ui/Hint').

import { FC } from 'react';

import styles from './Hint.module.css';
import { useHint } from './useHint';

export { Term, type ITermProps } from './Term';

export interface IHintProps {
  /** Текст пояснения. */
  text: string;
  /** Чего касается пояснение — попадёт в доступное имя значка. */
  label: string;
}

/** Значок «?» рядом с подписью: наведение, фокус с клавиатуры и тап. */
export const Hint: FC<IHintProps> = ({ text, label }) => {
  const { triggerProps, bubble, pin } = useHint(text);
  return (
    <>
      <button {...triggerProps} type="button" className={styles.mark} aria-label={`Пояснение: ${label}`} onClick={pin}>
        <span className={styles.markDot} aria-hidden="true">
          ?
        </span>
      </button>
      {bubble}
    </>
  );
};
