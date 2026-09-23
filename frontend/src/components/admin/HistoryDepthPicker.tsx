// Срок сбора: за сколько назад собирать публикации источника (sources.history_days).
//
// Для канала «только новые» — прежнее поведение: первый запуск истории не берёт. Для сайта
// без срока пагинация листает весь архив, а срок останавливает её на дате. RSS-лента
// истории не даёт вовсе — в ней только последние записи, срок там ничего не добавит.

import { FC, useEffect, useState } from 'react';

import styles from './HistoryDepthPicker.module.css';

const PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 30, label: 'месяц' },
  { days: 90, label: '3 месяца' },
  { days: 180, label: 'полгода' },
  { days: 365, label: 'год' },
  { days: 730, label: '2 года' },
];

interface IHistoryDepthPickerProps {
  value: number | null;
  kind: 'telegram' | 'website';
  disabled?: boolean;
  /** Подпись для диктора: чей это срок. */
  label: string;
  onChange: (days: number | null) => void;
}

export const HistoryDepthPicker: FC<IHistoryDepthPickerProps> = ({ value, kind, disabled = false, label, onChange }) => {
  const preset = value === null ? 'none' : PRESETS.some(p => p.days === value) ? String(value) : 'custom';
  const [mode, setMode] = useState(preset);
  const [custom, setCustom] = useState(value !== null && preset === 'custom' ? String(value) : '');

  // Сервер мог вернуть другое значение (другая вкладка, повтор): показываем его.
  useEffect(() => {
    setMode(preset);
    if (preset === 'custom' && value !== null) setCustom(String(value));
  }, [preset, value]);

  const applyCustom = (): void => {
    const days = Number.parseInt(custom, 10);
    if (Number.isInteger(days) && days >= 1 && days <= 3650 && days !== value) onChange(days);
  };

  return (
    <span className={styles.picker}>
      <select
        className={styles.select}
        aria-label={label}
        value={mode}
        disabled={disabled}
        onChange={e => {
          const next = e.target.value;
          setMode(next);
          if (next === 'none') onChange(null);
          else if (next !== 'custom') onChange(Number(next));
        }}
      >
        <option value="none">{kind === 'telegram' ? 'только новые' : 'весь архив'}</option>
        {PRESETS.map(p => (
          <option key={p.days} value={String(p.days)}>
            {p.label}
          </option>
        ))}
        <option value="custom">своё число дней…</option>
      </select>
      {mode === 'custom' && (
        <input
          className={styles.days}
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          placeholder="дней"
          aria-label={`${label}: число дней`}
          value={custom}
          disabled={disabled}
          onChange={e => setCustom(e.target.value)}
          onBlur={applyCustom}
          onKeyDown={e => {
            if (e.key === 'Enter') applyCustom();
          }}
        />
      )}
    </span>
  );
};
