import type { IAssertion } from '../api/types';
import { EVENT_LABELS, ROLE_LABELS } from './labels';

/** Короткая человекочитаемая формулировка утверждения — без додумывания смысла. */
export const describeAssertion = (a: IAssertion): string => {
  const subject = a.subjectCompanyName ?? a.subjectProjectName ?? a.subjectText ?? '—';
  const object = a.objectProjectName ?? a.objectCompanyName ?? a.objectText;
  const scope = [a.scopeBuilding, a.workPackage].filter(Boolean).join(', ');
  const scopeText = scope ? ` (${scope})` : '';

  switch (a.predicate) {
    case 'participates_in_project':
      return `${subject} — ${a.role ? ROLE_LABELS[a.role] : 'роль?'} на объекте ${object ?? '—'}${scopeText}`;
    case 'event':
      return `${EVENT_LABELS[a.eventType ?? ''] ?? a.eventType}: ${subject}${object ? ` · ${object}` : ''}${
        a.counterpartyCompanyName ? ` · контрагент ${a.counterpartyCompanyName}` : ''
      }`;
    case 'company_mentioned':
    case 'project_mentioned':
      return `Упоминание: ${subject}`;
    default:
      return subject;
  }
};
