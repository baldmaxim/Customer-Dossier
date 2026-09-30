// Ключ OpenRouter: ввод и удаление (вкладка «Модель», право llm.manage).
//
// Значение живёт только в поле ввода до отправки: ни в адресе, ни в localStorage, ни в кэше запросов.
// Поэтому сохранение — прямым вызовом, а не useMutation: переменные мутации остаются в кэше клиента
// запросов и после ответа. После сохранения поле очищается; обратно сервер ключ не присылает.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ILlmKeySaved, ILlmKeyStatus } from '../../api/types';
import adminStyles from '../../pages/AdminPage.module.css';
import { Button } from '../ui/Button';

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
    <form onSubmit={e => void submit(e)}>
      <div className={adminStyles.fields}>
        <label className={adminStyles.field}>
          <span className={adminStyles.label}>{hasAdminKey ? 'Новый ключ OpenRouter — заменит прежний' : 'Ключ OpenRouter'}</span>
          <input
            className={adminStyles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-…"
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        </label>
      </div>
      <p className={adminStyles.hint}>
        Перед сохранением ключ проверяется в OpenRouter. На экран он не возвращается — видно только четыре последних
        символа. Лимит расходов задайте у ключа в самом OpenRouter: исчерпан — разбор ждёт, а не падает.
      </p>
      <div className={adminStyles.rowActions}>
        <Button type="submit" variant="primary" disabled={value.trim() === '' || saving}>
          {saving ? 'Проверяю…' : 'Сохранить ключ'}
        </Button>
        {hasAdminKey && (
          <Button variant="secondary" onClick={() => clear.mutate()} disabled={clear.isPending}>
            Удалить ключ из админки
          </Button>
        )}
      </div>
    </form>
  );
};
