// Ключ внешнего сервиса (Контур.Фокус, parser-api.com): ввод и удаление в админке.
//
// Как ключ OpenRouter (LlmKeyForm): значение живёт только в поле ввода до отправки — ни в адресе, ни в
// localStorage, ни в кэше запросов; сохранение — прямым вызовом, а не useMutation (переменные мутации
// остаются в кэше клиента). После сохранения поле очищается; обратно сервер ключ не присылает.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ILlmKeyStatus } from '../../api/types';
import { Button } from '../ui/Button';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import styles from './Forms.module.css';

export interface IServiceKeySaved {
  key: ILlmKeyStatus;
  check: { verdict: string; error: string | null };
}

interface IServiceKeyFormProps {
  /** PUT — сохранить, DELETE — удалить ключ из админки. */
  endpoint: string;
  /** «Контур.Фокуса», «parser-api.com» — в подписи поля. */
  serviceName: string;
  hint: string;
  /** В админке уже есть ключ — его можно удалить. */
  hasAdminKey: boolean;
  onSaved: (result: IServiceKeySaved) => void;
  onCleared: (status: ILlmKeyStatus) => void;
  onError: (text: string) => void;
}

export const ServiceKeyForm: FC<IServiceKeyFormProps> = ({ endpoint, serviceName, hint, hasAdminKey, onSaved, onCleared, onError }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const clear = useMutation({
    mutationFn: () => api.delete<{ key: ILlmKeyStatus }>(endpoint),
    onSuccess: result => onCleared(result.key),
    onError: (err: Error) => onError(err.message),
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const key = value.trim();
    if (key === '' || saving) return;
    setSaving(true);
    try {
      const result = await api.put<IServiceKeySaved>(endpoint, { key });
      setValue('');
      onSaved(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack as="form" gap={3} className={styles.narrowForm} onSubmit={e => void submit(e)}>
      <Field label={hasAdminKey ? `Новый ключ ${serviceName} — заменит прежний` : `Ключ ${serviceName}`} hint={hint}>
        {control => (
          <TextInput
            {...control}
            className={styles.mono}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        )}
      </Field>
      <Cluster gap={2}>
        <Button type="submit" variant="primary" loading={saving} disabled={value.trim() === ''}>
          {saving ? 'Проверяю…' : 'Сохранить ключ'}
        </Button>
        {hasAdminKey && (
          <Button variant="secondary" onClick={() => clear.mutate()} loading={clear.isPending}>
            Удалить ключ из админки
          </Button>
        )}
      </Cluster>
    </Stack>
  );
};
