import { FC } from 'react';

import type { RiskLight } from '../api/types';
import styles from './RiskBadge.module.css';

interface IRiskBadgeProps {
  light: RiskLight;
  score?: number;
  large?: boolean;
}

/**
 * Подписи намеренно словесные, а не только цветные: цвет один ничего не
 * сообщает при дальтонизме и в чёрно-белой печати.
 *
 * «Мало данных» — не «всё в порядке». Компания с одним негативным постом
 * без истории не должна выглядеть проверенной, но и красной она не является.
 */
const LABELS: Record<RiskLight, string> = {
  grey: 'Мало данных',
  green: 'Без замечаний',
  yellow: 'Есть вопросы',
  red: 'Высокий риск',
};

export const RiskBadge: FC<IRiskBadgeProps> = ({ light, score, large = false }) => {
  const className = [styles.badge, styles[light], large ? styles.large : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={className} title={score !== undefined ? `Индекс риска: ${score}` : undefined}>
      <span className={styles.dot} aria-hidden="true" />
      {LABELS[light]}
      {score !== undefined && light !== 'grey' ? ` · ${score}` : null}
    </span>
  );
};
