// Фильтры схемы. Типы связей видны всегда — это и легенда (штрих линии рядом с подписью), и
// самый частый фильтр. Остальное — под «Ещё фильтры»: развёрнутые, они уводили схему на
// второй экран (на 1280 она начиналась с y≈1130, на телефоне — с y≈1830).

import { FC, useEffect, useState } from 'react';

import { useDebounced } from '../../hooks/useDebounced';
import { GRAPH_EDGE_LABELS } from '../../lib/labels';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Disclosure } from '../ui/Disclosure';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { TextInput } from '../ui/TextInput';
import { EdgeSample } from './EdgeSample';
import { ALL_EDGE_TYPES, GRAPH_DEPTHS, extraFilterCount, isGraphDepth } from './graphModel';
import type { IGraphState } from './useGraphState';
import styles from './Graph.module.css';

export const GraphFilters: FC<{ state: IGraphState }> = ({ state }) => {
  const { filters, setFilters, resetExtra } = state;
  // Корпус набирают по буквам — запрос уходит после паузы, а не на каждую букву.
  const [building, setBuilding] = useState(filters.building);
  const debounced = useDebounced(building, 400);
  useEffect(() => setBuilding(filters.building), [filters.building]);
  // Только на новое значение из поля (зависимость одна): сброс фильтров приходит сверху
  // и не должен возвращаться отсюда прежним значением.
  useEffect(() => {
    if (debounced.trim() !== filters.building.trim()) setFilters({ building: debounced });
  }, [debounced]);

  const extra = extraFilterCount(filters);

  return (
    <div className={styles.filters}>
      <fieldset className={styles.types} aria-label="Типы связей (легенда схемы)">
        <legend className={styles.typesLegend}>Типы связей</legend>
        <div className={styles.typeList}>
          {ALL_EDGE_TYPES.map(type => (
            <Checkbox
              key={type}
              checked={filters.types.includes(type)}
              onChange={on => setFilters({ types: on ? [...filters.types, type] : filters.types.filter(t => t !== type) })}
              label={
                <span className={styles.typeLabel}>
                  <EdgeSample type={type} />
                  {GRAPH_EDGE_LABELS[type]}
                </span>
              }
            />
          ))}
        </div>
      </fieldset>

      <Disclosure summary="Ещё фильтры" meta={extra > 0 ? `включено: ${extra}` : undefined}>
        <div className={styles.more}>
          <div className={styles.moreFields}>
            <Field label="Шагов от центра">
              {control => (
                <Select
                  {...control}
                  value={String(filters.depth)}
                  onChange={e => {
                    const depth = Number(e.target.value);
                    if (isGraphDepth(depth)) setFilters({ depth });
                  }}
                >
                  {GRAPH_DEPTHS.map(d => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Корпус" hint="например, «корпус 2»">
              {control => <TextInput {...control} value={building} maxLength={120} autoComplete="off" onChange={e => setBuilding(e.target.value)} />}
            </Field>
            <Field label="Период с">
              {control => <TextInput {...control} type="date" value={filters.from} onChange={e => setFilters({ from: e.target.value })} />}
            </Field>
            <Field label="Период по">
              {control => <TextInput {...control} type="date" value={filters.to} onChange={e => setFilters({ to: e.target.value })} />}
            </Field>
          </div>
          <Checkbox label="только проверенные оператором" checked={filters.reviewedOnly} onChange={on => setFilters({ reviewedOnly: on })} />
          <Checkbox
            label="показать планы, заявления и отрицания"
            hint="Обычно на схеме только то, что источник сообщает как факт."
            checked={filters.includeUnconfirmed}
            onChange={on => setFilters({ includeUnconfirmed: on })}
          />
          {extra > 0 && (
            <div>
              <Button variant="ghost" size="sm" onClick={resetExtra}>
                Сбросить эти фильтры
              </Button>
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
};
