// Вход на страницу Контур.Фокуса с вкладки «Сайты»: подключён ли, сколько запросов ушло за сутки, кнопка
// «Открыть». Как вход наш.дом.рф (DomRfEntry): сама настройка — на своей странице.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatCount } from '../../lib/format';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Section } from '../ui/Section';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { FOCUS_PAGE_PATH, focusSettingsQuery } from './focusSettings';
import styles from './Found.module.css';

export const FocusEntry: FC = () => {
  const settings = useQuery(focusSettingsQuery);
  const data = settings.data;
  let text = 'Сведения ЕГРЮЛ о компаниях портала по ИНН: статус, руководитель, адрес, учредители.';
  if (data) {
    text =
      data.key.source === 'none'
        ? 'Не подключён: ключ не задан.'
        : `Подключён. Запросов за сутки: ${formatCount(data.usedLastDay)} из ${formatCount(data.dailyLimit)}. Сведения есть у ${formatCount(data.coverage.found)} из ${formatCount(data.coverage.identifiers)} компаний с ИНН/ОГРН.`;
  }
  return (
    <Section title="Контур.Фокус — сведения ЕГРЮЛ">
      <Cluster gap={3} align="center" justify="between">
        <p className={styles.muted}>{text}</p>
        <ButtonLink to={FOCUS_PAGE_PATH} variant="primary" size="sm">
          Открыть<VisuallyHidden> Контур.Фокус</VisuallyHidden>
        </ButtonLink>
      </Cluster>
    </Section>
  );
};
