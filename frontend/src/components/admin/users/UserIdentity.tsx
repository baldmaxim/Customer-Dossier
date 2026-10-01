import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IUserRow } from '../../../api/types';
import { formatDateTime } from '../../../lib/labels';
import { Badge } from '../../ui/Badge';
import { Cluster } from '../../ui/Cluster';
import styles from './Users.module.css';

/** Кто это: имя (ссылкой на страницу пользователя, если задан `to`), логин и отметки «сменит пароль», «вход закрыт до …». */
export const UserIdentity: FC<{ user: IUserRow; self: boolean; to?: string }> = ({ user, self, to }) => (
  <span className={styles.identity}>
    <span className={styles.name}>
      {to ? (
        <Link to={to} viewTransition className={styles.nameLink}>
          {user.displayName}
        </Link>
      ) : (
        user.displayName
      )}
      {self && <span className={styles.current}> · это вы</span>}
    </span>
    <span className={styles.login}>{user.login}</span>
    {(user.mustChangePassword || user.lockedUntil) && (
      <Cluster gap={1} className={styles.badges}>
        {user.mustChangePassword && <Badge>сменит пароль при входе</Badge>}
        {user.lockedUntil && <Badge tone="warning">вход закрыт до {formatDateTime(user.lockedUntil)}</Badge>}
      </Cluster>
    )}
    {/* Пояснение — словами, а не подсказкой на ярлыке: на телефоне ярлык — слишком мелкая цель. */}
    {user.lockedUntil && <span className={styles.meta}>после неудачных попыток входа; сброс пароля снимет блокировку</span>}
  </span>
);
