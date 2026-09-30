// Скелет на месте содержимого, во всю ширину блока. Loading со скелетом сам растягивается на всю
// ширину; обёртка осталась короткой записью «подпись + строки скелета» для страниц.

import { FC } from 'react';

import { Loading } from './ui/Loading';
import { Skeleton, type ISkeletonProps } from './ui/Skeleton';
import styles from './LoadingSkeleton.module.css';

interface ILoadingSkeletonProps extends Pick<ISkeletonProps, 'lines' | 'height' | 'radius'> {
  /** Что грузится — для диктора (role="status"). */
  label: string;
}

export const LoadingSkeleton: FC<ILoadingSkeletonProps> = ({ label, lines, height, radius }) => (
  <div className={styles.wrap}>
    <Loading label={label}>
      <Skeleton lines={lines} height={height} radius={radius} />
    </Loading>
  </div>
);
