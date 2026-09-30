import { FC } from 'react';

import type { IGraphEdge } from '../../api/types';
import { ASSERTION_STATUS_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { edgeStatus } from './graphText';

/** Статус связи словами; тон — только подсветка (ADR-009): отклонённое не красное. */
export const EdgeStatusBadge: FC<{ edge: IGraphEdge }> = ({ edge }) => (
  <Badge tone={edge.assertionId ? toneOf(ASSERTION_STATUS_TONE, edge.status) : 'neutral'}>{edgeStatus(edge)}</Badge>
);
