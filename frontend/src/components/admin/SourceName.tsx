import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { Icon } from '../ui/Icon';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Sources.module.css';
import { sourceName } from './useSourceActions';

/** Где открыть канал или сайт: ссылка рядом с именем, чтобы сверить, что это тот самый. */
const sourceHref = (s: ISourceRow): string | null =>
  s.kind === 'telegram' ? `https://t.me/${s.key}` : s.kind === 'website' ? `https://${s.key}` : null;

/** Название источника и его адрес (открывается в новой вкладке). */
export const SourceName: FC<{ source: ISourceRow }> = ({ source }) => {
  const href = sourceHref(source);
  return (
    // span, а не div: в карточке название стоит внутри строчного заголовка.
    <span className={styles.name}>
      <span className={styles.title}>{sourceName(source)}</span>
      {href && (
        <a className={styles.key} href={href} target="_blank" rel="noreferrer noopener">
          {source.kind === 'telegram' ? `t.me/${source.key}` : source.key}
          <Icon name="external" size="sm" />
          <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
        </a>
      )}
    </span>
  );
};
