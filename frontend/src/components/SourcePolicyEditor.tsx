import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../api/client';
import type { ISourceRow, PermissionStatus } from '../api/types';
import { PERMISSION_LABELS } from '../lib/labels';
import styles from './SourcePolicyEditor.module.css';

const STATUSES: PermissionStatus[] = ['unknown', 'approved', 'blocked', 'revoked', 'expired'];

interface ISourcePolicyEditorProps {
  source: ISourceRow;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Решение о допуске источника. Заполняет оператор: основание и ответственный
 * обязательны для разрешения, сервер проверяет это и пишет журнал. Портал
 * согласований за пользователя не придумывает.
 */
export const SourcePolicyEditor: FC<ISourcePolicyEditorProps> = ({ source, onSaved, onCancel }) => {
  const [accessStatus, setAccessStatus] = useState<PermissionStatus>(source.accessStatus);
  const [aiStatus, setAiStatus] = useState<PermissionStatus>(source.aiProcessingStatus);
  const [basis, setBasis] = useState(source.policyBasis ?? '');
  const [reference, setReference] = useState(source.policyReference ?? '');
  const [owner, setOwner] = useState(source.policyOwner ?? '');
  const [scope, setScope] = useState(source.policyScope ?? '');
  const [expires, setExpires] = useState(source.policyExpiresAt ? source.policyExpiresAt.slice(0, 10) : '');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/admin/sources/${source.id}/policy`, {
        accessStatus,
        aiProcessingStatus: aiStatus,
        basis,
        reference,
        owner,
        scope,
        // Дата без времени — конец суток по UTC.
        expiresAt: expires ? `${expires}T23:59:59Z` : null,
      }),
    onSuccess: onSaved,
  });

  const approving = accessStatus === 'approved' || aiStatus === 'approved';
  const missing = approving && (basis.trim() === '' || owner.trim() === '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!missing) save.mutate();
  };

  return (
    <form className={styles.editor} onSubmit={submit}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Сбор</span>
          <select value={accessStatus} onChange={e => setAccessStatus(e.target.value as PermissionStatus)}>
            {STATUSES.map(s => (
              <option key={s} value={s}>
                {PERMISSION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>ИИ-обработка</span>
          <select value={aiStatus} onChange={e => setAiStatus(e.target.value as PermissionStatus)}>
            {STATUSES.map(s => (
              <option key={s} value={s}>
                {PERMISSION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Действует до (UTC)</span>
          <input type="date" value={expires} onChange={e => setExpires(e.target.value)} />
        </label>
      </div>
      <label className={styles.field}>
        <span>Основание{approving ? ' *' : ''}</span>
        <textarea rows={2} value={basis} onChange={e => setBasis(e.target.value)} />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Ответственный{approving ? ' *' : ''}</span>
          <input value={owner} onChange={e => setOwner(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Ссылка на решение</span>
          <input value={reference} onChange={e => setReference(e.target.value)} />
        </label>
      </div>
      <label className={styles.field}>
        <span>Объём и ограничения</span>
        <textarea rows={2} value={scope} onChange={e => setScope(e.target.value)} />
      </label>
      {missing && <p className={styles.error}>Для разрешения укажите основание и ответственного.</p>}
      {save.error && <p className={styles.error}>{save.error.message}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={missing || save.isPending}>
          {save.isPending ? 'Сохраняю…' : 'Сохранить решение'}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
};
