// Вход на страницу «Сайты компаний» с вкладки «Сайты» (этап 25A): идёт ли поиск, сколько ждёт решения,
// расход за сутки. Как вход parser-api.com (ParserApiEntry): сама очередь — на своей странице.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatCount } from '../../lib/format';
import { SITE_SEARCH_MODE_LABELS } from '../../lib/labels';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Section } from '../ui/Section';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { COMPANY_SITES_PAGE_PATH, companySitesSummaryQuery } from './companySitesSettings';
import styles from './Found.module.css';

export const CompanySitesEntry: FC = () => {
  const summary = useQuery(companySitesSummaryQuery);
  const data = summary.data;
  let text = 'Официальные сайты компаний: модель ищет в интернете, вы подтверждаете.';
  if (data) {
    const mode = SITE_SEARCH_MODE_LABELS[data.mode];
    text = `${mode[0]!.toUpperCase()}${mode.slice(1)}. Ждут решения: ${formatCount(data.totals.withPending)}, сайт привязан: ${formatCount(data.totals.confirmed)}. Поисков за сутки: ${formatCount(data.totals.usedLastDay)} из ${formatCount(data.dailyLimit)}.`;
  }
  return (
    <Section title="Сайты компаний">
      <Cluster gap={3} align="center" justify="between">
        <p className={styles.muted}>{text}</p>
        <ButtonLink to={COMPANY_SITES_PAGE_PATH} variant="primary" size="sm">
          Открыть<VisuallyHidden> сайты компаний</VisuallyHidden>
        </ButtonLink>
      </Cluster>
    </Section>
  );
};
