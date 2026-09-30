// Состояние источника коротко: одна отметка словами, причина — только если что-то не так,
// и последний сбор. Прежние восемь строк служебных подробностей — под «Подробнее»: они для
// разбора сбоя, а не для ежедневного взгляда.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { formatCount } from '../../lib/format';
import { SOURCE_HEALTH_STATE_LABELS, formatDateTime } from '../../lib/labels';
import { SOURCE_HEALTH_STATE_TONE, toneOf } from '../../lib/statusTone';
import { SourceHealthCell } from '../SourceHealth';
import { Badge } from '../ui/Badge';
import { Disclosure } from '../ui/Disclosure';
import { Stack } from '../ui/Stack';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Sources.module.css';
import { sourceName } from './useSourceActions';

export const SourceStatus: FC<{ source: ISourceRow; enabled: boolean }> = ({ source, enabled }) => {
  const state = source.healthState?.state ?? 'never_run';
  const lastSaved = source.lastSaved ?? source.lastItemsNew ?? null;
  const facts = [
    source.items !== undefined ? `публикаций ${formatCount(source.items)}` : null,
    source.lastAttemptAt
      ? `сбор ${formatDateTime(source.lastAttemptAt)}${lastSaved !== null ? `, новых ${formatCount(lastSaved)}` : ''}`
      : null,
  ].filter((f): f is string => f !== null);

  return (
    <Stack gap={1} className={styles.status}>
      <span>
        {enabled ? (
          <Badge tone={toneOf(SOURCE_HEALTH_STATE_TONE, state)}>{SOURCE_HEALTH_STATE_LABELS[state] ?? state}</Badge>
        ) : (
          <Badge tone="neutral">выключен</Badge>
        )}
      </span>
      {enabled && state !== 'healthy' && source.healthState?.reason && <p className={styles.reason}>{source.healthState.reason}</p>}
      {facts.length > 0 && <p className={styles.meta}>{facts.join(' · ')}</p>}
      <Disclosure
        summary={
          <>
            Подробнее<VisuallyHidden> «{sourceName(source)}»</VisuallyHidden>
          </>
        }
      >
        <SourceHealthCell source={source} />
      </Disclosure>
    </Stack>
  );
};
