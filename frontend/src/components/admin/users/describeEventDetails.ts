import type { IAuthEventRow, UserRole } from '../../../api/types';
import { LOGIN_FAILURE_LABELS, USER_ROLE_LABELS } from '../../../lib/labels';

const isRole = (v: unknown): v is UserRole => v === 'admin' || v === 'operator' || v === 'viewer';

/** Подробности события словами: причина отказа, смена роли, сколько входов закрыто. */
export const describeEventDetails = (e: IAuthEventRow): string => {
  const d = e.details;
  const parts: string[] = [];
  if (typeof d.reason === 'string') parts.push(LOGIN_FAILURE_LABELS[d.reason] ?? 'другая причина');
  if (d.locked === true) parts.push('вход закрыт на время');
  const role = d.role as { from?: unknown; to?: unknown } | string | undefined;
  if (typeof role === 'object' && role !== null && isRole(role.from) && isRole(role.to)) {
    parts.push(`роль: ${USER_ROLE_LABELS[role.from]} → ${USER_ROLE_LABELS[role.to]}`);
  } else if (isRole(role)) {
    parts.push(`роль: ${USER_ROLE_LABELS[role]}`);
  }
  if (d.displayName === true) parts.push('имя изменено');
  if (typeof d.revokedSessions === 'number' && d.revokedSessions > 0) parts.push(`закрыто входов: ${d.revokedSessions}`);
  return parts.join(' · ');
};
