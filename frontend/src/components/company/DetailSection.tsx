// Раздел вкладки «Подробно»: заголовок раздела в строке-раскрывашке (он же заголовок для
// навигации диктора) внутри рамки раздела — одна рамка на раздел (05.10.2026: раньше заголовок стоял
// над карточкой отдельной строкой). На телефоне раскрыт только первый раздел — остальное по нажатию;
// с 600px раскрыто всё.
//
// lazy — содержимое монтируется при первом раскрытии: схема связей грузит граф сама, и
// запрос за ней не нужен тому, кто раздел не открыл.

import { FC, ReactNode, useState } from 'react';

import { Disclosure } from '../ui/Disclosure';
import { HeadingLevelContext } from '../ui/headingLevel';
import styles from './Company.module.css';

interface IDetailSectionProps {
  id: string;
  title: string;
  meta?: ReactNode;
  defaultOpen: boolean;
  /** Содержимое уже на своей карточке (RegistryPanel) — вторую рамку не рисуем. */
  bare?: boolean;
  /** Монтировать содержимое только после первого раскрытия. */
  lazy?: boolean;
  children: ReactNode;
}

export const DetailSection: FC<IDetailSectionProps> = ({
  id,
  title,
  meta,
  defaultOpen,
  bare = false,
  lazy = false,
  children,
}) => {
  const [mounted, setMounted] = useState(defaultOpen || !lazy);
  return (
    <Disclosure
      id={id}
      summary={title}
      meta={meta}
      level={2}
      defaultOpen={defaultOpen}
      variant={bare ? 'plain' : 'card'}
      onToggle={next => {
        if (next) setMounted(true);
      }}
      className={styles.detailSection}
    >
      {/* Заголовки внутри раздела — на уровень глубже его заголовка. */}
      <HeadingLevelContext.Provider value={3}>
        {mounted && children}
      </HeadingLevelContext.Provider>
    </Disclosure>
  );
};
