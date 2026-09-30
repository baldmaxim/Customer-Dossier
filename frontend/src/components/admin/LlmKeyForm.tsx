// Ключ OpenRouter: ввод и удаление (раздел «Модель», право llm.manage).
//
// Значение живёт только в поле ввода до отправки: ни в адресе, ни в localStorage, ни в кэше запросов.
// Поэтому сохранение — прямым вызовом, а не useMutation: переменные мутации остаются в кэше клиента
// запросов и после ответа. После сохранения поле очищается; обратно сервер ключ не присылает.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ILlmKeySaved, ILlmKeyStatus } from '../../api/types';
import { Button } from '../ui/Button';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import styles from './Forms.module.css';

interface ILlmKeyFormProps {
  /** В админке уже есть ключ — его можно удалить. */
  hasAdminKey: boolean;
  onSaved: (result: ILlmKeySaved) => void;
  onCleared: (status: ILlmKeyStatus) => void;
  onError: (text: string) => void;
}

export const LlmKeyForm: FC<ILlmKeyFormProps> = ({ hasAdminKey, onSaved, onCleared, onError }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const clear = useMutation({
    mutationFn: () => api.delete<{ key: ILlmKeyStatus }>('/api/admin/llm/key'),
    onSuccess: result => onCleared(result.key),
    onError: (err: Error) => onError(err.message),
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const key = value.trim();
    if (key === '' || saving) return;
    setSaving(true);
    try {
      const result = await api.put<ILlmKeySaved>('/api/admin/llm/key', { key });
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
        label={hasAdminKey ? 'Новый ключ OpenRouter — заменит прежний' : 'Ключ OpenRouter'}
        hint="Перед сохранением ключ проверяется в OpenRouter. На экран он не возвращается — видно только четыре последних символа. Лимит расходов задайте у ключа в самом OpenRouter: исчерпан — разбор ждёт, а не падает."
      >
        {control => (
          <TextInput
            {...control}
            className={styles.mono}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-…"
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
