// Одна вкладка списка Tabs: role="tab", выбранность, счётчик и пояснение по наведению.

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { mergeRefs } from './mergeRefs';
import { useHint } from './useHint';
import styles from './Tabs.module.css';

export interface ITabButtonProps {
  id?: string;
  controls?: string;
  label: string;
  count?: number | null;
  hint?: string;
  selected: boolean;
  disabled?: boolean;
  focusable: boolean;
  onSelect: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}

export const TabButton: FC<ITabButtonProps> = ({
  id,
  controls,
  label,
  count,
  hint,
  selected,
  disabled = false,
  focusable,
  onSelect,
  buttonRef,
}) => {
  const { triggerProps, bubble } = useHint(hint);
  const { ref: hintRef, ...hintProps } = triggerProps;
  return (
    <>
      <button
        {...hintProps}
        ref={mergeRefs(buttonRef, hintRef)}
        type="button"
        role="tab"
        id={id}
        aria-selected={selected}
        aria-controls={controls}
        tabIndex={focusable ? 0 : -1}
        disabled={disabled}
        className={styles.tab}
        onClick={onSelect}
      >
        <span className={styles.label}>{label}</span>
        {count !== undefined && count !== null && <span className={styles.count}>{formatCount(count)}</span>}
      </button>
      {bubble}
    </>
  );
};
