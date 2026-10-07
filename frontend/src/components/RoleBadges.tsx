// Роли ярлыками — один компонент для каталога, шапки карточки и поиска (07.10.2026: раньше у каждого своя копия
// «первые N и +M», а незнакомая роль называлась то сырым ключом, то «роль не названа»). Первые max — ярлыками,
// остальные — одной пилюлей «+N», их названия — диктору. Подпись роли — roleLabel из labels.ts.

import { FC, Fragment, ReactNode } from 'react';

import { roleLabel } from '../lib/labels';
import { Badge } from './ui/Badge';

export interface IRoleBadge {
  role: string;
  /** Сколько объектов в этой роли: «генподрядчик · 3». */
  count?: number;
}

const text = (r: IRoleBadge): string => (r.count !== undefined ? `${roleLabel(r.role)} · ${r.count}` : roleLabel(r.role));

interface IRoleBadgesProps {
  roles: IRoleBadge[];
  max: number;
  /** li — каждый ярлык своим пунктом списка (внутри чужого <ul>); по умолчанию — подряд. */
  item?: 'li';
}

export const RoleBadges: FC<IRoleBadgesProps> = ({ roles, max, item }) => {
  const rest = roles.slice(max);
  const wrap = (key: string, node: ReactNode): ReactNode => (item === 'li' ? <li key={key}>{node}</li> : <Fragment key={key}>{node}</Fragment>);
  return (
    <>
      {roles.slice(0, max).map(r => wrap(r.role, <Badge tone="accent">{text(r)}</Badge>))}
      {rest.length > 0 &&
        wrap(
          '+rest',
          <Badge tone="accent">
            <span aria-hidden="true">+{rest.length}</span>
            <span className="visually-hidden">ещё: {rest.map(text).join(', ')}</span>
          </Badge>,
        )}
    </>
  );
};
