// Добавление источника: публичный Telegram-канал или сайт.
// Оба заводятся выключенными — включает оператор переключателем в таблице.

import { FC, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import styles from '../../pages/AdminPage.module.css';

export interface IAddSourceFormProps {
  onNotice: (text: string | null) => void;
}

const useInvalidateSources = (): (() => void) => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };
};

/** «@name», «t.me/name», «https://t.me/s/name» — всё это один канал «name». */
export const channelKey = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^t\.me\/(s\/)?/i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0] ?? '';

export const AddChannelForm: FC<IAddSourceFormProps> = ({ onNotice }) => {
  const invalidate = useInvalidateSources();
  const [channel, setChannel] = useState('');
  const [title, setTitle] = useState('');

  const addChannel = useMutation({
    mutationFn: (value: { channel: string; title: string }) =>
      api.post('/api/admin/sources/telegram', {
        channel: value.channel,
        // Пусто — имя подтянется со страницы канала при первом сборе.
        ...(value.title ? { title: value.title } : {}),
      }),
    onSuccess: () => {
      setChannel('');
      setTitle('');
      onNotice('Канал добавлен выключенным. Включите его переключателем в таблице — начнётся сбор.');
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  return (
    <form
      className={styles.inlineForm}
      onSubmit={e => {
        e.preventDefault();
        const key = channelKey(channel);
        if (key) addChannel.mutate({ channel: key, title: title.trim() });
      }}
    >
      <input
        className={styles.input}
        placeholder="@канал или ссылка t.me/…"
        aria-label="Канал"
        value={channel}
        onChange={e => setChannel(e.target.value)}
      />
      <input
        className={styles.input}
        placeholder="Название (необязательно — возьмём из Telegram)"
        aria-label="Название канала"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={addChannel.isPending}>
        Добавить канал
      </Button>
    </form>
  );
};

export const AddSiteForm: FC<IAddSourceFormProps> = ({ onNotice }) => {
  const invalidate = useInvalidateSources();
  const [site, setSite] = useState('');

  const addSite = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string | null }>('/api/admin/sources/website', { url }),
    onSuccess: () => {
      setSite('');
      onNotice('Сайт добавлен выключенным. Лента найдётся при первом проходе после включения.');
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  return (
    <form
      className={styles.inlineForm}
      onSubmit={e => {
        e.preventDefault();
        if (site.trim()) addSite.mutate(site.trim());
      }}
    >
      <input
        className={styles.input}
        placeholder="example.ru"
        aria-label="Адрес сайта"
        value={site}
        onChange={e => setSite(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={addSite.isPending}>
        Добавить сайт
      </Button>
    </form>
  );
};
