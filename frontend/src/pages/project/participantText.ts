import type { IProjectDossier } from '../../api/types';
import { ASSERTION_ROLE_LABELS, IN_PERIOD_LABELS } from '../../lib/labels';
import { shortenLegalForm } from '../../lib/legalForm';
import { formatPeriod } from '../../lib/period';

export type Participant = IProjectDossier['participants'][number];

export const participantKey = (p: Participant, index: number): string => `${p.statement.assertionIds.join(',')}:${p.companyId}:${index}`;

/** Название в списке — с короткой формой («ООО»): полное — в карточке компании. */
export const companyText = (p: Participant): string => shortenLegalForm(p.companyName);

export const roleText = (p: Participant): string => ASSERTION_ROLE_LABELS[p.role ?? ''] ?? 'роль не названа';

export const periodText = (p: Participant): string => formatPeriod(p.validFrom, p.validTo, p.periodPrecision) || 'период не указан';

/** Совпадает ли участие с выбранным периодом — словами; без выбранного периода пусто. */
export const inPeriodText = (p: Participant): string => IN_PERIOD_LABELS[p.inPeriod] ?? '';
