// Добавить публичный Telegram-канал. Заводится выключенным — включает оператор
// переключателем в списке: публичность канала не заменяет решения о сборе.
//
// inline — строкой в шапке списка: поля без видимых подписей (подпись — у диктора, пример —
// в placeholder), пояснение — значком «?». stacked — столбиком в окне на телефоне.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from './actionError';
import { channelKey } from './channelKey';
import styles from './Sources.module.css';

export const CHANNEL_HINT =
  'Только публичные каналы: страница t.me/s/имя открывается без входа. Закрытые — пересылкой боту во вкладке «Вручную». Канал заводится выключенным.';

interface IAddChannelFormProps {
  layout?: 'inline' | 'stacked';
  /** После добавления: окно на телефоне закрывается. */
  onAdded?: () => void;
}

export const AddChannelForm: FC<IAddChannelFormProps> = ({ layout = 'inline', onAdded }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [channel, setChannel] = useState('');
  const [title, setTitle] = useState('');
  const inline = layout === 'inline';

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
      onAdded?.();
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
    <form className={inline ? styles.addForm : styles.addStacked} onSubmit={submit}>
      <Field label="Канал" labelHidden={inline} className={inline ? styles.addKey : undefined}>
        {control => (
          <TextInput
            {...control}
            className={inline ? styles.compact : undefined}
            placeholder="@канал или t.me/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={channel}
            onChange={e => setChannel(e.target.value)}
          />
        )}
      </Field>
      <Field label="Название (необязательно)" labelHidden={inline} className={inline ? styles.addTitle : undefined}>
        {control => (
          <TextInput
            {...control}
            className={inline ? styles.compact : undefined}
            placeholder={inline ? 'Название — необязательно' : 'возьмём из Telegram'}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size={inline ? 'sm' : 'md'} block={!inline} loading={add.isPending} disabled={key === ''}>
        {inline ? (
          <>
            Добавить<VisuallyHidden> канал</VisuallyHidden>
          </>
        ) : (
          'Добавить канал'
        )}
      </Button>
      {inline && (
        <span className={styles.hintSlot}>
          <Hint label="Добавить канал" text={CHANNEL_HINT} />
        </span>
      )}
    </form>
  );
};
