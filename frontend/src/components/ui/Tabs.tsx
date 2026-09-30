// Вкладки уровня страницы: «Обзор · Публикации · Подробно», вкладки «Проверки» и «Источников».
// Фильтры и режимы внутри экрана — Segmented, не Tabs (README примитивов).
//
// Клавиатура по WAI-ARIA: вкладки — одна остановка Tab (roving tabindex), ←/→ переходят
// по кругу, Home/End — к первой и последней. activation 'auto' — вкладка выбирается при
// переходе стрелкой (панели лёгкие); 'manual' — стрелки только двигают фокус, выбор — Enter
// или пробел (тяжёлая панель или запись в историю на каждый шаг ни к чему).
//
//   const idBase = useId();
//   <Tabs label="Разделы компании" idBase={idBase} items={TABS} value={tab} onChange={setTab} />
//   <TabPanel idBase={idBase} value={tab}>…</TabPanel>

import { KeyboardEvent, ReactElement, useEffect, useRef } from 'react';

import { scrollIntoRow } from './scrollIntoRow';
import { TabButton } from './TabButton';
import { panelId, tabId } from './tabs';
import styles from './Tabs.module.css';

export interface ITabItem<T extends string> {
  value: T;
  label: string;
  /** Число рядом с подписью: «Публикации 20». null/undefined — без числа. */
  count?: number | null;
  hint?: string;
  disabled?: boolean;
}

export interface ITabsProps<T extends string> {
  /** Доступное имя списка вкладок: «Разделы компании». */
  label: string;
  items: ReadonlyArray<ITabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Общий с TabPanel префикс id: без него вкладки не связаны с панелью (aria-controls). */
  idBase?: string;
  variant?: 'underline' | 'pill';
  size?: 'sm' | 'md';
  activation?: 'auto' | 'manual';
  className?: string;
}

export const Tabs = <T extends string>({
  label,
  items,
  value,
  onChange,
  idBase,
  variant = 'underline',
  size = 'md',
  activation = 'auto',
  className,
}: ITabsProps<T>): ReactElement => {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const selectedExists = items.some(item => item.value === value && !item.disabled);
  const firstEnabled = items.find(item => !item.disabled)?.value;

  useEffect(() => {
    scrollIntoRow(listRef.current, tabRefs.current.get(value));
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const enabled = items.filter(item => !item.disabled);
    const current = enabled.findIndex(item => tabRefs.current.get(item.value) === document.activeElement);
    if (current === -1 || enabled.length === 0) return;
    let next: number;
    if (e.key === 'ArrowRight') next = (current + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    tabRefs.current.get(target.value)?.focus();
    if (activation === 'auto' && target.value !== value) onChange(target.value);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={[styles.list, styles[variant], styles[size], className ?? ''].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {items.map(item => (
        <TabButton
          key={item.value}
          id={idBase ? tabId(idBase, item.value) : undefined}
          controls={idBase ? panelId(idBase, item.value) : undefined}
          label={item.label}
          count={item.count}
          hint={item.hint}
          selected={item.value === value}
          disabled={item.disabled}
          focusable={selectedExists ? item.value === value : item.value === firstEnabled}
          onSelect={() => {
            if (item.value !== value) onChange(item.value);
          }}
          buttonRef={node => {
            if (node) tabRefs.current.set(item.value, node);
            else tabRefs.current.delete(item.value);
          }}
        />
      ))}
    </div>
  );
};
