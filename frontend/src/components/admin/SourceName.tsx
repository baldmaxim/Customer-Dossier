// Название источника в строке: имя в одну строку (в карточке — до двух), полное — в подсказке;
// под ним адрес моноширинным; справа значок — открыть канал или сайт в новой вкладке и сверить,
// что это тот самый. Имя — со страницы канала; пока его нет — «@ключ». У наш.дом.рф имя — ссылка внутрь:
// на его странице вкладками то, что ждёт решения инженера.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ISourceRow } from '../../api/types';
import { buttonClass } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { DOMRF_HOST, DOMRF_PAGE_PATH } from './domRfSummary';
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
        {source.key === DOMRF_HOST ? (
          <Link to={DOMRF_PAGE_PATH} className={styles.title} title={`${name} — компании и объекты`}>
            {name}
          </Link>
        ) : (
          <span className={styles.title} title={name}>
            {name}
          </span>
        )}
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
