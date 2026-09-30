// Смена своего пароля. Правило пароля проверяет сервер (auth/password.ts); здесь — только
// то, что видно сразу: длина и совпадение повтора, чтобы не гонять запрос ради опечатки.

import { FC, FormEvent, useState } from 'react';

import { Button } from './ui/Button';
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
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.label}>{currentLabel}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Новый пароль</span>
        <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Новый пароль ещё раз</span>
        <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} />
      </label>
      <p className={styles.rule}>Не короче {PASSWORD_MIN_LENGTH} символов и без логина внутри. Остальные входы с этим паролем закроются.</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending || current === '' || next === '' || repeat === ''}>
        {pending ? 'Сохранение…' : submitLabel}
      </Button>
    </form>
  );
};
