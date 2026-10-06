// Вход на страницу parser-api.com с вкладки «Сайты» (этап 24A): ярлык подключения (зелёный — сервис уже
// ответил успехом), лимит на сервис и самый расходуемый сервис месяца,
// кнопка «Открыть». Как вход Контур.Фокуса (FocusEntry): сама настройка — на своей странице.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { IParserApiSettings } from '../../api/types';
import { formatCount } from '../../lib/format';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Section } from '../ui/Section';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { ParserApiConnectionBadge } from './ParserApiConnectionBadge';
import { PARSER_API_PAGE_PATH, parserApiSettingsQuery } from './parserApiSettings';
import styles from './Found.module.css';

/** Лимит — на каждый сервис тарифа; одной строкой — самый расходуемый за месяц. */
const entryUsageText = (data: IParserApiSettings): string => {
  const limit = `Лимит на сервис: ${formatCount(data.limits.daily)} за сутки, ${formatCount(data.limits.monthly)} за месяц.`;
  const top = [...data.services].sort((a, b) => b.month - a.month)[0];
  return top && top.month > 0 ? `${limit} Больше всего за месяц — ${top.service}: ${formatCount(top.month)}.` : `${limit} В этом месяце запросов не было.`;
};

export const ParserApiEntry: FC = () => {
  const settings = useQuery(parserApiSettingsQuery);
  const data = settings.data;
  let text = 'Бухгалтерская отчётность, налоги, арбитражные дела, ФССП и банкротство компаний по ИНН.';
  if (data) {
    text =
      data.key.source === 'none'
        ? 'Не подключён: ключ не задан.'
        : entryUsageText(data);
  }
  return (
    <Section title="parser-api.com — открытые реестры">
      <Cluster gap={3} align="center" justify="between">
        <Cluster gap={2} align="center">
          {data && <ParserApiConnectionBadge settings={data} />}
          <p className={styles.muted}>{text}</p>
        </Cluster>
        <ButtonLink to={PARSER_API_PAGE_PATH} variant="primary" size="sm">
          Открыть<VisuallyHidden> parser-api.com</VisuallyHidden>
        </ButtonLink>
      </Cluster>
    </Section>
  );
};
