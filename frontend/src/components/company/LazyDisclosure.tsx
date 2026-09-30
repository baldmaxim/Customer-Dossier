// Раскрывашка, содержимое которой монтируется только после раскрытия: «Откуда известно» и
// «Контекст объекта» грузят данные сами, и для двадцати связей сразу это двадцать запросов,
// из которых читатель откроет один. Раз открытое остаётся на месте — повторно не грузится.

import { FC, ReactNode, useState } from 'react';

import { Disclosure } from '../ui/Disclosure';
import styles from './Company.module.css';

interface ILazyDisclosureProps {
  summary: ReactNode;
  className?: string;
  children: ReactNode;
}

export const LazyDisclosure: FC<ILazyDisclosureProps> = ({ summary, className, children }) => {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <Disclosure
      summary={summary}
      className={[styles.lazy, className ?? ''].filter(Boolean).join(' ')}
      open={open}
      onToggle={next => {
        setOpen(next);
        if (next) setMounted(true);
      }}
    >
      {mounted ? children : null}
    </Disclosure>
  );
};
