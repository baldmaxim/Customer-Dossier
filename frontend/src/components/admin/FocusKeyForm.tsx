// Ключ Контур.Фокуса: ввод и удаление (Источники → Контур.Фокус, право focus.manage).
//
// Как ключ OpenRouter (LlmKeyForm): значение живёт только в поле ввода до отправки — ни в адресе, ни в
// localStorage, ни в кэше запросов; сохранение — прямым вызовом, а не useMutation (переменные мутации
// остаются в кэше клиента). После сохранения поле очищается; обратно сервер ключ не присылает.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IFocusKeySaved, IFocusKeyStatus } from '../../api/types';
import { Button } from '../ui/Button';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import styles from './Forms.module.css';

interface IFocusKeyFormProps {
  /** В админке уже есть ключ — его можно удалить. */
  hasAdminKey: boolean;
  onSaved: (result: IFocusKeySaved) => void;
  onCleared: (status: IFocusKeyStatus) => void;
  onError: (text: string) => void;
}

export const FocusKeyForm: FC<IFocusKeyFormProps> = ({ hasAdminKey, onSaved, onCleared, onError }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const clear = useMutation({
    mutationFn: () => api.delete<{ key: IFocusKeyStatus }>('/api/admin/focus/key'),
    onSuccess: result => onCleared(result.key),
    onError: (err: Error) => onError(err.message),
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const key = value.trim();
    if (key === '' || saving) return;
    setSaving(true);
    try {
      const result = await api.put<IFocusKeySaved>('/api/admin/focus/key', { key });
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
      <Field
        label={hasAdminKey ? 'Новый ключ Контур.Фокуса — заменит прежний' : 'Ключ Контур.Фокуса'}
        hint="Ключ API из личного кабинета Контур.Фокуса. Перед сохранением он проверяется в Фокусе. На экран не возвращается — видно только четыре последних символа."
      >
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
