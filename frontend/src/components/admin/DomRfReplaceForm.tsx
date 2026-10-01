// «Заменить»: вместо найденной на ДОМ.РФ карточки — правильная, которую указал оператор. Найденная
// уходит в решённые с пометкой «заменён», указанная встаёт в обычную очередь сбора.

import { FC, FormEvent, useState } from 'react';

import { Button } from '../ui/Button';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { TextInput } from '../ui/TextInput';

interface IDomRfReplaceFormProps {
  externalRef: string;
  pending: boolean;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}

export const DomRfReplaceForm: FC<IDomRfReplaceFormProps> = ({ externalRef, pending, onSubmit, onCancel }) => {
  const [url, setUrl] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  return (
    <form onSubmit={submit}>
      <Cluster gap={2} align="end">
        <Field label={`Правильная карточка вместо №${externalRef}`}>
          {control => (
            <TextInput
              {...control}
              type="url"
              required
              placeholder="https://наш.дом.рф/…/объект/62087"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={url.trim() === ''}>
          Заменить
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </Cluster>
    </form>
  );
};
