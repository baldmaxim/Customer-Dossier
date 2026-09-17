// Сопоставление контекста утверждения с предметом обращения (scope-match@1, этап 12). Чистые функции.
//
// Размерности: объект, корпус/очередь, вид работ, роль, период. По каждой — match (совпадает), compatible (обращение
// размерность не ограничивает), unknown (в утверждении не указано — НЕ подтверждение), conflict (явно другое).
// Null в утверждении не является «весь объект» и не доказывает применимость. Явного признака «на весь объект» в
// схеме утверждений нет — поэтому корпус из null не выводится. Вид работ сравнивается только по нормализованной
// теме (ВК, ОВ, ЭОМ…, reprocess/semantic/values.ts), свободные подписи не сопоставляются.

import type { IFact } from './facts.js';

export const SCOPE_MATCH_VERSION = 'scope-match@1';

export type DimensionMatch = 'match' | 'compatible' | 'unknown' | 'conflict';
export type ScopeDimension = 'project' | 'building' | 'work' | 'role' | 'period';

export interface ICaseScope {
  projectId: number | null;
  building: string | null;
  /** Нормализованная тема работ обращения (как в dossier_cases.work_package). */
  workPackage: string | null;
  role: string | null;
  /** Дата, на которую проверяется действие роли/договора: дата обращения. */
  onDate: string | null;
}

export interface IScopeMatch {
  version: string;
  dimensions: Record<ScopeDimension, DimensionMatch>;
  /** Размерности, неизвестные в утверждении при заданных в обращении. */
  missing: ScopeDimension[];
  conflicts: ScopeDimension[];
}

/** «Корп. № 2», «корпус 2», «КОРПУС  2» — одно значение. Другие синонимы не выводятся. */
export const normalizeBuilding = (value: string | null): string | null => {
  if (!value) return null;
  const v = value
    .toLowerCase()
    .replace(/№/g, ' ')
    // \b в JS не видит кириллицу — граница слова задана явно.
    .replace(/(^|\s)корп\.?(?=\s|\d|$)/gu, '$1корпус ')
    .replace(/\s+/g, ' ')
    .trim();
  return v === '' ? null : v;
};

const dim = (caseValue: string | number | null, factValue: string | number | null): DimensionMatch => {
  if (caseValue === null) return 'compatible';
  if (factValue === null) return 'unknown';
  return caseValue === factValue ? 'match' : 'conflict';
};

/** Период утверждения относительно даты обращения; даты утверждения неизвестны — unknown, не «сегодня». */
export const periodMatch = (onDate: string | null, validFrom: string | null, validTo: string | null): DimensionMatch => {
  if (onDate === null) return 'compatible';
  if (validFrom === null && validTo === null) return 'unknown';
  if (validFrom !== null && validFrom > onDate) return 'conflict';
  if (validTo !== null && validTo < onDate) return 'conflict';
  return validFrom !== null ? 'match' : 'unknown';
};

export const matchScope = (fact: IFact, scope: ICaseScope, options: { project: number | null; roleOf?: string | null } = { project: null }): IScopeMatch => {
  const dimensions: Record<ScopeDimension, DimensionMatch> = {
    project: dim(scope.projectId, options.project),
    building: dim(normalizeBuilding(scope.building), normalizeBuilding(fact.scopeBuilding)),
    work: dim(scope.workPackage, fact.workPackage),
    role: dim(scope.role, options.roleOf === undefined ? fact.role : options.roleOf),
    period: periodMatch(scope.onDate, fact.validFrom, fact.validTo),
  };
  const entries = Object.entries(dimensions) as Array<[ScopeDimension, DimensionMatch]>;
  return {
    version: SCOPE_MATCH_VERSION,
    dimensions,
    missing: entries.filter(([, m]) => m === 'unknown').map(([d]) => d),
    conflicts: entries.filter(([, m]) => m === 'conflict').map(([d]) => d),
  };
};

const DIMENSION_TEXT: Record<ScopeDimension, string> = {
  project: 'объект',
  building: 'корпус',
  work: 'вид работ',
  role: 'роль',
  period: 'период',
};

/** Короткое объяснение применимости для фразы досье. */
export const scopeNote = (m: IScopeMatch): string => {
  const parts: string[] = [];
  if (m.conflicts.length > 0) parts.push(`не совпадает: ${m.conflicts.map(d => DIMENSION_TEXT[d]).join(', ')}`);
  if (m.missing.length > 0) parts.push(`в источнике не указано: ${m.missing.map(d => DIMENSION_TEXT[d]).join(', ')}`);
  return parts.length > 0 ? ` [${parts.join('; ')}]` : '';
};
