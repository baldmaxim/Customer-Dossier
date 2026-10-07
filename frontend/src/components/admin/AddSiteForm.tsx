// Добавить сайт. Заводится выключенным; лента (RSS) или список статей найдутся при первом
// проходе после включения.
//
// inline — строкой в шапке списка, пояснение — значком «?»; stacked — в окне на телефоне.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { TextInput } from '../ui/TextInput';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from '../../lib/actionError';
import styles from './Sources.module.css';

export const SITE_HINT =
  'Сайт читается через RSS или список статей. У RSS нет архива — только последние записи, срок сбора его не углубит. Сайт заводится выключенным.';

interface IAddSiteFormProps {
  layout?: 'inline' | 'stacked';
  /** После добавления: окно на телефоне закрывается. */
  onAdded?: () => void;
}

export const AddSiteForm: FC<IAddSiteFormProps> = ({ layout = 'inline', onAdded }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [site, setSite] = useState('');
  const inline = layout === 'inline';

  const add = useMutation({
    mutationFn: (url: string) => api.post<{ feedUrl: string | null }>('/api/admin/sources/website', { url }),
    onSuccess: () => {
      setSite('');
      onAdded?.();
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
    <form className={inline ? styles.addForm : styles.addStacked} onSubmit={submit}>
      <Field label="Адрес сайта" labelHidden={inline} className={inline ? styles.addKey : undefined}>
        {control => (
          <TextInput
            {...control}
            className={inline ? styles.compact : undefined}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={inline ? 'Адрес сайта: example.ru' : 'example.ru'}
            value={site}
            onChange={e => setSite(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size={inline ? 'sm' : 'md'} block={!inline} loading={add.isPending} disabled={site.trim() === ''}>
        {inline ? (
          <>
            Добавить<VisuallyHidden> сайт</VisuallyHidden>
          </>
        ) : (
          'Добавить сайт'
        )}
      </Button>
      {inline && (
        <span className={styles.hintSlot}>
          <Hint label="Добавить сайт" text={SITE_HINT} />
        </span>
      )}
    </form>
  );
};
