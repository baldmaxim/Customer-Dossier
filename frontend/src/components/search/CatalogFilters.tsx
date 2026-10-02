// Фильтры каталога: «только на контроле», роль, порядок. С 600px — одной строкой; на телефоне свёрнуты
// в строку-сводку («Все роли · по числу объектов»): развёрнутые они занимали полэкрана до первой компании.
//
// Роль — свойство связи, а не компании: одна фирма бывает заказчиком на одном объекте и подрядчиком на
// другом. Поэтому фильтр подписан «выступала в роли», и компания честно попадает сразу в несколько фильтров.
// «На контроле» у имён без ИНН не бывает: отметка ставится компании, и имя с ней — уже в «Юрлицах».

import { FC, useId } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { Checkbox } from '../ui/Checkbox';
import { Disclosure } from '../ui/Disclosure';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { CATALOG_ROLES, CATALOG_SORTS, catalogSummary, type CatalogRole, type ICatalogParams } from './catalogParams';
import styles from './Search.module.css';

interface ICatalogFiltersProps {
  params: ICatalogParams;
}

export const CatalogFilters: FC<ICatalogFiltersProps> = ({ params }) => {
  const wide = useMediaQuery(MQ.sm);
  const roleId = useId();

  const controls = (
    <div className={styles.filters} role="group" aria-label="Фильтры каталога">
      {params.view !== 'unidentified' && <Checkbox label="Только на контроле" checked={params.watch} onChange={params.setWatch} />}
      <div className={styles.roleField}>
        <label htmlFor={roleId} className={styles.fieldLabel}>
          Выступала в роли
        </label>
        <Select id={roleId} value={params.role} block={!wide} onChange={e => params.setRole(e.target.value as CatalogRole)}>
          {CATALOG_ROLES.map(role => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </Select>
      </div>
      <Segmented label="Порядок" items={CATALOG_SORTS} value={params.sort} onChange={params.setSort} size={wide ? 'md' : 'sm'} fill={!wide} />
    </div>
  );

  if (wide) return controls;

  return (
    <Disclosure
      variant="card"
      summary={
        <>
          <VisuallyHidden>Фильтры: </VisuallyHidden>
          {catalogSummary({ ...params, watch: params.view !== 'unidentified' && params.watch })}
        </>
      }
    >
      {controls}
    </Disclosure>
  );
};
