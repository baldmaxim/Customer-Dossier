// Добавить сайт. Заводится выключенным; лента (RSS) или список статей найдутся при первом
// проходе после включения.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { actionError } from './actionError';
import styles from './Forms.module.css';

export const AddSiteForm: FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [site, setSite] = useState('');

  const add = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string | null }>('/api/admin/sources/website', { url }),
    onSuccess: () => {
      setSite('');
      toast.show({ tone: 'success', text: 'Сайт добавлен выключенным. Лента найдётся при первом проходе после включения.' });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (site.trim()) add.mutate(site.trim());
  };

  return (
    <form className={styles.inline} onSubmit={submit}>
      <Field label="Адрес сайта" className={styles.grow}>
        {control => (
          <TextInput
            {...control}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="example.ru"
            value={site}
            onChange={e => setSite(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={add.isPending} disabled={site.trim() === ''}>
        Добавить сайт
      </Button>
    </form>
  );
};
