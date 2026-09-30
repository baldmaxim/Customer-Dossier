// Машинное значение на экране — только через Term: подпись из словаря плюс пояснение.

import { FC } from 'react';

import styles from './Hint.module.css';
import { useHint } from './useHint';

export interface ITermProps {
  /** Машинное значение: статус, вид, исход, роль. */
  value: string;
  /** Словарь подписей из src/lib/labels. */
  labels: Record<string, string>;
  /** Словарь пояснений: необязателен, но без него подсказки не будет. */
  hints?: Record<string, string>;
  className?: string;
}

/**
 * Машинное значение → подпись из словаря плюс пояснение по наведению.
 * Единственный разрешённый способ показать статус на экране: печать `{row.status}`
 * напрямую выводит пользователю `company_mentioned` и ему подобное.
 *
 * С пояснением термин — кнопка: её можно сфокусировать и нажать пальцем, а диктор
 * слышит роль и пояснение (aria-description), а не безымянный фокусируемый span.
 */
export const Term: FC<ITermProps> = ({ value, labels, hints, className }) => {
  const text = labels[value] ?? value;
  const hint = hints?.[value];
  const { triggerProps, bubble, pin } = useHint(hint);

  if (import.meta.env.DEV && labels[value] === undefined) {
    console.warn(`[labels] нет подписи для значения «${value}» — на экран уйдёт машинный ключ`);
  }

  if (!hint) return <span className={className}>{text}</span>;

  return (
    <>
      <button
        {...triggerProps}
        type="button"
        className={className ? `${className} ${styles.term}` : styles.term}
        onClick={pin}
      >
        {text}
      </button>
      {bubble}
    </>
  );
};
