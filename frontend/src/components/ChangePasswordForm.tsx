// Смена своего пароля. Правило пароля проверяет сервер (auth/password.ts); здесь — только
// то, что видно сразу: длина и совпадение повтора, чтобы не гонять запрос ради опечатки.

import { FC, FormEvent, useState } from 'react';

import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Field } from './ui/Field';
import { Stack } from './ui/Stack';
import { TextInput } from './ui/TextInput';
import styles from './ChangePasswordForm.module.css';

/** Совпадает с PASSWORD_MIN_LENGTH на сервере. */
export const PASSWORD_MIN_LENGTH = 10;

interface IChangePasswordFormProps {
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Подпись поля текущего пароля: при первом входе это пароль от администратора. */
  currentLabel?: string;
  submitLabel?: string;
  onDone?: () => void;
}

export const ChangePasswordForm: FC<IChangePasswordFormProps> = ({
  onSubmit,
  currentLabel = 'Текущий пароль',
  submitLabel = 'Сменить пароль',
  onDone,
}) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if ([...next].length < PASSWORD_MIN_LENGTH) {
      setError(`Новый пароль — не короче ${PASSWORD_MIN_LENGTH} символов`);
      return;
    }
    if (next !== repeat) {
      setError('Повтор не совпадает с новым паролем');
      return;
    }
    setError(null);
    setPending(true);
    onSubmit(current, next)
      .then(() => {
        setCurrent('');
        setNext('');
        setRepeat('');
        onDone?.();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setPending(false));
  };

  return (
    <Stack as="form" gap={3} className={styles.form} onSubmit={submit}>
      <Field label={currentLabel}>
        {control => (
          <TextInput
            {...control}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={e => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field label="Новый пароль" hint={`Не короче ${PASSWORD_MIN_LENGTH} символов и без логина внутри.`}>
        {control => (
          <TextInput {...control} type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        )}
      </Field>
      <Field label="Новый пароль ещё раз">
        {control => (
          <TextInput {...control} type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} />
        )}
      </Field>
      <p className={styles.rule}>Остальные входы с прежним паролем закроются.</p>
      {error && <Callout tone="danger">{error}</Callout>}
      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={current === '' || next === '' || repeat === ''}>
          {submitLabel}
        </Button>
      </div>
    </Stack>
  );
};
