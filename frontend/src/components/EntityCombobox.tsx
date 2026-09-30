// Поле выбора компании или объекта (combobox со списком): выбранное видно в самом поле, набор
// текста ищет заново, стрелки ходят по найденному, Enter выбирает, Esc закрывает список и
// возвращает выбранное. Список — в потоке страницы под полем, а не поверх соседей.

import { FC, KeyboardEvent, useId, useState } from 'react';

import type { IEntityOption, IEntityRef } from './entitySearch';
import { MIN_QUERY } from './entitySearch';
import { SearchInput } from './ui/SearchInput';
import styles from './EntityCombobox.module.css';

export interface IComboboxGroup {
  key: string;
  /** Подпись группы: «Компании», «Объекты». */
  label: string;
  options: IEntityOption[];
  loading: boolean;
  /** Текст ошибки запроса (describeLoadError) или null. */
  error: string | null;
  /** Что сказать, если в группе пусто: «Объект не найден.» */
  emptyText: string;
}

export interface IEntityComboboxProps {
  label: string;
  hint?: string;
  value: IEntityRef | null;
  /** Текущий ввод — снаружи, по нему идут запросы. */
  query: string;
  onQueryChange: (query: string) => void;
  groups: IComboboxGroup[];
  onSelect: (entity: IEntityRef) => void;
  /** Крестик при выбранном значении снимает выбор; без обработчика — просто очищает поле для нового поиска. */
  onClear?: () => void;
}

export const EntityCombobox: FC<IEntityComboboxProps> = ({ label, hint, value, query, onQueryChange, groups, onSelect, onClear }) => {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const options = groups.flatMap(g => g.options);
  const shown = editing ? query : (value?.name ?? query);
  const listOpen = open && editing && query.trim().length >= MIN_QUERY;
  const optionId = (index: number): string => `${id}-option-${index}`;

  const choose = (entity: IEntityRef): void => {
    onSelect(entity);
    onQueryChange('');
    setEditing(false);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!editing) return;
      e.preventDefault();
      setOpen(true);
      const last = options.length - 1;
      setActive(prev => (e.key === 'ArrowDown' ? (prev >= last ? 0 : prev + 1) : prev <= 0 ? last : prev - 1));
      return;
    }
    if (e.key === 'Enter' && listOpen) {
      const option = options[active];
      if (option) {
        e.preventDefault();
        choose(option.entity);
      }
      return;
    }
    if (e.key === 'Escape') {
      // Сначала закрыть список, потом — вернуть выбранное; третий Esc очистит поле (SearchInput).
      if (listOpen) {
        e.preventDefault();
        setOpen(false);
      } else if (editing && value) {
        e.preventDefault();
        setEditing(false);
        onQueryChange('');
      }
    }
  };

  let index = -1;
  const found = groups.map(g => `${g.label}: ${g.loading ? 'ищу' : (g.error ?? String(g.options.length))}`).join('; ');

  return (
    <div className={styles.combo}>
      <SearchInput
        label={label}
        labelVisible
        size="md"
        value={shown}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
        aria-describedby={hint ? hintId : undefined}
        onChange={next => {
          onQueryChange(next);
          setEditing(true);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={e => e.currentTarget.select()}
        onBlur={() => {
          // Ушли из поля, ничего не выбрав, — в поле снова выбранное, а не недописанный запрос.
          setEditing(false);
          setOpen(false);
          onQueryChange('');
        }}
        onClear={() => {
          if (!editing && value && onClear) onClear();
          onQueryChange('');
          setEditing(true);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <div id={listId} role="listbox" aria-label={`${label}: найдено`} className={listOpen ? styles.list : styles.hidden}>
        {listOpen &&
          groups.map(group => (
            <div key={group.key} role="group" aria-labelledby={`${id}-${group.key}`} className={styles.group}>
              <div id={`${id}-${group.key}`} role="presentation" className={styles.groupLabel}>
                {group.label}
              </div>
              {group.options.map(option => {
                index += 1;
                const own = index;
                return (
                  <div
                    key={`${option.entity.kind}:${option.entity.id}`}
                    id={optionId(own)}
                    role="option"
                    aria-selected={own === active}
                    className={own === active ? `${styles.option} ${styles.active}` : styles.option}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setActive(own)}
                    onClick={() => choose(option.entity)}
                  >
                    <span className={styles.name}>{option.title}</span>
                    {option.meta && <span className={styles.meta}>{option.meta}</span>}
                  </div>
                );
              })}
              {group.options.length === 0 && (
                <div role="presentation" aria-hidden="true" className={group.error ? styles.error : styles.empty}>
                  {group.loading ? 'Ищу…' : (group.error ?? group.emptyText)}
                </div>
              )}
            </div>
          ))}
      </div>
      <p role="status" className="visually-hidden">
        {listOpen ? `Найдено — ${found}` : ''}
      </p>
    </div>
  );
};
