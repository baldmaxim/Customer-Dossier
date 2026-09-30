// Добавить публичный Telegram-канал. Заводится выключенным — включает оператор
// переключателем в списке: публичность канала не заменяет решения о сборе.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { actionError } from './actionError';
import { channelKey } from './channelKey';
import styles from './Forms.module.css';

export const AddChannelForm: FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [channel, setChannel] = useState('');
  const [title, setTitle] = useState('');

  const add = useMutation({
    mutationFn: (value: { channel: string; title: string }) =>
      api.post('/api/admin/sources/telegram', {
        channel: value.channel,
        // Пусто — имя подтянется со страницы канала при первом сборе.
        ...(value.title ? { title: value.title } : {}),
      }),
    onSuccess: () => {
      setChannel('');
      setTitle('');
      toast.show({ tone: 'success', text: 'Канал добавлен выключенным. Включите его переключателем в списке — начнётся сбор.' });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const key = channelKey(channel);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (key) add.mutate({ channel: key, title: title.trim() });
  };

  return (
    <form className={styles.inline} onSubmit={submit}>
      <Field label="Канал" className={styles.grow}>
        {control => (
          <TextInput
            {...control}
            placeholder="@канал или ссылка t.me/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={channel}
            onChange={e => setChannel(e.target.value)}
          />
        )}
      </Field>
      <Field label="Название (необязательно)" className={styles.grow}>
        {control => <TextInput {...control} placeholder="возьмём из Telegram" value={title} onChange={e => setTitle(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" loading={add.isPending} disabled={key === ''}>
        Добавить канал
      </Button>
    </form>
  );
};
