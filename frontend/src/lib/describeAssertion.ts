import type { IAssertion } from '../api/types';
import { ASSERTION_ROLE_LABELS, EVENT_LABELS, PROCEDURAL_ROLE_LABELS } from './labels';

/** Короткая человекочитаемая формулировка утверждения — без додумывания смысла. */
export const describeAssertion = (a: IAssertion): string => {
  const subject = a.subjectCompanyName ?? a.subjectProjectName ?? a.subjectText ?? '—';
  const object = a.objectProjectName ?? a.objectCompanyName ?? a.objectText;
  const scope = [a.scopeBuilding, a.workPackage ?? a.workPackageLabel].filter(Boolean).join(', ');
  const scopeText = scope ? ` (${scope})` : '';
  const role = a.role ? (ASSERTION_ROLE_LABELS[a.role] ?? a.role) : 'роль?';
  const not = a.polarity === 'negative' ? 'не ' : '';

  switch (a.predicate) {
    case 'participates_in_project':
      return `${subject} — ${not}${role} на объекте ${object ?? '—'}${scopeText}`;
    case 'contract':
      return `${subject} → ${object ?? '—'}: ${not}${role}${a.contextProjectName ? ` по объекту ${a.contextProjectName}` : ''}${scopeText}`;
    case 'corporate_relation':
      return `${subject} ${not}${role} ${object ?? '—'}`;
    case 'event':
      return `${a.polarity === 'negative' ? 'Не было: ' : ''}${EVENT_LABELS[a.eventType ?? ''] ?? a.eventType}: ${subject}${
        a.proceduralRole ? ` (${PROCEDURAL_ROLE_LABELS[a.proceduralRole] ?? a.proceduralRole})` : ''
      }${object ? ` · ${object}` : ''}${a.counterpartyCompanyName ? ` · контрагент ${a.counterpartyCompanyName}` : ''}${
        a.caseNumber ? ` · дело ${a.caseNumber}` : ''
      }${scopeText}`;
    case 'company_mentioned':
    case 'project_mentioned':
      return `Упоминание: ${subject}`;
    default:
      return subject;
  }
};
