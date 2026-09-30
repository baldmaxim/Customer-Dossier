// Заголовок раздела с уровнем из контекста (headingLevel.ts). Явный level — только там,
// где глубина известна заранее; в переиспользуемых блоках — без него.

import { FC, HTMLAttributes, ReactNode } from 'react';

import { useHeadingLevel, type HeadingLevel } from './headingLevel';

export interface IHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  children: ReactNode;
}

export const Heading: FC<IHeadingProps> = ({ level, children, ...rest }) => {
  const contextLevel = useHeadingLevel();
  const Tag = `h${level ?? contextLevel}` as const;
  return <Tag {...rest}>{children}</Tag>;
};
