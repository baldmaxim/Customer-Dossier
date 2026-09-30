// Название источника в строке: имя в одну строку (в карточке — до двух), полное — в подсказке;
// под ним адрес моноширинным; справа значок — открыть канал или сайт в новой вкладке и сверить,
// что это тот самый. Имя — со страницы канала; пока его нет — «@ключ».

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { buttonClass } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { sourceAddress, sourceHref } from './sourceFacts';
import { sourceName } from './useSourceActions';
import styles from './Sources.module.css';

export const SourceName: FC<{ source: ISourceRow }> = ({ source }) => {
  const name = sourceName(source);
  const address = sourceAddress(source);
  const href = sourceHref(source);
  return (
    <div className={styles.name}>
      <div className={styles.nameText}>
        <span className={styles.title} title={name}>
          {name}
        </span>
        {address && (
          <span className={styles.address} title={address}>
            {address}
          </span>
        )}
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true, className: styles.external })}
          aria-label={`${address} — откроется в новой вкладке`}
          title={`Открыть ${address}`}
        >
          <Icon name="external" size="sm" />
        </a>
      )}
    </div>
  );
};
