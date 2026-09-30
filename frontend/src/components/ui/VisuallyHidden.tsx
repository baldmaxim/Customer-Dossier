// Текст только для диктора: подпись колонки действий, уточнение к иконке, «(откроется
// в новой вкладке)». Глазами не виден, в доступное имя попадает.

import { FC, ReactNode } from 'react';

export interface IVisuallyHiddenProps {
  children: ReactNode;
  /** Для <th>/<label>: элемент, внутри которого скрытый текст допустим по разметке. */
  as?: 'span' | 'div' | 'h1' | 'h2' | 'h3';
  id?: string;
}

export const VisuallyHidden: FC<IVisuallyHiddenProps> = ({ children, as: Tag = 'span', id }) => (
  <Tag className="visually-hidden" id={id}>
    {children}
  </Tag>
);
