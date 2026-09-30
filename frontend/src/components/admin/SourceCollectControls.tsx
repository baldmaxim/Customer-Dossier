// Сбор источника: переключатель «включён / выключен» и срок сбора (глубина истории) под ним.
// У ручного источника срока нет — он ничего не собирает сам, только принимает вставленное.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { HISTORY_STOP_LABELS } from '../../lib/labels';
import { Stack } from '../ui/Stack';
import { Switch } from '../ui/Switch';
import { HistoryDepthPicker } from './HistoryDepthPicker';
import { isSourceEnabled, sourceName, type ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

interface ISourceCollectControlsProps {
  source: ISourceRow;
  actions: ISourceActions;
}

export const SourceCollectControls: FC<ISourceCollectControlsProps> = ({ source, actions }) => {
  const name = sourceName(source);
  const manual = source.kind === 'manual';
  const stop = typeof source.lastCoverage?.stopReason === 'string' ? source.lastCoverage.stopReason : null;
  return (
    <Stack gap={2} align="start">
      <Switch
        checked={isSourceEnabled(source)}
        label={`${manual ? 'Приём текстов' : 'Сбор'}: ${name}`}
        disabled={actions.isToggling(source)}
        onChange={next => actions.toggle(source, next)}
      />
      {!manual && (
        <div className={styles.depth}>
          <span className={styles.caption} aria-hidden="true">
            срок сбора
          </span>
          <HistoryDepthPicker
            kind={source.kind === 'telegram' ? 'telegram' : 'website'}
            value={source.historyDays ?? null}
            label={`Срок сбора: ${name}`}
            disabled={actions.isSettingHistory(source)}
            onChange={days => actions.setHistory(source, days)}
          />
          {source.historyDays != null && stop && HISTORY_STOP_LABELS[stop] && (
            <span className={styles.caption}>{HISTORY_STOP_LABELS[stop]}</span>
          )}
        </div>
      )}
    </Stack>
  );
};
