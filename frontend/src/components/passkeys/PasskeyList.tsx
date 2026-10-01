// Ключи доступа списком: название, где живёт ключ, когда добавлен и когда им входили, «Убрать».
// Один список на профиль (свои ключи) и на страницу пользователя в админке (его ключи).

import { FC } from 'react';

import type { IPasskeyRow } from '../../api/types';
import { formatDateTime, PASSKEY_DEVICE_LABELS } from '../../lib/labels';
import { Button } from '../ui/Button';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Passkeys.module.css';

interface IPasskeyListProps {
  items: IPasskeyRow[];
  onRemove: (item: IPasskeyRow) => void;
  /** Ключ, который сейчас убирается: кнопка крутится. */
  removingId?: number | null;
}

export const PasskeyList: FC<IPasskeyListProps> = ({ items, onRemove, removingId = null }) => (
  <ul className={styles.list}>
    {items.map(p => (
      <li key={p.id} className={styles.item}>
        <span className={styles.main}>
          <span className={styles.name}>{p.name}</span>
          <span className={styles.meta}>{PASSKEY_DEVICE_LABELS[p.deviceType] ?? 'вид ключа неизвестен'}</span>
        </span>
        <span className={styles.meta}>
          добавлен {formatDateTime(p.createdAt)} · {p.lastUsedAt ? `вход ${formatDateTime(p.lastUsedAt)}` : 'входа ещё не было'}
        </span>
        <Button size="sm" variant="danger" loading={removingId === p.id} onClick={() => onRemove(p)}>
          Убрать<VisuallyHidden> «{p.name}»</VisuallyHidden>
        </Button>
      </li>
    ))}
  </ul>
);
