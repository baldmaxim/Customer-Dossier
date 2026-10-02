// Вход на страницу наш.дом.рф с вкладки «Сайты»: сколько ждёт решения и кнопка «Открыть». Сами списки —
// на странице ДОМ.РФ вкладками: на «Сайтах» три длинных списка под таблицей сайтов терялись.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatCount } from '../../lib/format';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Section } from '../ui/Section';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { DOMRF_PAGE_PATH, domRfSummaryQuery } from './domRfSummary';
import styles from './Found.module.css';

export const DomRfEntry: FC = () => {
  const summary = useQuery(domRfSummaryQuery);
  const data = summary.data;
  return (
    <Section title="наш.дом.рф — реестр застройщиков">
      <Cluster gap={3} align="center" justify="between">
        <p className={styles.muted}>
          {data
            ? `Ждут решения: компании — ${formatCount(data.companies.withPending)}, объекты — ${formatCount(data.objects.pending)}. Проверено компаний ${formatCount(data.companies.searched)} из ${formatCount(data.companies.companies)}.`
            : 'Компании портала в реестре застройщиков и объекты их застройщиков.'}
        </p>
        <ButtonLink to={DOMRF_PAGE_PATH} variant="primary" size="sm">
          Открыть<VisuallyHidden> наш.дом.рф</VisuallyHidden>
        </ButtonLink>
      </Cluster>
    </Section>
  );
};
