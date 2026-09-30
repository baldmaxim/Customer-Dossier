// Срок сбора: за сколько назад собирать публикации источника (sources.history_days).
//
// Для канала «только новые» — прежнее поведение: первый запуск истории не берёт. Для сайта
// без срока пагинация листает весь архив, а срок останавливает её на дате. RSS-лента
// истории не даёт вовсе — в ней только последние записи, срок там ничего не добавит.
//
// Компактно, для строки таблицы: один список высотой sm. Сохранённый нестандартный срок —
// отдельным пунктом («45 дней»), поле для числа появляется рядом, только пока его вводят:
// постоянное поле расширяло бы колонку «Срок» у всех строк ради одной.

import { FC, useEffect, useRef, useState } from 'react';

import { formatCountWord, type PluralForms } from '../../lib/format';
import { Select } from '../ui/Select';
import { TextInput } from '../ui/TextInput';
import styles from './HistoryDepthPicker.module.css';

const PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 30, label: 'месяц' },
  { days: 90, label: '3 месяца' },
  { days: 180, label: 'полгода' },
  { days: 365, label: 'год' },
  { days: 730, label: '2 года' },
];

const DAY_FORMS: PluralForms = ['день', 'дня', 'дней'];
const MAX_DAYS = 3650;

const isPreset = (days: number): boolean => PRESETS.some(p => p.days === days);

interface IHistoryDepthPickerProps {
  value: number | null;
  kind: 'telegram' | 'website';
  disabled?: boolean;
  /** Подпись для диктора: чей это срок. */
  label: string;
  onChange: (days: number | null) => void;
}

export const HistoryDepthPicker: FC<IHistoryDepthPickerProps> = ({ value, kind, disabled = false, label, onChange }) => {
  // Что сохранено: без срока, пункт списка или своё число дней.
  const saved = value === null ? 'none' : isPreset(value) ? String(value) : 'saved';
  const [mode, setMode] = useState(saved);
  const [draft, setDraft] = useState('');
  // Esc убирает поле; если браузер при этом пришлёт blur, введённое не должно сохраниться.
  const cancelled = useRef(false);

  // Сервер вернул значение (сохранение, другая вкладка): показываем его, поле ввода закрывается.
  useEffect(() => {
    setMode(saved);
  }, [saved, value]);

  const applyDraft = (): void => {
    const days = Number.parseInt(draft, 10);
    if (Number.isInteger(days) && days >= 1 && days <= MAX_DAYS && days !== value) onChange(days);
    // Пусто, не число или то же самое — поле просто закрывается.
    else setMode(saved);
  };

  return (
    <span className={styles.picker}>
      <Select
        aria-label={label}
        className={styles.control}
        value={mode}
        disabled={disabled}
        block={false}
        onChange={e => {
          const next = e.target.value;
          if (next === 'custom') {
            cancelled.current = false;
            setDraft(value !== null && !isPreset(value) ? String(value) : '');
            setMode('custom');
            return;
          }
          setMode(next);
          if (next === 'none') onChange(null);
          else if (next !== 'saved') onChange(Number(next));
        }}
      >
        <option value="none">{kind === 'telegram' ? 'только новые' : 'весь архив'}</option>
        {PRESETS.map(p => (
          <option key={p.days} value={String(p.days)}>
            {p.label}
          </option>
        ))}
        {value !== null && !isPreset(value) && <option value="saved">{formatCountWord(value, DAY_FORMS)}</option>}
        <option value="custom">свой срок…</option>
      </Select>
      {mode === 'custom' && (
        <span className={styles.custom}>
          <TextInput
            className={`${styles.control} ${styles.days}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DAYS}
            placeholder="дней"
            aria-label={`${label}: число дней`}
            value={draft}
            disabled={disabled}
            block={false}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => {
              if (cancelled.current) cancelled.current = false;
              else applyDraft();
            }}
            onKeyDown={e => {
              // Enter сохраняет через blur: иначе Enter и следующий blur отправили бы срок дважды.
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                // Esc отменяет ввод, а не закрывает окно вокруг.
                e.preventDefault();
                cancelled.current = true;
                setMode(saved);
              }
            }}
          />
          <span className={styles.unit} aria-hidden="true">
            дн.
          </span>
        </span>
      )}
    </span>
  );
};
