// «Источники и даты» — внизу вкладки «Сведения» (05.10.2026, просьба владельца «много воздуха»).
// Раньше на одной вкладке стояли четыре оговорки: строка под шапкой, плашка Фокуса, плашка реестра и
// абзац под сводкой. Теперь откуда что и на какую дату — одним списком, одна фраза «не оценка».
// Оговорки те же и теми же словами источника (атрибуция Фокуса и реестра приходит с сервера): правило
// «у сведений — источник и дата» (ADR-015, этап 20B) не ослаблено, только собрано в одно место.
//
// Запросы — из кэша: карточка, Фокус и показатели уже загружены вкладкой и шапкой.

import { FC } from 'react';

import type { ICompanyResponse } from '../../api/types';
import { formatDate, formatDateTime } from '../../lib/labels';
import { registryDateText } from '../RegistryChanges';
import { useCompanyFocus, useCompanySignals } from './useCompanyQueries';
import styles from './Company.module.css';

export interface ICompanySourcesProps {
  companyId: number;
  data: ICompanyResponse;
  /** У карточки есть реквизит юрлица — Фокус спрашивали. */
  identified: boolean;
}

export const CompanySources: FC<ICompanySourcesProps> = ({ companyId, data, identified }) => {
  const focus = useCompanyFocus(companyId, identified);
  const signals = useCompanySignals(companyId);
  const view = focus.data;
  const refresh = signals.data?.refresh;
  const registry = data.registry;

  let metrics: string | null = null;
  if (refresh?.active) {
    metrics = `Публикации, роли, связи и суды посчитаны ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' — расчёт устарел' : ''}; объекты и события — на сегодня.`;
  } else if (signals.isSuccess) {
    metrics = 'Показатели ещё не посчитаны: объекты и события — на сегодня, публикаций пока не видно.';
  }
  const checkedAt = view?.check?.checkedAt ?? view?.fetchedAt ?? null;

  return (
    <section className={styles.sources} aria-labelledby={`company-sources-${companyId}`}>
      <h2 id={`company-sources-${companyId}`} className={styles.sourcesTitle}>
        Источники и даты
      </h2>
      <ul className={styles.sourcesList}>
        {view && (view.fields ?? []).length > 0 && (
          <li>
            <span className={styles.sourcesLead}>ЕГРЮЛ.</span> {view.attribution}
            {checkedAt ? ` Проверено ${formatDate(checkedAt)}.` : ''}
          </li>
        )}
        {registry && (
          <li>
            <span className={styles.sourcesLead}>ДОМ.РФ.</span> {registry.attribution}: {registry.source.title}, запись {registry.externalRef}.{' '}
            {registryDateText(registry.asOf, registry.fetchedAt)}.
          </li>
        )}
        {metrics && (
          <li>
            <span className={styles.sourcesLead}>Публикации.</span> {metrics}
          </li>
        )}
      </ul>
      <p className={styles.sourcesNote}>Это сведения из открытых публикаций и реестров, а не проверка контрагента и не оценка надёжности.</p>
    </section>
  );
};
