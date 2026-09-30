// Строка под именем компании: реквизиты с подписями (ИНН, ОГРН), город, вид лица.
// Чипы — через промежуток, а не «·»: перенесённая строка не начинается с точки.

import { FC } from 'react';

import type { ICompany, ICompanyIdentifier } from '../../api/types';
import { ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS } from '../../lib/labels';
import styles from './Company.module.css';

interface ICompanyMetaProps {
  company: ICompany;
  identifiers: ICompanyIdentifier[];
}

/** ИНН и ОГРН — первыми: по ним компанию опознают; КПП и прочее — после. */
const IDENTIFIER_ORDER: Record<string, number> = { inn: 0, ogrn: 1, ogrnip: 2, bin: 3, kpp: 4 };

export const CompanyMeta: FC<ICompanyMetaProps> = ({ company, identifiers }) => {
  const ids =
    identifiers.length > 0
      ? [...identifiers]
          .sort((a, b) => (IDENTIFIER_ORDER[a.type] ?? 9) - (IDENTIFIER_ORDER[b.type] ?? 9))
          .map(i => ({ key: `${i.type}:${i.value}`, label: IDENTIFIER_TYPE_LABELS[i.type] ?? 'реквизит', value: i.value }))
      : company.taxId
        ? [{ key: 'tax', label: 'ИНН/ОГРН', value: company.taxId }]
        : [];
  const kind = company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null;

  return (
    <ul className={styles.meta} aria-label="Реквизиты и город">
      {ids.map(id => (
        <li key={id.key} className={styles.chip}>
          <span className={styles.chipLabel}>{id.label}</span> <span className="num">{id.value}</span>
        </li>
      ))}
      {ids.length === 0 && <li className={styles.chip}>реквизиты не установлены</li>}
      {company.city && <li className={styles.chip}>{company.city}</li>}
      {kind && <li className={styles.chip}>{kind}</li>}
      {company.legalForm && <li className={styles.chip}>{company.legalForm}</li>}
    </ul>
  );
};
