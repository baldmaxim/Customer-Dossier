// Плитка сводки «Коротко о компании»: подпись, крупное число, разбивка мелко и ссылка туда,
// где у числа видны правило и знаменатель. Нажимается вся плитка (row-link): ссылка
// растянута на неё псевдоэлементом и остаётся настоящей ссылкой — средний клик, Ctrl+клик.
// На экране ссылка — стрелка в углу (05.10.2026: подпись «Все объекты →» занимала строку в каждой
// плитке), её текст — для диктора. chart — мини-график рядом с числом (форма ряда, число — текстом).
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
  /** Мини-график рядом с числом (Sparkline): только форма, скрыт от диктора. */
  chart?: ReactNode;
}

export const BriefTile: FC<IBriefTileProps> = ({ label, value, detail, to, linkText, viewTransition = false, chart }) => (
  <div className={`${styles.tile} row-link`}>
    <dt className={styles.tileLabel}>{label}</dt>
    <dd className={styles.tileValue}>
      {value}
      {chart}
    </dd>
    {detail && <dd className={styles.tileDetail}>{detail}</dd>}
    <dd className={styles.tileMore}>
      <Link className={`row-link-target ${styles.tileLink}`} to={to} viewTransition={viewTransition}>
        <span className="visually-hidden">{linkText}</span>
        <Icon name="forward" size="sm" />
      </Link>
    </dd>
  </div>
);
