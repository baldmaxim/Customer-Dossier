// Плитка сводки «Коротко о компании»: подпись, крупное число, разбивка мелко и ссылка туда,
// где у числа видны правило и знаменатель. Нажимается вся плитка (row-link): ссылка
// растянута на неё псевдоэлементом и остаётся настоящей ссылкой — средний клик, Ctrl+клик.
//
// Разметка — пара dt/dd внутри общего <dl> сводки: диктор читает «Объекты, 7, …».

import { FC, ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';

import { Icon } from '../ui/Icon';
import styles from '../CompanyBrief.module.css';

export interface IBriefTileProps {
  label: string;
  /** Уже отформатированное число; неизвестное — «—», не «0». */
  value: string;
  detail?: ReactNode;
  to: To;
  linkText: string;
  /** Переход на другой экран — с View Transition; смена вкладки и якорь — без. */
  viewTransition?: boolean;
}

export const BriefTile: FC<IBriefTileProps> = ({ label, value, detail, to, linkText, viewTransition = false }) => {
  // Стрелка держится за последнее слово: перенос подписи не оставляет её одну на строке.
  const words = linkText.split(' ');
  const last = words.pop();
  return (
    <div className={`${styles.tile} row-link`}>
      <dt className={styles.tileLabel}>{label}</dt>
      <dd className={styles.tileValue}>{value}</dd>
      {detail && <dd className={styles.tileDetail}>{detail}</dd>}
      <dd className={styles.tileMore}>
        <Link className={`row-link-target ${styles.tileLink}`} to={to} viewTransition={viewTransition}>
          {words.length > 0 && `${words.join(' ')} `}
          <span className={styles.tileLinkTail}>
            {last}
            <Icon name="forward" size="sm" />
          </span>
        </Link>
      </dd>
    </div>
  );
};
