// Список-карточки — то, чем широкая таблица становится на телефоне (< 600px): каталог,
// источники, разборы, пользователи, участники объекта. Каждая карточка — одна запись:
// заголовок-ссылка (вся карточка кликается, .row-link), строка сведений, числа справа.
//
//   const wide = useMediaQuery(MQ.sm);
//   return wide ? <TableScroll …/> : (
//     <CardList label="Компании">{rows.map(r => <CardListItem key={r.id} to={…} title={r.name} meta="Москва · заказчик" aside="3 объ. · 12 публ." />)}</CardList>
//   );

import { FC, ReactNode } from 'react';

import styles from './CardList.module.css';

export interface ICardListProps {
  /** Имя списка для диктора, если рядом нет заголовка. */
  label?: string;
  className?: string;
  children: ReactNode;
}

export const CardList: FC<ICardListProps> = ({ label, className, children }) => (
  // role="list": Safari снимает семантику списка с <ul> без маркеров.
  <ul role="list" aria-label={label} className={[styles.list, className ?? ''].filter(Boolean).join(' ')}>
    {children}
  </ul>
);
