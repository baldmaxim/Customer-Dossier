import { FC } from 'react';

import type { IRunListItem } from '../../api/types';
import { ITEM_STATE_HINTS, ITEM_STATE_LABELS } from '../../lib/labels';
import { ITEM_STATE_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { runOutcome } from './runOutcome';

/** Итог разбора ярлыком: одно слово, тон — из общего словаря, пояснение — в подписи словаря. */
export const RunOutcomeBadge: FC<{ run: Pick<IRunListItem, 'status' | 'relevant' | 'candidateSet' | 'policy'>; withHint?: boolean }> = ({
  run,
  withHint = false,
}) => {
  const { state, detail } = runOutcome(run);
  return (
    <Badge tone={toneOf(ITEM_STATE_TONE, state)} hint={withHint ? ITEM_STATE_HINTS[state] : undefined}>
      {detail ?? ITEM_STATE_LABELS[state] ?? state}
    </Badge>
  );
};
