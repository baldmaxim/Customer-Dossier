// Выбор компании или объекта: одно поле с меткой, выбранное видно в самом поле, найденное —
// по группам «Компании» и «Объекты» с реквизитами и городом, чтобы одноимённые различались.
// CompanyPicker и ProjectPicker — прежние имена и пропсы поверх общего поля.

import { FC, useState } from 'react';

import { useDebounced } from '../hooks/useDebounced';
import { describeLoadError } from '../lib/loadError';
import { EntityCombobox, type IComboboxGroup } from './EntityCombobox';
import {
  MIN_QUERY,
  companyOption,
  projectOption,
  useCompanySearch,
  useProjectSearch,
  type IEntityRef,
} from './entitySearch';

export { identifierText, type IEntityRef } from './entitySearch';

type EntityKind = IEntityRef['kind'];

const BOTH: readonly EntityKind[] = ['company', 'project'];

export interface IEntityPickerProps {
  label: string;
  value: IEntityRef | null;
  onSelect: (entity: IEntityRef) => void;
  hint?: string;
  /** Что искать: компании, объекты или то и другое (по умолчанию). */
  kinds?: readonly EntityKind[];
  /** Крестик при выбранном значении снимает выбор (без него — только очищает поле для нового поиска). */
  onClear?: () => void;
}

export const EntityPicker: FC<IEntityPickerProps> = ({ label, value, onSelect, hint = 'Название, ИНН или ОГРН', kinds = BOTH, onClear }) => {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const withCompanies = kinds.includes('company');
  const withProjects = kinds.includes('project');
  const companies = useCompanySearch(q, withCompanies);
  const projects = useProjectSearch(q, withProjects);
  // Пока пауза набора не кончилась, прежний ответ — не ответ на то, что в поле.
  const typing = text.trim().length >= MIN_QUERY && text.trim() !== q;

  const groups: IComboboxGroup[] = [];
  if (withCompanies) {
    groups.push({
      key: 'companies',
      label: 'Компании',
      options: typing ? [] : (companies.data?.items ?? []).map(companyOption),
      loading: typing || companies.isLoading,
      error: companies.isError ? describeLoadError(companies.error) : null,
      emptyText: 'Компания не найдена.',
    });
  }
  if (withProjects) {
    groups.push({
      key: 'projects',
      label: 'Объекты',
      options: typing ? [] : (projects.data?.items ?? []).map(projectOption),
      loading: typing || projects.isLoading,
      error: projects.isError ? describeLoadError(projects.error) : null,
      emptyText: 'Объект не найден.',
    });
  }

  return <EntityCombobox label={label} hint={hint} value={value} query={text} onQueryChange={setText} groups={groups} onSelect={onSelect} onClear={onClear} />;
};

interface ISelected {
  id: number;
  name: string;
}

interface ICompanyPickerProps {
  label: string;
  selected: ISelected | null;
  onSelect: (company: ISelected | null) => void;
  hint?: string;
}

/** Выбор юрлица среди кандидатов: вид, реквизиты, город и одноимённые — первая строка не подставляется. */
export const CompanyPicker: FC<ICompanyPickerProps> = ({ label, selected, onSelect, hint }) => (
  <EntityPicker
    label={label}
    hint={hint}
    kinds={['company']}
    value={selected ? { kind: 'company', ...selected } : null}
    onSelect={entity => onSelect({ id: entity.id, name: entity.name })}
    onClear={() => onSelect(null)}
  />
);

interface IProjectPickerProps {
  selected: ISelected | null;
  onSelect: (project: ISelected | null) => void;
  label?: string;
  hint?: string;
}

/** Выбор объекта: город, уровень (комплекс, очередь, корпус) и родитель — одноимённые ЖК разных городов различимы. */
export const ProjectPicker: FC<IProjectPickerProps> = ({ selected, onSelect, label = 'Объект', hint = 'Название объекта' }) => (
  <EntityPicker
    label={label}
    hint={hint}
    kinds={['project']}
    value={selected ? { kind: 'project', ...selected } : null}
    onSelect={entity => onSelect({ id: entity.id, name: entity.name })}
    onClear={() => onSelect(null)}
  />
);
