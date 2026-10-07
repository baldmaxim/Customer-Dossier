import { FC } from 'react';

import type { IRunListItem } from '../../api/types';
import { ITEM_STATE_HINTS } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { outcomeOf, outcomeText, outcomeTone } from './runOutcome';

/** Итог разбора ярлыком — итогом сервера (те же слова и тон, что у плиток «Обработки»), пояснение — словарём. */
export const RunOutcomeBadge: FC<{ run: Pick<IRunListItem, 'status' | 'outcome'>; withHint?: boolean }> = ({ run, withHint = false }) => {
  const outcome = outcomeOf(run);
  return (
    <Badge tone={outcomeTone(outcome)} hint={withHint ? ITEM_STATE_HINTS[outcome.state] : undefined}>
      {outcomeText(outcome)}
    </Badge>
  );
};
