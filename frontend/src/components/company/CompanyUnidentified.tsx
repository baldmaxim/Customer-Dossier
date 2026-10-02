// «Юрлицо не установлено» (ADR-016): карточка — имя из публикаций без ИНН. Это не компания каталога, а
// упоминание: портал не знает, какое это юрлицо, поэтому сведений ЕГРЮЛ у него нет. Публикации и
// утверждения при нём сохраняются и перейдут к компании, когда человек назначит упоминание.

import { FC } from 'react';

import type { ICompanyResponse } from '../../api/types';
import { Section } from '../ui/Section';
import styles from './Company.module.css';

export const CompanyUnidentified: FC<{ companyId: number; data: ICompanyResponse }> = ({ data }) => (
  <Section id="company-unidentified" title="Юрлицо не установлено">
    <p className={styles.unidentifiedText}>
      «{data.company.name}» — имя из публикаций без ИНН. Какое это юрлицо, портал не знает, поэтому сведений ЕГРЮЛ здесь нет.
      Когда имя назначат компании, его публикации перейдут к ней.
    </p>
  </Section>
);
