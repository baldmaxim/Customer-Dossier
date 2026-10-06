// Вход на страницу parser-api.com с вкладки «Сайты» (этап 24A): подключён ли, расход за сутки и месяц,
// кнопка «Открыть». Как вход Контур.Фокуса (FocusEntry): сама настройка — на своей странице.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatCount } from '../../lib/format';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Section } from '../ui/Section';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { PARSER_API_PAGE_PATH, parserApiSettingsQuery } from './parserApiSettings';
import styles from './Found.module.css';

export const ParserApiEntry: FC = () => {
  const settings = useQuery(parserApiSettingsQuery);
  const data = settings.data;
  let text = 'Бухгалтерская отчётность, налоги, арбитражные дела, ФССП и банкротство компаний по ИНН.';
  if (data) {
    text =
      data.key.source === 'none'
        ? 'Не подключён: ключ не задан.'
        : `Подключён. Запросов за сутки: ${formatCount(data.usage.day)} из ${formatCount(data.limits.daily)}, за месяц: ${formatCount(data.usage.month)} из ${formatCount(data.limits.monthly)}.`;
  }
  return (
    <Section title="parser-api.com — открытые реестры">
      <Cluster gap={3} align="center" justify="between">
        <p className={styles.muted}>{text}</p>
        <ButtonLink to={PARSER_API_PAGE_PATH} variant="primary" size="sm">
          Открыть<VisuallyHidden> parser-api.com</VisuallyHidden>
        </ButtonLink>
      </Cluster>
    </Section>
  );
};
