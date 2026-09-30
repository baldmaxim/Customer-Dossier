// Строка поиска: лупа, поле и кнопка «Очистить». Esc очищает, если есть что очищать —
// иначе отдаёт клавишу дальше (закрыть лист или диалог).

import { FC, InputHTMLAttributes, KeyboardEvent, useId, useRef } from 'react';

import { Icon } from './Icon';
import styles from './Input.module.css';

export interface ISearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'size'> {
  value: string;
  onChange: (value: string) => void;
  /** Доступное имя поля: «Поиск компаний и объектов». */
  label: string;
  /** Метку видно глазами; по умолчанию — только для диктора (смысл ясен из лупы). */
  labelVisible?: boolean;
  /** Своё действие на очистку; по умолчанию — onChange(''). */
  onClear?: () => void;
  size?: 'md' | 'lg';
}

export const SearchInput: FC<ISearchInputProps> = ({
  value,
  onChange,
  label,
  labelVisible = false,
  onClear,
  size = 'lg',
  id,
  className,
  onKeyDown,
  ...rest
}) => {
  const auto = useId();
  const inputId = id ?? `search-${auto}`;
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = (): void => {
    if (onClear) onClear();
    else onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className={[styles.search, className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={labelVisible ? styles.searchLabel : 'visually-hidden'}>
        {label}
      </label>
      <div className={styles.searchBox}>
        <Icon name="search" size="md" className={styles.searchIcon} />
        <input
          {...rest}
          ref={inputRef}
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            onKeyDown?.(e);
            if (e.key === 'Escape' && value !== '' && !e.defaultPrevented) {
              e.preventDefault();
              clear();
            }
          }}
          className={[styles.control, styles.block, styles[size], styles.searchControl].join(' ')}
        />
        {value !== '' && (
          <button type="button" className={styles.searchClear} onClick={clear} aria-label="Очистить поиск">
            <Icon name="close" size="sm" />
          </button>
        )}
      </div>
    </div>
  );
};
