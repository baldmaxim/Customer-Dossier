import { FC } from 'react';

import type { RiskLight } from '../api/types';
import { RISK_LEGACY_LABELS, RISK_LEGACY_NOTE } from '../lib/labels';
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
 * Индекс устаревший и некалиброванный: бейдж говорит «сигналов не найдено»,
 * а не «без замечаний», и помечен как legacy. Замена — этап 07.
 */
export const RiskBadge: FC<IRiskBadgeProps> = ({ light, score, large = false }) => {
  const className = [styles.badge, styles[light], large ? styles.large : '']
    .filter(Boolean)
    .join(' ');

  const title = score !== undefined ? `${RISK_LEGACY_NOTE} Индекс: ${score}` : RISK_LEGACY_NOTE;

  return (
    <span className={className} title={title}>
      <span className={styles.dot} aria-hidden="true" />
      {RISK_LEGACY_LABELS[light]}
      {/* У серого индекс не показываем: считать нечего, число вводило бы в
          заблуждение. */}
      {score !== undefined && light !== 'grey' ? (
        <span className={styles.score}>· {score}</span>
      ) : null}
      <span className={styles.legacy}>legacy</span>
    </span>
  );
};
