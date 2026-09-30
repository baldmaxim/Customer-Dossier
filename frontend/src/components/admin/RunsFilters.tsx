// Фильтры списка разборов: источник — по названию (в запрос уходит его номер), статус — словами.
// Раньше фильтры просили «Источник #», «Редакция #», схему и отпечаток: чисел, которых нет
// ни на одном экране, и слов, понятных только конвейеру.

import { FC } from 'react';

import type { ISourceRow, RunStatus } from '../../api/types';
import { RUN_STATUS_LABELS } from '../../lib/labels';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { sourceName } from './useSourceActions';
import styles from './Forms.module.css';

export const RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'];

interface IRunsFiltersProps {
  sources: ISourceRow[];
  sourceId: number | null;
  status: RunStatus | '';
  onChange: (patch: { sourceId?: number | null; status?: RunStatus | '' }) => void;
}

export const RunsFilters: FC<IRunsFiltersProps> = ({ sources, sourceId, status, onChange }) => {
  const sorted = [...sources].sort((a, b) => sourceName(a).localeCompare(sourceName(b), 'ru'));
  // Источник из адреса может быть удалён или ещё не загружен — пункт остаётся, чтобы фильтр был виден.
  const known = sourceId === null || sorted.some(s => s.id === sourceId);
  return (
    <div className={styles.inline} role="search" aria-label="Фильтры разборов">
      <Field label="Источник" className={styles.medium}>
        {control => (
          <Select
            {...control}
            value={sourceId === null ? '' : String(sourceId)}
            onChange={e => onChange({ sourceId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">все источники</option>
            {!known && <option value={String(sourceId)}>выбранный источник</option>}
            {sorted.map(s => (
              <option key={s.id} value={String(s.id)}>
                {sourceName(s)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Статус разбора" className={styles.narrow}>
        {control => (
          <Select {...control} value={status} onChange={e => onChange({ status: e.target.value as RunStatus | '' })}>
            <option value="">любой</option>
            {RUN_STATUSES.map(s => (
              <option key={s} value={s}>
                {RUN_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {(sourceId !== null || status !== '') && (
        <Button variant="ghost" icon="close" onClick={() => onChange({ sourceId: null, status: '' })}>
          Сбросить
        </Button>
      )}
    </div>
  );
};
