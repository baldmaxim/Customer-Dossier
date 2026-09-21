// Добавление источника: публичный Telegram-канал или сайт.
// Оба заводятся на паузе и без подтверждённого допуска — включает оператор.

import { FC, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import styles from '../../pages/AdminPage.module.css';

export interface IAddSourceFormsProps {
  onNotice: (text: string | null) => void;
}

export const AddSourceForms: FC<IAddSourceFormsProps> = ({ onNotice }) => {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [site, setSite] = useState('');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const addChannel = useMutation({
    mutationFn: (value: string) => api.post('/api/admin/sources/telegram', { channel: value }),
    onSuccess: () => {
      setChannel('');
      onNotice('Канал добавлен на паузе. Сбор начнётся после решения о допуске и включения.');
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  const addSite = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string | null }>('/api/admin/sources/website', { url }),
    onSuccess: () => {
      setSite('');
      onNotice('Сайт добавлен на паузе. Лента найдётся при первом разрешённом проходе.');
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  return (
    <>
      <section className={styles.section}>
        <h2>Добавить Telegram-канал</h2>
        <p className={styles.hint}>
          Только публичные каналы: страница <code>t.me/s/имя</code> должна открываться в браузере
          без входа. Закрытые каналы читаются пересылкой боту.
        </p>
        <form
          className={styles.inlineForm}
          onSubmit={e => {
            e.preventDefault();
            if (channel.trim()) addChannel.mutate(channel.trim());
          }}
        >
          <input
            className={styles.input}
            placeholder="имя_канала (без @)"
            value={channel}
            onChange={e => setChannel(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={addChannel.isPending}>
            Добавить
          </Button>
        </form>
      </section>

      <section className={styles.section}>
        <h2>Добавить сайт</h2>
        <p className={styles.hint}>
          Сайт читается по профилю: RSS/Atom (лента объявлена на главной или задана в профиле) либо HTML-список
          с пагинацией и селекторами статьи. Профиль задаётся командой{' '}
          <code>npm run ingest:once -- --site-profile &lt;ключ&gt; --file profile.json</code>. При добавлении запросов к
          сайту нет; «Проба» доступна после решения о допуске и ничего не сохраняет.
        </p>
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
            value={site}
            onChange={e => setSite(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={addSite.isPending}>
            Добавить
          </Button>
        </form>
      </section>
    </>
  );
};
